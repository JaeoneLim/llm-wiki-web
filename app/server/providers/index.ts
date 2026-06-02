import type { AppConfig, ChatEngine } from "../types.ts";
import { ClaudeEngine } from "./claude.ts";
import { AiSdkEngine } from "./aisdk.ts";

/** Pick a chat engine for the configured provider. */
export function makeEngine(cfg: AppConfig): ChatEngine {
  switch (cfg.provider) {
    case "claude-code":
      return new ClaudeEngine(cfg);
    case "antigravity":
      if (cfg.gemini?.apiKey) {
        return new AiSdkEngine(cfg);
      }
      return new ClaudeEngine(cfg);
    case "openai":
    case "gemini":
    case "openai-compatible":
      return new AiSdkEngine(cfg);
    default:
      return new ClaudeEngine(cfg);
  }
}
