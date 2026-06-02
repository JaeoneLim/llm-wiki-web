import { spawn } from "node:child_process";
import { REPO_ROOT } from "./paths.ts";

/**
 * Optional durability: when GIT_SYNC=1, debounce-commit wiki changes and push.
 * Only wiki content is committed (raw/clips, raw/uploads, app/config.json are
 * gitignored). Requires the repo to be a git repo with a configured remote;
 * push failures are logged, not fatal (local commits still give version history).
 */
const DEBOUNCE_MS = 8000;
let timer: NodeJS.Timeout | null = null;
let running = false;
let again = false;
let disabled = false;

type Log = (msg: string) => void;

export function gitSyncEnabled(): boolean {
  return process.env.GIT_SYNC === "1" && !disabled;
}

function exec(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    const c = spawn("git", args, { cwd: REPO_ROOT });
    let out = "";
    c.stdout.on("data", (d) => (out += d.toString()));
    c.stderr.on("data", (d) => (out += d.toString()));
    c.on("close", (code) => res({ code: code ?? 1, out }));
    c.on("error", (e) => res({ code: 1, out: String(e) }));
  });
}

async function sync(log: Log): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    if ((await exec(["rev-parse", "--is-inside-work-tree"])).code !== 0) {
      disabled = true;
      log("[git] git 저장소가 아닙니다 — GIT_SYNC 비활성화 (`git init` + remote 설정 필요)");
      return;
    }
    await exec(["add", "-A"]);
    const commit = await exec(["commit", "-m", `wiki: 자동 동기화 ${new Date().toISOString()}`]);
    if (commit.code !== 0) {
      if (!/nothing to commit/.test(commit.out)) log(`[git] commit 경고: ${commit.out.slice(0, 200)}`);
      return; // nothing to commit, or benign
    }
    log("[git] 커밋 완료");
    const push = await exec(["push"]);
    if (push.code === 0) log("[git] push 완료");
    else log(`[git] push 실패(로컬 커밋은 보존됨): ${push.out.slice(0, 200)}`);
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleGitSync(log);
    }
  }
}

/** Debounced git sync. No-op unless GIT_SYNC=1. Safe to call liberally. */
export function scheduleGitSync(log: Log): void {
  if (!gitSyncEnabled()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void sync(log), DEBOUNCE_MS);
}
