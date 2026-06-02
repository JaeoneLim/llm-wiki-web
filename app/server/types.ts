/** Provider identifiers wired in this app. */
export type ProviderId = "claude-code" | "antigravity" | "openai" | "gemini" | "openai-compatible";

export interface AppConfig {
  provider: ProviderId;
  claude?: { model?: string };
  openai?: { apiKey?: string; model?: string };
  gemini?: { apiKey?: string; model?: string };
  openaiCompatible?: { baseURL?: string; apiKey?: string; model?: string };
  /** Single-password app gate. `WIKI_PASSWORD` env overrides the stored hash. */
  auth?: { passwordHash?: string; salt?: string; sessionSecret?: string };
}

/**
 * Unified streaming event protocol. Both the Claude Agent SDK path and the
 * Vercel AI SDK path emit this same shape, so the frontend has one renderer.
 */
export type ChatEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "error"; message: string }
  | { type: "done"; sessionId?: string; costUsd?: number };

export interface ChatRunInput {
  /** The user's message for this turn. */
  message: string;
  /** Prior session id for continuity (provider-specific). */
  sessionId?: string;
  /** Abort signal wired to the HTTP request lifecycle. */
  signal: AbortSignal;
}

/** A provider engine streams ChatEvents for one user turn. */
export interface ChatEngine {
  run(input: ChatRunInput): AsyncGenerator<ChatEvent>;
}
