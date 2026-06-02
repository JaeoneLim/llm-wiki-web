/** Mirrors the server's ChatEvent union. */
export type ChatEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "error"; message: string }
  | { type: "done"; sessionId?: string; costUsd?: number };

/** Stream a chat turn via SSE-over-fetch (POST). Calls onEvent per event. */
export async function streamChat(
  message: string,
  sessionId: string | undefined,
  onEvent: (ev: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, sessionId }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    onEvent({ type: "error", message: `서버 오류: ${resp.status}` });
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      try {
        onEvent(JSON.parse(dataLine.slice(6)) as ChatEvent);
      } catch {
        /* ignore malformed */
      }
    }
  }
}

export interface StagedSource {
  kind: "url" | "pdf";
  path: string;
  title: string;
  url?: string;
}

export async function ingestUrl(url: string): Promise<StagedSource> {
  const r = await fetch("/api/ingest/url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!r.ok) throw new Error((await r.json()).error ?? "URL ingest 실패");
  return r.json();
}

export async function ingestPdf(file: File): Promise<StagedSource> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/ingest/pdf", { method: "POST", body: fd });
  if (!r.ok) throw new Error((await r.json()).error ?? "PDF ingest 실패");
  return r.json();
}

export async function getSettings() {
  return (await fetch("/api/settings")).json();
}
export async function putSettings(body: unknown) {
  return (
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  ).json();
}

export async function listWikiFiles(): Promise<{ files: string[]; categories: string[] }> {
  return (await fetch("/api/wiki/files")).json();
}
export async function readWikiFile(path: string): Promise<{ path: string; content: string }> {
  return (await fetch(`/api/wiki/file?path=${encodeURIComponent(path)}`)).json();
}
export async function writeWikiFile(path: string, content: string) {
  return (
    await fetch("/api/wiki/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, content }),
    })
  ).json();
}

export async function resetWiki(): Promise<{ ok: boolean; summary?: unknown }> {
  return (await fetch("/api/reset", { method: "POST" })).json();
}

// ---- auth -----------------------------------------------------------------

export async function authStatus(): Promise<{ authRequired: boolean; authed: boolean; fromEnv: boolean }> {
  return (await fetch("/api/auth/status")).json();
}
export async function login(password: string): Promise<boolean> {
  const r = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return r.ok;
}
export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
export async function setAppPassword(
  current: string | undefined,
  next: string,
): Promise<{ ok?: boolean; error?: string; authConfigured?: boolean }> {
  const r = await fetch("/api/auth/set-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ current, next }),
  });
  return r.json();
}
