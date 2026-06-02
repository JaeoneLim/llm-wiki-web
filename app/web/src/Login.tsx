import { useState } from "preact/hooks";
import { login } from "./api.ts";
import { Icon } from "./Icon.tsx";

export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!pw || busy) return;
    setBusy(true);
    setErr("");
    const ok = await login(pw);
    setBusy(false);
    if (ok) onAuthed();
    else setErr("비밀번호가 올바르지 않습니다.");
  }

  return (
    <div class="login-screen">
      <div class="login-card">
        <h1 class="brand"><Icon name="brand" size={20} />LLM Wiki</h1>
        <p class="muted">계속하려면 로그인하세요.</p>
        <input
          type="password"
          placeholder="비밀번호"
          value={pw}
          autoFocus
          onInput={(e) => setPw((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {err && <div class="err"><Icon name="alert" size={14} />{err}</div>}
        <button class="primary" onClick={submit} disabled={busy || !pw}>
          {busy ? "확인 중…" : "로그인"}
        </button>
      </div>
    </div>
  );
}
