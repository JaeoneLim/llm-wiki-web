#!/usr/bin/env node
/**
 * reset.mjs — 위키를 초기 빈 상태로 되돌린다 (개발/테스트용).
 *
 * 수행 내용:
 *   - wiki/{entities,concepts,topics,sources,notes}/ 의 모든 페이지 삭제 (.gitkeep 보존)
 *   - raw/clips/, raw/uploads/ 의 모든 자료 삭제 (.gitkeep 보존)
 *   - index.md, log.md, glossary.md 를 seed/ 의 baseline 으로 복원
 *
 * 멱등하다 — 여러 번 실행해도 안전하다. 삭제/복원 내역을 출력한다.
 *
 * 사용: `npm run reset` 또는 `node scripts/reset.mjs`
 * 백엔드는 이 스크립트를 POST /api/reset 과 reset 스킬에서 호출한다.
 */
import { readdir, rm, copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const WIKI_ROOT = join(ROOT, "wiki");
const CATEGORIES = ["entities", "concepts", "topics", "sources", "notes"];
const WIKI_DIRS = CATEGORIES.map((d) => join(WIKI_ROOT, d));
const RAW_DIRS = [join(ROOT, "raw", "clips"), join(ROOT, "raw", "uploads")];
const SEED_FILES = ["index.md", "log.md", "glossary.md"];

/** 디렉토리 내 .gitkeep 을 제외한 모든 항목을 삭제. 디렉토리가 없으면 만든다. */
async function emptyDir(dir) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".gitkeep"), "");
    return 0;
  }
  const entries = await readdir(dir);
  let removed = 0;
  for (const name of entries) {
    if (name === ".gitkeep") continue;
    await rm(join(dir, name), { recursive: true, force: true });
    removed++;
  }
  // .gitkeep 보장
  if (!existsSync(join(dir, ".gitkeep"))) await writeFile(join(dir, ".gitkeep"), "");
  return removed;
}

async function main() {
  const summary = { removedPages: 0, removedSources: 0, restored: [] };

  for (const dir of WIKI_DIRS) {
    summary.removedPages += await emptyDir(dir);
  }
  // wiki/ 최상위의 stray 항목 제거 — 에이전트가 잘못 만든 wiki/index.md 등.
  // 정식 index.md/log.md/glossary.md 는 레포 루트에 있으며 seed 에서 복원된다.
  if (existsSync(WIKI_ROOT)) {
    for (const name of await readdir(WIKI_ROOT)) {
      if (CATEGORIES.includes(name) || name === ".gitkeep") continue;
      await rm(join(WIKI_ROOT, name), { recursive: true, force: true });
      summary.removedPages++;
    }
  }
  for (const dir of RAW_DIRS) {
    summary.removedSources += await emptyDir(dir);
  }

  // seed/ baseline 복원
  for (const file of SEED_FILES) {
    const src = join(ROOT, "seed", file);
    const dst = join(ROOT, file);
    if (existsSync(src)) {
      await copyFile(src, dst);
      summary.restored.push(file);
    }
  }

  console.log("✅ 위키를 초기 상태로 되돌렸습니다.");
  console.log(`   - 삭제된 위키 페이지: ${summary.removedPages}`);
  console.log(`   - 삭제된 자료(raw): ${summary.removedSources}`);
  console.log(`   - 복원된 파일: ${summary.restored.join(", ") || "(없음)"}`);

  // 백엔드가 파싱할 수 있도록 JSON 한 줄도 출력
  console.log("RESET_RESULT " + JSON.stringify(summary));
  return summary;
}

main().catch((err) => {
  console.error("리셋 실패:", err);
  process.exit(1);
});
