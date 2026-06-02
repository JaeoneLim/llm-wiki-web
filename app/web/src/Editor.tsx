import { useEffect, useState } from "preact/hooks";
import { listWikiFiles, readWikiFile, writeWikiFile } from "./api.ts";
import { Icon } from "./Icon.tsx";

export function Editor({ onSaved }: { onSaved: () => void }) {
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = () => listWikiFiles().then((r) => setFiles(r.files));
  useEffect(() => { refresh(); }, []);

  async function open(path: string) {
    if (dirty && !confirm("저장하지 않은 변경이 있습니다. 버릴까요?")) return;
    const f = await readWikiFile(path);
    setActive(path);
    setContent(f.content);
    setDirty(false);
  }

  async function save() {
    if (!active) return;
    setSaving(true);
    await writeWikiFile(active, content);
    setSaving(false);
    setDirty(false);
    onSaved(); // refresh the site iframe
    refresh();
  }

  return (
    <div class="editor">
      <div class="filelist">
        <button style="width:100%;margin-bottom:6px;justify-content:center" onClick={refresh}><Icon name="refresh" />새로고침</button>
        {files.length === 0 && <p class="muted" style="padding:6px">아직 위키 페이지가 없습니다.</p>}
        {files.map((f) => (
          <div class={"f" + (f === active ? " active" : "")} onClick={() => open(f)}>{f.replace(/^wiki\//, "")}</div>
        ))}
      </div>
      <div class="editpane">
        {active ? (
          <>
            <div class="bar">
              <span class="path">{active}</span>
              {dirty && <span class="muted dirty"><span class="dot" />변경됨</span>}
              <button class="primary" onClick={save} disabled={saving || !dirty}>
                {saving ? "저장 중…" : "저장 (⌘S)"}
              </button>
            </div>
            <textarea
              value={content}
              onInput={(e) => { setContent((e.target as HTMLTextAreaElement).value); setDirty(true); }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
              }}
            />
          </>
        ) : (
          <p class="muted" style="margin:auto">왼쪽에서 편집할 위키 페이지를 선택하세요.</p>
        )}
      </div>
    </div>
  );
}
