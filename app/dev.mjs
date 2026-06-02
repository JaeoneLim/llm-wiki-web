#!/usr/bin/env node
/**
 * Runs the chat backend (Fastify, tsx watch) and the web UI (Vite) together.
 * Invoked by `npm run dev` inside app/. The root `npm run dev` also starts
 * Quartz on top of this. Children run in their own process groups and are
 * killed as groups on shutdown so nothing is orphaned.
 */
import { spawn } from "node:child_process";

const bin = (name) => `./node_modules/.bin/${name}`;
const procs = [
  { label: "server", color: "32", cmd: bin("tsx"), args: ["watch", "server/index.ts"] }, // green
  { label: "web", color: "35", cmd: bin("vite"), args: [] }, // magenta
];

const children = [];
function run({ label, color, cmd, args }) {
  const pre = `\x1b[${color}m[${label}]\x1b[0m `;
  const child = spawn(cmd, args, { env: process.env, detached: true });
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

procs.forEach(run);

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(0), 400);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
