import { writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { REPO_ROOT, RAW_CLIPS, RAW_UPLOADS } from "./paths.ts";

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

export function isoDate(d = new Date()): string {
  // KST (UTC+9) date for filename slugs, matching the user's locale.
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** ASCII kebab-case slug; falls back to a host/timestamp when title is non-ASCII. */
export function slugify(input: string, fallback = "source"): string {
  const s = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "") // drop non-ascii (e.g. Korean)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || fallback;
}

export interface StagedSource {
  kind: "url" | "pdf";
  /** Repo-relative path under raw/. */
  path: string;
  title: string;
  url?: string;
}

/** Fetch a URL, extract the readable article, save markdown to raw/clips/. */
export async function clipUrl(url: string): Promise<StagedSource> {
  await mkdir(RAW_CLIPS, { recursive: true });
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (llm-wiki-web ingest)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`URL fetch 실패: ${res.status} ${res.statusText}`);
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  let title = dom.window.document.title || url;
  let markdown: string;
  try {
    const article = new Readability(dom.window.document).parse();
    if (article?.content) {
      title = article.title || title;
      markdown = td.turndown(article.content);
    } else {
      markdown = td.turndown(dom.window.document.body?.innerHTML ?? html);
    }
  } catch {
    markdown = td.turndown(dom.window.document.body?.innerHTML ?? html);
  }

  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "web";
    }
  })();
  const slug = slugify(title, slugify(host, "clip"));
  const fname = `${isoDate()}-${slug}.md`;
  const abs = join(RAW_CLIPS, fname);
  const header =
    `---\n` +
    `source_url: ${JSON.stringify(url)}\n` +
    `fetched: ${isoDate()}\n` +
    `title: ${JSON.stringify(title)}\n` +
    `---\n\n` +
    `> 원본: ${url} (페치 ${isoDate()})\n\n`;
  await writeFile(abs, header + markdown, "utf8");
  return { kind: "url", path: relative(REPO_ROOT, abs), title, url };
}

/** Save an uploaded PDF buffer to raw/uploads/. Text extraction is on-demand. */
export async function savePdf(filename: string, buf: Buffer): Promise<StagedSource> {
  await mkdir(RAW_UPLOADS, { recursive: true });
  const base = slugify(filename.replace(/\.pdf$/i, ""), "document");
  const fname = `${base}.pdf`;
  const abs = join(RAW_UPLOADS, fname);
  await writeFile(abs, buf);
  return { kind: "pdf", path: relative(REPO_ROOT, abs), title: filename };
}

/** Extract text from a PDF (best-effort) — used by the AI-SDK read_pdf tool. */
export async function extractPdfText(absPath: string): Promise<string> {
  // Import the lib file directly to avoid pdf-parse's debug-mode self-test bug.
  // @ts-expect-error - pdf-parse/lib has no type declarations
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = mod.default as (b: Buffer) => Promise<{ text: string }>;
  const { readFile } = await import("node:fs/promises");
  const data = await pdfParse(await readFile(absPath));
  return data.text;
}
