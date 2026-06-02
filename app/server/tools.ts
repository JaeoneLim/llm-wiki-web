import { tool } from "ai";
import { z } from "zod";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, readdir, mkdir, appendFile } from "node:fs/promises";
import { join, resolve, relative, dirname } from "node:path";
import { REPO_ROOT, WIKI_DIR, SCRIPTS_DIR } from "./paths.ts";
import { clipUrl, extractPdfText } from "./ingest.ts";

const MAX_RETURN = 24_000; // cap tool output to protect the model's context
const truncate = (s: string) =>
  s.length > MAX_RETURN ? s.slice(0, MAX_RETURN) + "\n…(생략됨)" : s;

const ROOT_DOCS = new Set(["index.md", "log.md", "glossary.md"]);

/** Resolve a repo-relative path, enforcing read/write scope. */
function resolveScoped(rel: string, mode: "read" | "write"): string {
  const clean = rel.replace(/^\.\//, "");
  const abs = resolve(REPO_ROOT, clean);
  const within = (root: string) => abs === root || abs.startsWith(root + "/");
  if (mode === "write") {
    const ok = within(WIKI_DIR) || ROOT_DOCS.has(clean);
    if (!ok) throw new Error(`쓰기 불가 경로: ${rel} (wiki/ 또는 index/log/glossary.md만 가능)`);
  } else {
    const ok =
      within(WIKI_DIR) ||
      within(join(REPO_ROOT, "raw")) ||
      within(join(REPO_ROOT, ".claude")) ||
      ROOT_DOCS.has(clean) ||
      clean === "CLAUDE.md";
    if (!ok) throw new Error(`읽기 불가 경로: ${rel}`);
  }
  return abs;
}

async function listMd(dir: string, out: string[] = []): Promise<string[]> {
  if (!existsSync(dir)) return out;
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) await listMd(p, out);
    else if (ent.name.endsWith(".md")) out.push(relative(REPO_ROOT, p));
  }
  return out;
}

/**
 * Shared wiki toolset for the AI-SDK (OpenAI/Gemini/open) path. The Claude path
 * gets equivalent capability from its built-in Read/Write/Edit/WebFetch tools.
 * Each tool emits an `onTool` chip summary for the activity feed.
 */
export function makeWikiTools(onTool: (name: string, summary: string) => void) {
  return {
    list_wiki: tool({
      description: "위키의 모든 마크다운 페이지 경로와 index/log/glossary를 나열한다.",
      parameters: z.object({}),
      execute: async () => {
        onTool("list_wiki", "📂 위키 목록");
        const files = await listMd(WIKI_DIR);
        return JSON.stringify([...files, "index.md", "log.md", "glossary.md"]);
      },
    }),

    read_file: tool({
      description:
        "위키 페이지, raw/ 자료, index/log/glossary, CLAUDE.md, .claude/skills 를 읽는다.",
      parameters: z.object({ path: z.string().describe("repo-relative 경로") }),
      execute: async ({ path }) => {
        onTool("read_file", `📖 ${path}`);
        const abs = resolveScoped(path, "read");
        if (!existsSync(abs)) return `(없는 파일: ${path})`;
        return truncate(await readFile(abs, "utf8"));
      },
    }),

    read_pdf: tool({
      description: "raw/uploads 의 PDF에서 텍스트를 추출한다.",
      parameters: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        onTool("read_pdf", `📄 ${path}`);
        const abs = resolveScoped(path, "read");
        if (!existsSync(abs)) return `(없는 파일: ${path})`;
        try {
          return truncate(await extractPdfText(abs));
        } catch (e) {
          return `(PDF 텍스트 추출 실패: ${e instanceof Error ? e.message : e})`;
        }
      },
    }),

    fetch_url: tool({
      description: "URL을 가져와 raw/clips/ 에 마크다운으로 저장하고 그 내용을 반환한다.",
      parameters: z.object({ url: z.string() }),
      execute: async ({ url }) => {
        onTool("fetch_url", `🌐 ${url}`);
        const staged = await clipUrl(url);
        const content = await readFile(join(REPO_ROOT, staged.path), "utf8");
        return JSON.stringify({ path: staged.path, title: staged.title, content: truncate(content) });
      },
    }),

    write_wiki_page: tool({
      description:
        "위키 페이지(wiki/**) 또는 index.md/log.md/glossary.md 를 만들거나 덮어쓴다. 전체 내용을 넘긴다.",
      parameters: z.object({
        path: z.string().describe("예: wiki/concepts/foo.md"),
        content: z.string().describe("파일 전체 내용 (frontmatter 포함)"),
      }),
      execute: async ({ path, content }) => {
        onTool("write_wiki_page", `✍️ ${path}`);
        const abs = resolveScoped(path, "write");
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf8");
        return `작성됨: ${path}`;
      },
    }),

    append_log: tool({
      description: "log.md 에 한 항목을 추가한다 (## [YYYY-MM-DD] op | title 형식).",
      parameters: z.object({ entry: z.string() }),
      execute: async ({ entry }) => {
        onTool("append_log", "📝 로그 추가");
        await appendFile(join(REPO_ROOT, "log.md"), "\n" + entry.trim() + "\n", "utf8");
        return "로그에 추가됨";
      },
    }),

    reset_wiki: tool({
      description:
        "위키를 초기 빈 상태로 되돌린다. 파괴적 — 사용자가 명시적으로 확인한 경우에만 호출한다.",
      parameters: z.object({
        confirmed: z.boolean().describe("사용자가 초기화에 동의했는가"),
      }),
      execute: async ({ confirmed }) => {
        if (!confirmed) return "확인되지 않음 — 먼저 사용자에게 동의를 받으세요.";
        onTool("reset_wiki", "🧹 위키 초기화");
        return await new Promise<string>((res) => {
          const child = spawn("node", [join(SCRIPTS_DIR, "reset.mjs")], { cwd: REPO_ROOT });
          let out = "";
          child.stdout.on("data", (d) => (out += d));
          child.on("close", () => {
            const m = out.match(/RESET_RESULT (\{.*\})/);
            res(m ? `초기화 완료: ${m[1]}` : "초기화 완료");
          });
        });
      },
    }),
  };
}
