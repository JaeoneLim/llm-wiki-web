/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Wiki site URL override. Defaults to /wiki (prod) or :8080 (dev). */
  readonly VITE_WIKI_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
