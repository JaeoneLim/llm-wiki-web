#!/usr/bin/env node
/**
 * Top-level dev orchestrator. Runs three processes together:
 *   - Quartz live site   (http://localhost:8080)   ← the wiki, rendered
 *   - Chat backend API   (http://localhost:3001)   ← Fastify
 *   - Web chat UI        (http://localhost:3000)   ← Vite (open this)
 *
 * Quartz's hot-reload WebSocket uses --wsPort 3030 to avoid colliding with the
 * API on 3001. Children are spawned in their own process groups and killed as
 * groups on Ctrl+C so nothing is orphaned (avoids EADDRINUSE on restart).
 *
 * `npm run dev` → node scripts/dev.mjs.
 */
import { spawn } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "app");

const procs = [
  {
    label: "quartz",
    color: "36", // cyan
    cmd: "node",
    args: ["./quartz/bootstrap-cli.mjs", "build", "--serve", "-d", ".", "--wsPort", "3030"],
    cwd: root,
  },
  { label: "app", color: "33", cmd: "npm", args: ["run", "dev"], cwd: app }, // yellow (nests server+web)
];

const children = [];
function run({ label, color, cmd, args, cwd }) {
  const pre = `\x1b[${color}m[${label}]\x1b[0m `;
  const child = spawn(cmd, args, { cwd, env: process.env, detached: true });
  const pipe = (src, dst) => {
    let acc = "";
    src.on("data", (b) => {
      acc += b.toString();
      const lines = acc.split("\n");
      acc = lines.pop() ?? "";
      for (const l of lines) dst.write(pre + l + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => process.stdout.write(pre + `종료 (code ${code})\n`));
  children.push(child);
}

console.log("\x1b[1mLLM Wiki dev\x1b[0m — 웹 챗: http://localhost:3000  |  위키: http://localhost:8080\n");
procs.forEach(run);

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      process.kill(-c.pid, "SIGTERM"); // kill the whole process group
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
