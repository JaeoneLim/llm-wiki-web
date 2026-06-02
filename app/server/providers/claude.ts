import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../paths.ts";
import type { AppConfig, ChatEngine, ChatEvent, ChatRunInput } from "../types.ts";

const SYSTEM_APPEND = `
You are the maintainer of this LLM wiki, operated through a web chat UI (not a terminal).
Follow CLAUDE.md and the onboard/ingest/query/lint/reset skills in this repo. Reply in Korean,
concisely, in a chat-friendly way. If the wiki is still empty (no pages under wiki/ and no
wiki/notes/about-this-wiki.md), do NOT ingest yet — run the onboarding interview first
(see CLAUDE.md §12 and the onboard skill): ask the user about the wiki's purpose, the work it
serves, who they are (background), what kinds of sources they'll add, and how to set up
categories, then record the result. When ingesting a source, discuss key takeaways and ask
follow-up questions before writing files, then propose the page operations and wait for the
user's confirmation. Confirm before destructive actions (reset). The wiki pages you write
are rendered live by Quartz in a side panel, so keep the wiki tidy and well cross-linked.
`.trim();

/** Human-friendly one-line summary of a tool_use block, for activity chips. */
function summarizeTool(name: string, input: Record<string, unknown>): string {
  const p = (input?.file_path ?? input?.path ?? input?.notebook_path) as string | undefined;
  const base = p ? p.replace(`${REPO_ROOT}/`, "").replace(REPO_ROOT, "") : undefined;
  switch (name) {
    case "Write":
      return `작성 ${base ?? ""}`.trim();
    case "Edit":
    case "MultiEdit":
      return `편집 ${base ?? ""}`.trim();
    case "Read":
      return `읽기 ${base ?? ""}`.trim();
    case "WebFetch":
      return `가져오기 ${(input?.url as string) ?? ""}`.trim();
    case "Bash":
      return `실행 ${String(input?.command ?? "").slice(0, 60)}`.trim();
    case "Glob":
    case "Grep":
      return `검색 ${String(input?.pattern ?? "")}`.trim();
    case "Skill":
      return `스킬 ${String(input?.command ?? input?.name ?? "")}`.trim();
    case "TodoWrite":
      return `할 일 업데이트`;
    default:
      return name;
  }
}

export class ClaudeEngine implements ChatEngine {
  constructor(private cfg: AppConfig) {}

  async *run(input: ChatRunInput): AsyncGenerator<ChatEvent> {
    const ac = new AbortController();
    if (input.signal.aborted) ac.abort();
    else input.signal.addEventListener("abort", () => ac.abort(), { once: true });

    let appendPrompt = SYSTEM_APPEND;
    if (this.cfg.provider === "antigravity") {
      const read = async (p: string) => (existsSync(join(REPO_ROOT, p)) ? readFile(join(REPO_ROOT, p), "utf8") : "");
      const antigravityMd = await read("ANTIGRAVITY.md");
      const onboard = await read(".antigravity/skills/onboard/SKILL.md");
      const ingest = await read(".antigravity/skills/ingest/SKILL.md");
      const reset = await read(".antigravity/skills/reset/SKILL.md");
      appendPrompt = `
You are running as the Antigravity agent.
IMPORTANT: You MUST ignore the CLAUDE.md file and \`.claude/\` directory in the repository. Instead, you MUST strictly follow the ANTIGRAVITY.md rules and \`.antigravity/skills/\` guidelines provided below.

You are the maintainer of this LLM wiki, operated through a web chat UI (not a terminal).
Follow ANTIGRAVITY.md and the onboard/ingest/query/lint/reset skills in this repo. Reply in Korean,
concisely, in a chat-friendly way. If the wiki is still empty (no pages under wiki/ and no
wiki/notes/about-this-wiki.md), do NOT ingest yet — run the onboarding interview first
(see ANTIGRAVITY.md §12 and the onboard skill): ask about the wiki's purpose, the work it
serves, who the user is (background), what kinds of sources they'll add, and how to set up
categories, then record the result. When ingesting a source, discuss key takeaways and ask
follow-up questions before writing files, then propose the page operations and wait for the
user's confirmation. Confirm before destructive actions (reset). The wiki pages you write
are rendered live by Quartz in a side panel, so keep the wiki tidy and well cross-linked.

===== ANTIGRAVITY.md =====
${antigravityMd}

===== onboard 스킬 =====
${onboard}

===== ingest 스킬 =====
${ingest}

===== reset 스킬 =====
${reset}
`.trim();
    }

    const q = query({
      prompt: input.message,
      options: {
        cwd: REPO_ROOT,
        model: this.cfg.claude?.model,
        settingSources: ["project", "local"], // load CLAUDE.md + .claude/skills
        systemPrompt: { type: "preset", preset: "claude_code", append: appendPrompt },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        maxTurns: 60,
        abortController: ac,
        resume: input.sessionId,
        stderr: (d) => process.env.DEBUG && console.error("[claude]", d),
      },
    });

    try {
      for await (const msg of q) {
        switch (msg.type) {
          case "system":
            if (msg.subtype === "init") yield { type: "session", sessionId: msg.session_id };
            break;
          case "stream_event": {
            const ev = msg.event as { type: string; delta?: { type: string; text?: string } };
            if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
              yield { type: "text", delta: ev.delta.text ?? "" };
            }
            break;
          }
          case "assistant": {
            for (const block of msg.message.content as Array<Record<string, unknown>>) {
              if (block.type === "tool_use") {
                yield {
                  type: "tool",
                  name: block.name as string,
                  summary: summarizeTool(block.name as string, block.input as Record<string, unknown>),
                };
              }
            }
            break;
          }
          case "result": {
            const cost = (msg as { total_cost_usd?: number }).total_cost_usd;
            yield { type: "done", sessionId: msg.session_id, costUsd: cost };
            break;
          }
        }
      }
    } catch (err) {
      if (ac.signal.aborted) return; // client disconnected — silent
      yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }
}
