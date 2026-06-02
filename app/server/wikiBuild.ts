import { spawn } from "node:child_process";
import { watch, existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, WIKI_DIR } from "./paths.ts";

/**
 * Production single-origin mode: the wiki is served as the static Quartz build
 * (public/). When wiki files change (agent writes, editor saves, reset), debounce
 * and rebuild public/ so /wiki reflects the latest. Dev mode uses the live Quartz
 * serve instead, so this is only started when SERVE_WIKI=1.
 */
const DEBOUNCE_MS = 2500;
let timer: NodeJS.Timeout | null = null;
let building = false;
let queued = false;

type Log = (msg: string) => void;

function runBuild(log: Log): void {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  const child = spawn("npm", ["run", "build"], { cwd: REPO_ROOT });
  let err = "";
  child.stderr.on("data", (d) => (err += d.toString()));
  child.on("close", (code) => {
    building = false;
    if (code === 0) log("[wiki] 리빌드 완료 → /wiki 갱신됨");
    else log(`[wiki] 리빌드 실패(code ${code}): ${err.slice(0, 300)}`);
    if (queued) {
      queued = false;
      schedule(log);
    }
  });
}

function schedule(log: Log): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => runBuild(log), DEBOUNCE_MS);
}

/** Trigger a debounced rebuild immediately (e.g., right after a reset). */
export function scheduleWikiRebuild(log: Log): void {
  schedule(log);
}

/** Watch wiki content and rebuild public/ on change (debounced). */
export function startWikiAutoBuild(log: Log): void {
  try {
    watch(WIKI_DIR, { recursive: true }, () => schedule(log));
  } catch (e) {
    log(`[wiki] wiki/ watch 실패: ${e instanceof Error ? e.message : e}`);
  }
  for (const f of ["index.md", "log.md", "glossary.md"]) {
    const p = join(REPO_ROOT, f);
    if (existsSync(p)) {
      try {
        watch(p, () => schedule(log));
      } catch {
        /* file may be replaced (reset) — recovered on next change */
      }
    }
  }
  log("[wiki] 자동 리빌드 감시 시작 (변경 시 ~2.5s 후 public/ 재생성)");
}
