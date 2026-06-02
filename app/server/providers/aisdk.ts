import { streamText, type CoreMessage, type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../paths.ts";
import { makeWikiTools } from "../tools.ts";
import type { AppConfig, ChatEngine, ChatEvent, ChatRunInput, ProviderId } from "../types.ts";

/** In-memory conversation history per session (local dev; cleared on restart). */
const SESSIONS = new Map<string, CoreMessage[]>();

function buildModel(cfg: AppConfig): LanguageModel {
  switch (cfg.provider) {
    case "openai": {
      if (!cfg.openai?.apiKey) throw new Error("OpenAI API 키가 설정되지 않았습니다 (설정 패널).");
      return createOpenAI({ apiKey: cfg.openai.apiKey })(cfg.openai.model || "gpt-4o");
    }
    case "gemini":
    case "antigravity": {
      if (!cfg.gemini?.apiKey) throw new Error("Google Gemini API 키가 설정되지 않았습니다 (설정 패널).");
      return createGoogleGenerativeAI({ apiKey: cfg.gemini.apiKey })(
        cfg.gemini.model || "gemini-2.0-flash",
      );
    }
    case "openai-compatible": {
      const c = cfg.openaiCompatible;
      if (!c?.baseURL) throw new Error("오픈 모델 baseURL이 설정되지 않았습니다 (설정 패널).");
      if (!c.model) throw new Error("오픈 모델 model 이름이 설정되지 않았습니다 (설정 패널).");
      return createOpenAICompatible({ name: "open", baseURL: c.baseURL, apiKey: c.apiKey })(c.model);
    }
    default:
      throw new Error(`지원하지 않는 프로바이더: ${cfg.provider}`);
  }
}

const cachedSystemPrompts = new Map<ProviderId, string>();
async function buildSystemPrompt(provider: ProviderId): Promise<string> {
  if (cachedSystemPrompts.has(provider)) return cachedSystemPrompts.get(provider)!;
  const read = async (p: string) => (existsSync(join(REPO_ROOT, p)) ? readFile(join(REPO_ROOT, p), "utf8") : "");
  
  let system: string;
  if (provider === "antigravity") {
    const antigravityMd = await read("ANTIGRAVITY.md");
    const onboard = await read(".antigravity/skills/onboard/SKILL.md");
    const ingest = await read(".antigravity/skills/ingest/SKILL.md");
    const reset = await read(".antigravity/skills/reset/SKILL.md");
    system = [
      "너는 이 LLM 위키의 관리자 Antigravity다. 웹 채팅 UI를 통해 사용자와 대화하며 위키를 함께 만든다.",
      "아래 스키마(ANTIGRAVITY.md)와 onboard/ingest/reset 스킬을 반드시 따른다. 한국어로, 간결하게 답한다.",
      "위키가 비어 있으면(콘텐츠 페이지 없음 + wiki/notes/about-this-wiki.md 없음) 곧바로 ingest하지 말고,",
      "먼저 온보딩 인터뷰를 진행한다(onboard 스킬, ANTIGRAVITY.md §12): 위키의 목적·쓸 업무·사용자의 인물(지식 배경)·",
      "넣을 자료 종류·카테고리 구성을 대화로 묻고 그 결과를 about 페이지·index.md·log.md에 기록한다.",
      "자료를 ingest할 때는 먼저 핵심을 논의하고 꼬리 질문을 한 뒤, 만들/고칠 페이지를 번호로 제안하고",
      "사용자 확인을 받은 다음에 도구로 파일을 쓴다. 초기화(reset)는 사용자가 명시적으로 동의할 때만 한다.",
      "제공된 도구로 파일을 읽고/쓰고, URL을 가져오고, PDF를 읽고, 위키를 초기화할 수 있다.",
      "위키 페이지는 Quartz가 옆 패널에 실시간 렌더링하므로 교차 링크([[slug]])를 잘 단다.",
      "\n\n===== ANTIGRAVITY.md =====\n" + antigravityMd,
      "\n\n===== onboard 스킬 =====\n" + onboard,
      "\n\n===== ingest 스킬 =====\n" + ingest,
      "\n\n===== reset 스킬 =====\n" + reset,
    ].join("\n");
  } else {
    const claudeMd = await read("CLAUDE.md");
    const onboard = await read(".claude/skills/onboard/SKILL.md");
    const ingest = await read(".claude/skills/ingest/SKILL.md");
    const reset = await read(".claude/skills/reset/SKILL.md");
    system = [
      "너는 이 LLM 위키의 관리자다. 웹 채팅 UI를 통해 사용자와 대화하며 위키를 함께 만든다.",
      "아래 스키마(CLAUDE.md)와 onboard/ingest/reset 스킬을 반드시 따른다. 한국어로, 간결하게 답한다.",
      "위키가 비어 있으면(콘텐츠 페이지 없음 + wiki/notes/about-this-wiki.md 없음) 곧바로 ingest하지 말고,",
      "먼저 온보딩 인터뷰를 진행한다(onboard 스킬, CLAUDE.md §12): 위키의 목적·쓸 업무·사용자의 인물(지식 배경)·",
      "넣을 자료 종류·카테고리 구성을 대화로 묻고 그 결과를 about 페이지·index.md·log.md에 기록한다.",
      "자료를 ingest할 때는 먼저 핵심을 논의하고 꼬리 질문을 한 뒤, 만들/고칠 페이지를 번호로 제안하고",
      "사용자 확인을 받은 다음에 도구로 파일을 쓴다. 초기화(reset)는 사용자가 명시적으로 동의할 때만 한다.",
      "제공된 도구로 파일을 읽고/쓰고, URL을 가져오고, PDF를 읽고, 위키를 초기화할 수 있다.",
      "위키 페이지는 Quartz가 옆 패널에 실시간 렌더링하므로 교차 링크([[slug]])를 잘 단다.",
      "\n\n===== CLAUDE.md =====\n" + claudeMd,
      "\n\n===== onboard 스킬 =====\n" + onboard,
      "\n\n===== ingest 스킬 =====\n" + ingest,
      "\n\n===== reset 스킬 =====\n" + reset,
    ].join("\n");
  }

  cachedSystemPrompts.set(provider, system);
  return system;
}

function summarizeTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "write_wiki_page":
      return `작성 ${args.path ?? ""}`.trim();
    case "read_file":
      return `읽기 ${args.path ?? ""}`.trim();
    case "read_pdf":
      return `PDF ${args.path ?? ""}`.trim();
    case "fetch_url":
      return `가져오기 ${args.url ?? ""}`.trim();
    case "list_wiki":
      return "위키 목록";
    case "append_log":
      return "로그 추가";
    case "reset_wiki":
      return "위키 초기화";
    default:
      return name;
  }
}

export class AiSdkEngine implements ChatEngine {
  constructor(private cfg: AppConfig) {}

  async *run(input: ChatRunInput): AsyncGenerator<ChatEvent> {
    let model: LanguageModel;
    try {
      model = buildModel(this.cfg);
    } catch (e) {
      yield { type: "error", message: e instanceof Error ? e.message : String(e) };
      return;
    }

    const sessionId = input.sessionId && SESSIONS.has(input.sessionId) ? input.sessionId : randomUUID();
    const history = SESSIONS.get(sessionId) ?? [];
    history.push({ role: "user", content: input.message });
    yield { type: "session", sessionId };

    const system = await buildSystemPrompt(this.cfg.provider);
    const tools = makeWikiTools(() => {}); // chips come from the stream's tool-call parts

    let responseMessages: CoreMessage[] = [];
    const result = streamText({
      model,
      system,
      messages: history,
      tools,
      maxSteps: 24,
      abortSignal: input.signal,
      onFinish: ({ response }) => {
        responseMessages = response.messages as CoreMessage[];
      },
    });

    try {
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          yield { type: "text", delta: part.textDelta };
        } else if (part.type === "tool-call") {
          yield {
            type: "tool",
            name: part.toolName,
            summary: summarizeTool(part.toolName, part.args as Record<string, unknown>),
          };
        } else if (part.type === "error") {
          const err = part.error;
          yield { type: "error", message: err instanceof Error ? err.message : String(err) };
        }
      }
    } catch (e) {
      if (input.signal.aborted) return;
      yield { type: "error", message: e instanceof Error ? e.message : String(e) };
      return;
    }

    history.push(...responseMessages);
    SESSIONS.set(sessionId, history);
    yield { type: "done", sessionId };
  }
}
