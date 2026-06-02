import { useEffect, useRef, useState } from "preact/hooks";
import { streamChat, ingestUrl, ingestPdf, getSettings, putSettings, resetWiki, authStatus, logout, type ChatEvent } from "./api.ts";
import { Settings } from "./Settings.tsx";
import { Editor } from "./Editor.tsx";
import { Login } from "./Login.tsx";
import { Icon } from "./Icon.tsx";

interface Msg { role: "user" | "assistant"; text: string; tools: string[]; error?: string }

const PROVIDER_LABEL: Record<string, string> = {
  "claude-code": "Claude Code",
  antigravity: "Antigravity",
  openai: "Codex",
};

// Wiki site: same-origin /wiki in production (single-origin tunnel mode),
// the live Quartz serve on :8080 in dev. Overridable via VITE_WIKI_SITE_URL.
const SITE_URL =
  import.meta.env.VITE_WIKI_SITE_URL ??
  (import.meta.env.PROD ? "/wiki/" : `http://${location.hostname}:8080`);

export function App() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [input, setInput] = useState("");
  const [url, setUrl] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [provider, setProvider] = useState("claude-code");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [tab, setTab] = useState<"site" | "editor">("site");
  const [iframeKey, setIframeKey] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [auth, setAuth] = useState({ required: false, authed: true, loaded: false });
  const [chatOpen, setChatOpen] = useState(false); // 초기 화면은 채팅 없이 위키만
  const [leftW, setLeftW] = useState<number>(() => {
    const v = Number(localStorage.getItem("chatWidthPct"));
    return v >= 22 && v <= 72 ? v : 42; // 채팅 패널 너비(%) — 드래그로 조절, 저장
  });
  const [resizing, setResizing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<(t: string) => void>(() => {});
  const mainRef = useRef<HTMLDivElement>(null);
  const refreshTimer = useRef<number | undefined>(undefined);

  useEffect(() => { getSettings().then((c) => setProvider(c.provider)); }, []);
  useEffect(() => { threadRef.current?.scrollTo(0, threadRef.current.scrollHeight); }, [messages]);
  useEffect(() => {
    authStatus()
      .then((s) => setAuth({ required: s.authRequired, authed: s.authed, loaded: true }))
      .catch(() => setAuth({ required: false, authed: true, loaded: true }));
  }, []);

  // 임베드된 위키 페이지(iframe)의 채팅 바에서 온 메시지 처리
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.source !== "llm-wiki-chat") return;
      if (d.type === "ask" && d.text) {
        setChatOpen(true); // 위키 채팅바에서 보내면 채팅 패널을 연다
        sendRef.current(d.title ? `(위키 「${d.title}」 페이지에 관하여) ${d.text}` : d.text);
      } else if (d.type === "focus") {
        setChatOpen(true);
        setTimeout(() => composerRef.current?.focus(), 60);
        if (d.title) setInput((prev) => prev || `(위키 「${d.title}」 페이지에 관하여) `);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // 새 탭의 위키에서 ?ask=/?page= 로 넘어온 경우 시드
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const ask = p.get("ask");
    const page = p.get("page");
    if (ask) {
      setChatOpen(true);
      sendRef.current(page ? `(위키 「${page}」 페이지에 관하여) ${ask}` : ask);
      history.replaceState({}, "", location.pathname);
    } else if (page) {
      setChatOpen(true);
      setInput(`(위키 「${page}」 페이지에 관하여) `);
      setTimeout(() => composerRef.current?.focus(), 60);
      history.replaceState({}, "", location.pathname);
    }
  }, []);

  // 위키 패널을 즉시 다시 로드한다(수동 새로고침·리셋 등 명시적 동작에만).
  const refreshNow = () => {
    if (refreshTimer.current) { clearTimeout(refreshTimer.current); refreshTimer.current = undefined; }
    setIframeKey((k) => k + 1);
  };
  // 채팅 한 턴이 끝난 뒤의 자동 갱신. 개발 모드에선 Quartz serve가 자체 라이브
  // 리로드(디바운스 + 소프트 morph)를 푸시하므로 우리가 다시 iframe을 리마운트하지
  // 않는다 — 추가 깜빡임과 스크롤 점프를 막는다. 운영(정적 /wiki 빌드)에선 서버
  // 리빌드가 끝날 즈음 한 번만 갱신하도록 넉넉히 디바운스한다.
  const scheduleRefresh = () => {
    if (!import.meta.env.PROD) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => setIframeKey((k) => k + 1), 3000);
  };
  // 드래그로 채팅·위키 패널 너비 조절
  function startResize(e: PointerEvent) {
    e.preventDefault();
    setResizing(true);
    let latest = leftW;
    const move = (ev: PointerEvent) => {
      const rect = mainRef.current?.getBoundingClientRect();
      if (!rect) return;
      latest = Math.max(22, Math.min(72, ((ev.clientX - rect.left) / rect.width) * 100));
      setLeftW(latest);
    };
    const up = () => {
      setResizing(false);
      localStorage.setItem("chatWidthPct", String(Math.round(latest)));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  const openChat = () => {
    setChatOpen(true);
    setTimeout(() => composerRef.current?.focus(), 60);
  };
  const patchLast = (fn: (m: Msg) => Msg) =>
    setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)));

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    setMessages((prev) => [...prev, { role: "user", text, tools: [] }, { role: "assistant", text: "", tools: [] }]);
    setStreaming(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const onEvent = (ev: ChatEvent) => {
      if (ev.type === "session") setSessionId(ev.sessionId);
      else if (ev.type === "text") patchLast((m) => ({ ...m, text: m.text + ev.delta }));
      else if (ev.type === "tool") patchLast((m) => ({ ...m, tools: [...m.tools, ev.summary] }));
      else if (ev.type === "error") patchLast((m) => ({ ...m, error: ev.message }));
      else if (ev.type === "done") { if (ev.sessionId) setSessionId(ev.sessionId); }
    };
    try {
      await streamChat(text, sessionId, onEvent, ac.signal);
    } catch (e) {
      patchLast((m) => ({ ...m, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setStreaming(false);
      abortRef.current = null;
      scheduleRefresh();
    }
  }
  sendRef.current = send; // 항상 최신 send 참조 (메시지 리스너의 stale closure 방지)

  function onSubmit() {
    const t = input.trim();
    if (!t) return;
    setInput("");
    send(t);
  }

  async function addUrl() {
    const u = url.trim();
    if (!u) return;
    setUrl("");
    setMessages((prev) => [...prev, { role: "user", text: `URL 추가 — ${u}`, tools: [] }]);
    try {
      const staged = await ingestUrl(u);
      await send(`다음 자료를 ingest 스킬에 따라 정리해줘: \`${staged.path}\` (제목: ${staged.title}, 원본 URL: ${u})`);
    } catch (e) {
      setMessages((prev) => [...prev, { role: "assistant", text: "", tools: [], error: e instanceof Error ? e.message : String(e) }]);
    }
  }

  async function addPdfs(files: File[]) {
    const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", text: `PDF ${pdfs.length}개 추가 — ${pdfs.map((f) => f.name).join(", ")}`, tools: [] },
    ]);
    try {
      const staged = await Promise.all(pdfs.map((f) => ingestPdf(f)));
      const list = staged.map((s) => `\`${s.path}\``).join(", ");
      const many = staged.length > 1;
      await send(
        `다음 PDF 자료${many ? "들" : ""}을 ingest 스킬에 따라 ${many ? "하나씩 순서대로 " : ""}정리해줘: ${list}`,
      );
    } catch (e) {
      setMessages((prev) => [...prev, { role: "assistant", text: "", tools: [], error: e instanceof Error ? e.message : String(e) }]);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) addPdfs(files);
  }

  async function doReset() {
    setResetOpen(false);
    const r = await resetWiki();
    setMessages([]);
    setSessionId(undefined);
    refreshNow();
    if (r.ok) setMessages([{ role: "assistant", text: "위키를 초기 상태로 되돌렸습니다.", tools: [] }]);
  }

  if (!auth.loaded)
    return (
      <div class="login-screen">
        <div class="login-card"><p class="muted">로딩 중…</p></div>
      </div>
    );
  if (auth.required && !auth.authed)
    return <Login onAuthed={() => setAuth((a) => ({ ...a, authed: true }))} />;

  return (
    <div class="app">
      <header class="header">
        <h1><Icon name="brand" size={17} />LLM Wiki</h1>
        <span class="badge">{PROVIDER_LABEL[provider] ?? provider}</span>
        <div class="spacer" />
        <button class={chatOpen ? "active" : "primary"} onClick={() => (chatOpen ? setChatOpen(false) : openChat())}>
          <Icon name="chat" />{chatOpen ? "채팅 닫기" : "채팅"}
        </button>
        <button onClick={() => setSettingsOpen(true)}><Icon name="settings" />설정</button>
        <button class="danger" onClick={() => setResetOpen(true)}><Icon name="trash" />리셋</button>
        {auth.required && (
          <button onClick={async () => { await logout(); setAuth((a) => ({ ...a, authed: false })); }}><Icon name="logout" />로그아웃</button>
        )}
      </header>

      <div class={"main" + (resizing ? " resizing" : "")} ref={mainRef}>
        {/* LEFT — chat (초기엔 닫혀 있음; 헤더 버튼이나 위키 채팅바로 연다) */}
        {chatOpen && (
        <section class="left" style={`width:${leftW}%`}>
          <div class="chat-head">
            <span class="label"><Icon name="chat" size={15} />채팅</span>
            <select
              value={provider}
              onChange={async (e) => {
                const next = (e.target as HTMLSelectElement).value;
                setProvider(next);
                setSessionId(undefined); // Clear session to start fresh on provider change
                const current = await getSettings();
                await putSettings({ ...current, provider: next });
              }}
              style="margin-left: 8px; font-size: 11px; padding: 2px 4px; border-radius: 4px; background: var(--lightgray); border: 1px solid var(--lightgray); color: var(--darkgray); cursor: pointer; outline: none; font-weight: 500;"
            >
              {Object.entries(PROVIDER_LABEL).map(([k, v]) => (
                <option value={k}>{v}</option>
              ))}
            </select>
            <div style="flex:1" />
            <button onClick={() => setChatOpen(false)} title="채팅 닫기"><Icon name="close" />닫기</button>
          </div>
          <div class="thread" ref={threadRef}>
            {messages.length === 0 && (
              <div class="empty">
                자료(URL·PDF)를 추가하면 에이전트가 읽고, 꼬리 질문으로 함께 위키를 만들어 줍니다.
                <br /><br />아래에 URL을 붙여넣거나 PDF를 끌어다 놓으세요.
              </div>
            )}
            {messages.map((m) => (
              <div class={"msg " + m.role}>
                {m.text && <div class="bubble">{m.text}</div>}
                {m.tools.length > 0 && (
                  <div class="tools">{m.tools.map((t) => <span class="chip">{t}</span>)}</div>
                )}
                {m.error && <div class="err"><Icon name="alert" size={14} />{m.error}</div>}
                {!m.text && !m.error && m.role === "assistant" && streaming && <div class="bubble muted">…</div>}
              </div>
            ))}
          </div>

          <div
            class={"composer" + (dragging ? " drag" : "")}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <div class="srcrow">
              <input
                placeholder="자료 URL 붙여넣기…"
                value={url}
                onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => e.key === "Enter" && addUrl()}
              />
              <button onClick={addUrl} disabled={streaming}><Icon name="link" />URL</button>
              <button onClick={() => fileInputRef.current?.click()} disabled={streaming}><Icon name="paperclip" />PDF</button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                multiple
                style="display:none"
                onChange={(e) => {
                  const fs = Array.from((e.target as HTMLInputElement).files ?? []);
                  (e.target as HTMLInputElement).value = "";
                  if (fs.length) addPdfs(fs);
                }}
              />
            </div>
            <div class="row">
              <textarea
                ref={composerRef}
                placeholder="메시지를 입력하세요… (Enter 전송, Shift+Enter 줄바꿈)"
                value={input}
                onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
              />
              {streaming ? (
                <button class="danger" onClick={() => abortRef.current?.abort()}><Icon name="stop" />중지</button>
              ) : (
                <button class="primary" onClick={onSubmit}><Icon name="send" />전송</button>
              )}
            </div>
            <div class="hint">PDF는 여러 개를 한 번에 끌어다 놓거나 "+ PDF"로 선택할 수 있습니다. 위키는 오른쪽에서 실시간 갱신됩니다.</div>
          </div>
        </section>
        )}
        {chatOpen && (
          <div class="gutter" onPointerDown={startResize} title="드래그하여 채팅·위키 너비 조절" />
        )}

        {/* RIGHT — site / editor */}
        <section class="right">
          <div class="tabs">
            <button class={tab === "site" ? "active" : ""} onClick={() => setTab("site")}><Icon name="wiki" />위키</button>
            <button class={tab === "editor" ? "active" : ""} onClick={() => setTab("editor")}><Icon name="editor" />편집기</button>
            <div class="spacer" style="flex:1" />
            {tab === "site" && <button onClick={refreshNow} title="새로고침"><Icon name="refresh" />새로고침</button>}
            <a href={SITE_URL} target="_blank" rel="noreferrer"><button><Icon name="external" />새 탭</button></a>
          </div>
          <div class="pane">
            {tab === "site" ? (
              <iframe key={iframeKey} class="site" src={SITE_URL} title="wiki" />
            ) : (
              <Editor onSaved={scheduleRefresh} />
            )}
          </div>
        </section>
      </div>

      {settingsOpen && (
        <Settings onClose={() => setSettingsOpen(false)} onSaved={(p) => setProvider(p)} />
      )}
      {resetOpen && (
        <div class="overlay" onClick={() => setResetOpen(false)}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <h2>위키 초기화</h2>
            <p>모든 위키 페이지와 ingest한 자료(raw/clips, raw/uploads)가 삭제되고 빈 스켈레톤으로 복원됩니다. 되돌릴 수 없습니다.</p>
            <div class="actions">
              <button onClick={() => setResetOpen(false)}>취소</button>
              <button class="danger" onClick={doReset}>초기화</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
