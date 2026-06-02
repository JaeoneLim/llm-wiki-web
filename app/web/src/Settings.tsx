import { useEffect, useState } from "preact/hooks";
import { getSettings, putSettings, setAppPassword } from "./api.ts";

type Provider = "claude-code" | "antigravity" | "openai" | "gemini" | "openai-compatible";

// 선택 가능한 프로바이더(노출 순서). Gemini는 Antigravity CLI로 대체, 오픈 모델은
// 미지원이라 목록에서 제외한다. 내부적으로 Antigravity는 Gemini 키를 폴백 판단에 쓴다.
const LABELS: Record<"claude-code" | "antigravity" | "openai", string> = {
  "claude-code": "Claude Code (구독 계정)",
  antigravity: "Antigravity CLI (로컬 환경)",
  openai: "Codex",
};

export function Settings({ onClose, onSaved }: { onClose: () => void; onSaved: (p: Provider) => void }) {
  const [provider, setProvider] = useState<Provider>("claude-code");
  const [s, setS] = useState<any>({ claude: {}, openai: {}, gemini: {}, openaiCompatible: {} });
  const [saving, setSaving] = useState(false);
  const [authCfg, setAuthCfg] = useState({ configured: false, fromEnv: false });
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");

  useEffect(() => {
    getSettings().then((cfg) => {
      setProvider(cfg.provider);
      setS({
        claude: cfg.claude ?? {},
        openai: cfg.openai ?? {},
        gemini: cfg.gemini ?? {},
        openaiCompatible: cfg.openaiCompatible ?? {},
      });
      setAuthCfg(cfg.auth ?? { configured: false, fromEnv: false });
    });
  }, []);

  async function savePassword(clear: boolean) {
    setPwMsg("");
    const r = await setAppPassword(authCfg.configured ? curPw : undefined, clear ? "" : newPw);
    if (r.error) { setPwMsg(r.error); return; }
    setPwMsg(clear ? "로그인이 해제되었습니다." : "비밀번호가 저장되었습니다. 다음 접속부터 로그인이 필요합니다.");
    setAuthCfg({ configured: !clear, fromEnv: false });
    setCurPw("");
    setNewPw("");
  }

  const upd = (group: string, key: string, val: string) =>
    setS((prev: any) => ({ ...prev, [group]: { ...prev[group], [key]: val } }));

  async function save() {
    setSaving(true);
    const body: any = { provider };
    if (s.claude?.model) body.claude = { model: s.claude.model };
    body.openai = { model: s.openai?.model, apiKey: s.openai?.apiKey ?? "" };
    body.gemini = { model: s.gemini?.model, apiKey: s.gemini?.apiKey ?? "" };
    body.openaiCompatible = {
      baseURL: s.openaiCompatible?.baseURL,
      model: s.openaiCompatible?.model,
      apiKey: s.openaiCompatible?.apiKey ?? "",
    };
    await putSettings(body);
    setSaving(false);
    onSaved(provider);
    onClose();
  }

  const keyPlaceholder = (hasKey?: boolean) => (hasKey ? "설정됨 — 변경 시에만 입력" : "API 키 입력");

  return (
    <div class="overlay" onClick={onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <h2>LLM 프로바이더 설정</h2>
        <div class="field">
          <label>프로바이더</label>
          <select value={provider} onChange={(e) => setProvider((e.target as HTMLSelectElement).value as Provider)}>
            {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((p) => (
              <option value={p}>{LABELS[p]}</option>
            ))}
          </select>
        </div>

        {provider === "claude-code" && (
          <>
            <p class="muted">
              로컬 Claude Code 구독 계정을 그대로 사용합니다. 별도 API 키가 필요 없습니다. 모델은 비워두면 CLI 기본값을 씁니다.
            </p>
            <div class="field">
              <label>모델 (선택)</label>
              <input
                placeholder="예: claude-opus-4-5 (비우면 기본값)"
                value={s.claude?.model ?? ""}
                onInput={(e) => upd("claude", "model", (e.target as HTMLInputElement).value)}
              />
            </div>
          </>
        )}

        {provider === "antigravity" && (
          <>
            <p class="muted">
              로컬 Antigravity CLI 스키마 규칙을 적용해 위키를 함께 작성합니다. 레포 루트의 <code>ANTIGRAVITY.md</code>와 <code>.antigravity/skills/</code>을 로드합니다. 아래 <strong>Gemini API 키</strong>를 넣으면 Gemini로 구동하고, 비우면 로컬 Claude Code 세션을 폴백으로 사용합니다.
            </p>
            <div class="field">
              <label>Google Gemini API 키 (선택)</label>
              <input type="password" placeholder={keyPlaceholder(s.gemini?.hasKey)}
                onInput={(e) => upd("gemini", "apiKey", (e.target as HTMLInputElement).value)} />
            </div>
            <div class="field">
              <label>모델 (선택)</label>
              <input placeholder="gemini-2.0-flash" value={s.gemini?.model ?? ""}
                onInput={(e) => upd("gemini", "model", (e.target as HTMLInputElement).value)} />
            </div>
          </>
        )}

        {provider === "openai" && (
          <>
            <p class="muted">OpenAI/Codex 호환 API로 구동합니다. 전용 Codex CLI 연동은 추후 추가 예정입니다.</p>
            <div class="field">
              <label>API 키</label>
              <input type="password" placeholder={keyPlaceholder(s.openai?.hasKey)}
                onInput={(e) => upd("openai", "apiKey", (e.target as HTMLInputElement).value)} />
            </div>
            <div class="field">
              <label>모델</label>
              <input placeholder="gpt-4o" value={s.openai?.model ?? ""}
                onInput={(e) => upd("openai", "model", (e.target as HTMLInputElement).value)} />
            </div>
          </>
        )}

        <hr style="border:none;border-top:1px solid var(--lightgray);margin:14px 0" />
        <h2 style="font-size:14px">앱 로그인 비밀번호</h2>
        {authCfg.fromEnv ? (
          <p class="muted">환경변수 WIKI_PASSWORD로 설정되어 있습니다. 변경하려면 환경변수를 수정하세요.</p>
        ) : (
          <>
            <p class="muted">설정하면 챗 앱 접근 시 로그인이 필요합니다. (위키 사이트는 별도 — DEPLOY.md)</p>
            {authCfg.configured && (
              <div class="field">
                <label>현재 비밀번호</label>
                <input type="password" value={curPw} onInput={(e) => setCurPw((e.target as HTMLInputElement).value)} />
              </div>
            )}
            <div class="field">
              <label>{authCfg.configured ? "새 비밀번호" : "비밀번호 설정"}</label>
              <input
                type="password"
                placeholder={authCfg.configured ? "변경할 비밀번호" : "로그인에 사용할 비밀번호"}
                value={newPw}
                onInput={(e) => setNewPw((e.target as HTMLInputElement).value)}
              />
            </div>
            <div class="actions" style="justify-content:flex-start">
              <button class="primary" onClick={() => savePassword(false)} disabled={!newPw || (authCfg.configured && !curPw)}>
                비밀번호 저장
              </button>
              {authCfg.configured && (
                <button class="danger" onClick={() => savePassword(true)} disabled={!curPw}>로그인 해제</button>
              )}
            </div>
            {pwMsg && <p class="muted">{pwMsg}</p>}
          </>
        )}

        <div class="actions">
          <button onClick={onClose}>취소</button>
          <button class="primary" onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</button>
        </div>
      </div>
    </div>
  );
}
