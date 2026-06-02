import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import cookie from "@fastify/cookie";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { join, resolve, relative, dirname } from "node:path";
import {
  REPO_ROOT,
  WIKI_DIR,
  WEB_DIST,
  PUBLIC_DIR,
  SCRIPTS_DIR,
  WIKI_CATEGORIES,
} from "./paths.ts";
import { loadConfig, saveConfig, redactConfig, mergeConfig } from "./config.ts";
import { makeEngine } from "./providers/index.ts";
import { clipUrl, savePdf } from "./ingest.ts";
import { startWikiAutoBuild, scheduleWikiRebuild } from "./wikiBuild.ts";
import { scheduleGitSync } from "./gitSync.ts";
import {
  authRequired,
  verifyPassword,
  passwordFromEnv,
  setStoredPassword,
  getSessionSecret,
  SESSION_COOKIE,
  sessionCookieValue,
} from "./auth.ts";
import type { AppConfig, ChatEvent } from "./types.ts";

const API_PORT = Number(process.env.API_PORT ?? 3001);
// Production single-origin mode: serve /wiki (Quartz static) + auto-rebuild.
const SERVE_WIKI = process.env.SERVE_WIKI === "1";
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

/** Collaborator email injected by Cloudflare Access (for log attribution). */
function collaborator(req: { headers: Record<string, unknown> }): string | undefined {
  const e = req.headers["cf-access-authenticated-user-email"];
  return typeof e === "string" ? e : undefined;
}

// CORS must allow credentials so the auth cookie flows from the web origin.
await app.register(cors, { origin: true, credentials: true });
await app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024 } });
await app.register(cookie, { secret: await getSessionSecret() });

// ---- auth gate (single password, protects /api/* except auth/health) -------

function isAuthed(req: { cookies?: Record<string, string | undefined> }): boolean {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return false;
  const un = app.unsignCookie(raw);
  return un.valid && un.value === sessionCookieValue;
}

app.addHook("onRequest", async (req, reply) => {
  const url = req.url.split("?")[0];
  if (!url.startsWith("/api/")) return; // static assets / SPA shell are open
  if (req.method === "OPTIONS") return;
  if (url === "/api/health" || url.startsWith("/api/auth/")) return;
  const cfg = await loadConfig();
  if (!authRequired(cfg)) return;
  if (!isAuthed(req)) return reply.code(401).send({ error: "로그인이 필요합니다", authRequired: true });
});

app.get("/api/auth/status", async (req) => {
  const cfg = await loadConfig();
  const required = authRequired(cfg);
  return { authRequired: required, authed: !required || isAuthed(req), fromEnv: passwordFromEnv() };
});

app.post("/api/auth/login", async (req, reply) => {
  const { password } = (req.body ?? {}) as { password?: string };
  const cfg = await loadConfig();
  if (!authRequired(cfg)) return { ok: true };
  if (!password || !verifyPassword(cfg, password)) {
    return reply.code(401).send({ error: "비밀번호가 올바르지 않습니다" });
  }
  reply.setCookie(SESSION_COOKIE, sessionCookieValue, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    signed: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
  return { ok: true };
});

app.post("/api/auth/logout", async (_req, reply) => {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
  return { ok: true };
});

app.post("/api/auth/set-password", async (req, reply) => {
  if (passwordFromEnv()) {
    return reply.code(400).send({ error: "WIKI_PASSWORD 환경변수로 설정되어 API로 변경할 수 없습니다" });
  }
  const { current, next } = (req.body ?? {}) as { current?: string; next?: string };
  if (next == null) return reply.code(400).send({ error: "next 필요" });
  const cfg = await loadConfig();
  if (authRequired(cfg) && (!current || !verifyPassword(cfg, current))) {
    return reply.code(401).send({ error: "현재 비밀번호가 올바르지 않습니다" });
  }
  await setStoredPassword(next);
  return { ok: true, authConfigured: next !== "" };
});

// ---- helpers ---------------------------------------------------------------

/** Resolve a repo-relative wiki path safely (must stay inside wiki/). */
function safeWikiPath(rel: string): string {
  const abs = resolve(WIKI_DIR, rel.replace(/^wiki\//, ""));
  if (abs !== WIKI_DIR && !abs.startsWith(WIKI_DIR + "/")) {
    throw new Error("경로가 wiki/ 밖입니다");
  }
  return abs;
}

async function listMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    if (!existsSync(d)) return;
    for (const ent of await readdir(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) await walk(p);
      else if (ent.name.endsWith(".md")) out.push(relative(REPO_ROOT, p));
    }
  }
  await walk(dir);
  return out.sort();
}

// ---- chat (SSE) ------------------------------------------------------------

app.post("/api/chat", async (req, reply) => {
  const body = (req.body ?? {}) as { message?: string; sessionId?: string };
  const message = (body.message ?? "").trim();
  if (!message) return reply.code(400).send({ error: "message가 비어 있습니다" });

  const who = collaborator(req);
  if (who) req.log.info({ collaborator: who }, "chat turn");

  const cfg = await loadConfig();
  const engine = makeEngine(cfg);

  const ac = new AbortController();
  req.raw.on("close", () => ac.abort());

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (ev: ChatEvent) => reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);

  try {
    for await (const ev of engine.run({ message, sessionId: body.sessionId, signal: ac.signal })) {
      send(ev);
    }
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    if (!ac.signal.aborted) reply.raw.write("event: end\ndata: {}\n\n");
    reply.raw.end();
    scheduleGitSync((m) => app.log.info(m)); // no-op unless GIT_SYNC=1
  }
});

// ---- ingest ----------------------------------------------------------------

app.post("/api/ingest/url", async (req, reply) => {
  const { url } = (req.body ?? {}) as { url?: string };
  if (!url || !/^https?:\/\//.test(url)) return reply.code(400).send({ error: "유효한 URL이 아닙니다" });
  try {
    const staged = await clipUrl(url);
    return staged;
  } catch (err) {
    return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/ingest/pdf", async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "파일이 없습니다" });
  const buf = await file.toBuffer();
  try {
    const staged = await savePdf(file.filename, buf);
    return staged;
  } catch (err) {
    return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- wiki file editor ------------------------------------------------------

app.get("/api/wiki/files", async () => {
  const files = await listMarkdown(WIKI_DIR);
  return { files, categories: WIKI_CATEGORIES };
});

app.get("/api/wiki/file", async (req, reply) => {
  const { path } = req.query as { path?: string };
  if (!path) return reply.code(400).send({ error: "path 필요" });
  try {
    const abs = safeWikiPath(path);
    if (!existsSync(abs)) return reply.code(404).send({ error: "없는 파일" });
    return { path: relative(REPO_ROOT, abs), content: await readFile(abs, "utf8") };
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put("/api/wiki/file", async (req, reply) => {
  const { path, content } = (req.body ?? {}) as { path?: string; content?: string };
  if (!path || content == null) return reply.code(400).send({ error: "path와 content 필요" });
  try {
    const abs = safeWikiPath(path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    scheduleGitSync((m) => app.log.info(m));
    return { ok: true, path: relative(REPO_ROOT, abs) };
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- reset -----------------------------------------------------------------

app.post("/api/reset", async (_req, reply) => {
  return await new Promise((resolvePromise) => {
    const child = spawn("node", [join(SCRIPTS_DIR, "reset.mjs")], { cwd: REPO_ROOT });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => {
      const m = out.match(/RESET_RESULT (\{.*\})/);
      const summary = m ? JSON.parse(m[1]) : null;
      if (code === 0) {
        if (SERVE_WIKI) scheduleWikiRebuild((msg) => app.log.info(msg));
        scheduleGitSync((msg) => app.log.info(msg));
        resolvePromise({ ok: true, summary });
      } else resolvePromise(reply.code(500).send({ ok: false, output: out }));
    });
  });
});

// ---- settings --------------------------------------------------------------

app.get("/api/settings", async () => redactConfig(await loadConfig()));

app.put("/api/settings", async (req) => {
  const current = await loadConfig();
  const next = mergeConfig(current, (req.body ?? {}) as Partial<AppConfig>);
  await saveConfig(next);
  return redactConfig(next);
});

app.get("/api/health", async () => ({ ok: true, repo: REPO_ROOT }));

// ---- static (production single-origin) -------------------------------------

// /wiki/* → Quartz static build (public/). Registered before the root SPA static.
// decorateReply:false avoids the duplicate sendFile decorator error.
if (SERVE_WIKI && existsSync(PUBLIC_DIR)) {
  await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: "/wiki/", decorateReply: false });
} else if (SERVE_WIKI) {
  app.log.warn("SERVE_WIKI=1 이지만 public/ 가 없습니다 — 먼저 `npm run build`로 위키를 빌드하세요.");
}

if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST });
  app.setNotFoundHandler(async (req, reply) => {
    const url = req.url.split("?")[0];
    if (url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
    if (url.startsWith("/wiki")) {
      // Quartz uses clean URLs: resolve /wiki/foo → public/foo.html or foo/index.html.
      const rel = decodeURIComponent(url.slice("/wiki".length)).replace(/^\/+/, "").replace(/\/+$/, "");
      for (const cand of rel ? [`${rel}.html`, join(rel, "index.html")] : []) {
        const f = resolve(PUBLIC_DIR, cand);
        if ((f === PUBLIC_DIR || f.startsWith(PUBLIC_DIR + "/")) && existsSync(f)) {
          return reply.type("text/html").send(await readFile(f));
        }
      }
      const nf = join(PUBLIC_DIR, "404.html");
      if (existsSync(nf)) return reply.code(404).type("text/html").send(await readFile(nf));
      return reply.code(404).send({ error: "wiki page not found" });
    }
    return reply.sendFile("index.html"); // SPA fallback
  });
}

if (SERVE_WIKI) startWikiAutoBuild((m) => app.log.info(m));

app
  .listen({ port: API_PORT, host: "0.0.0.0" })
  .then(() =>
    app.log.info(
      `llm-wiki-web on :${API_PORT} (repo ${REPO_ROOT})${SERVE_WIKI ? " — single-origin: / + /api + /wiki" : ""}`,
    ),
  )
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
