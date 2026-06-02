/**
 * SAFE auth/streaming smoke test for the Claude Agent SDK.
 * No tools, no bypass, plan mode → pure text generation. Verifies that the SDK
 * reuses the local Claude Code subscription credentials and streams deltas.
 * Run: npx tsx server/smoke-auth.ts
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), 60_000);

let text = "";
let sessionId = "";
let model = "";
let apiKeySource = "";
let errored = "";

const q = query({
  prompt: "한 문장으로 한국어 인사만 해줘. 어떤 도구도 쓰지 마.",
  options: {
    settingSources: [], // isolation: don't load CLAUDE.md/skills for this test
    systemPrompt: "You are a friendly assistant. Reply in one short Korean sentence.",
    permissionMode: "plan", // no tool execution
    includePartialMessages: true,
    maxTurns: 2,
    abortController: ac,
  },
});

for await (const msg of q) {
  if (msg.type === "system" && msg.subtype === "init") {
    sessionId = msg.session_id;
    model = msg.model;
    apiKeySource = msg.apiKeySource;
  } else if (msg.type === "stream_event") {
    const ev = msg.event as { type: string; delta?: { type: string; text?: string } };
    if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
      text += ev.delta.text ?? "";
    }
  } else if (msg.type === "assistant" && msg.error) {
    errored = msg.error;
  }
}
clearTimeout(timer);

console.log("===== 결과 =====");
console.log("model:", model);
console.log("apiKeySource:", apiKeySource);
console.log("session_id:", sessionId);
console.log("응답:", text.trim() || "(비어 있음)");
if (errored) {
  console.error("❌ 인증/응답 에러:", errored);
  process.exit(1);
}
if (!text.trim()) {
  console.error("❌ 응답이 비어 있음");
  process.exit(2);
}
console.log("✅ 구독 자격증명 재사용 + 스트리밍 확인");
