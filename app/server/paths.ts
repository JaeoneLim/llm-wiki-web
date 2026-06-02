import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // app/server

/** Repo root (llm-wiki-web/). The agent operates here. */
export const REPO_ROOT = resolve(here, "..", "..");
export const APP_DIR = resolve(here, ".."); // app/

export const WIKI_DIR = join(REPO_ROOT, "wiki");
export const RAW_DIR = join(REPO_ROOT, "raw");
export const RAW_CLIPS = join(RAW_DIR, "clips");
export const RAW_UPLOADS = join(RAW_DIR, "uploads");
export const SCRIPTS_DIR = join(REPO_ROOT, "scripts");

export const WEB_DIST = join(APP_DIR, "web", "dist");
/** Quartz static build output (served at /wiki in production single-origin mode). */
export const PUBLIC_DIR = join(REPO_ROOT, "public");
/** Provider config + API keys. Gitignored. Never commit, never log values. */
export const CONFIG_PATH = join(APP_DIR, "config.json");

/** Categories under wiki/ that the editor and reset operate on. */
export const WIKI_CATEGORIES = [
  "entities",
  "concepts",
  "topics",
  "sources",
  "notes",
] as const;
