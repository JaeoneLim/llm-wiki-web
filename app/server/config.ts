import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { CONFIG_PATH } from "./paths.ts";
import type { AppConfig, ProviderId } from "./types.ts";

const DEFAULT_CONFIG: AppConfig = { provider: "claude-code" };

export async function loadConfig(): Promise<AppConfig> {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as AppConfig) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(next: AppConfig): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
}

/**
 * Redact secrets for sending config to the browser. Replaces present API keys
 * with a boolean `hasKey` flag so the UI can show "key set" without exposing it.
 */
export function redactConfig(cfg: AppConfig) {
  const mask = (k?: { apiKey?: string; [x: string]: unknown }) =>
    k ? { ...k, apiKey: undefined, hasKey: Boolean(k.apiKey) } : undefined;
  return {
    provider: cfg.provider,
    claude: cfg.claude ?? {},
    openai: mask(cfg.openai),
    gemini: mask(cfg.gemini),
    openaiCompatible: mask(cfg.openaiCompatible),
    auth: {
      configured: Boolean(process.env.WIKI_PASSWORD || cfg.auth?.passwordHash),
      fromEnv: Boolean(process.env.WIKI_PASSWORD),
    },
  };
}

/**
 * Merge an incoming (possibly redacted) config update into the stored config.
 * Empty-string apiKey means "leave unchanged"; a non-empty one replaces it.
 */
export function mergeConfig(current: AppConfig, incoming: Partial<AppConfig>): AppConfig {
  const next: AppConfig = { ...current };
  if (incoming.provider) next.provider = incoming.provider as ProviderId;
  for (const key of ["openai", "gemini", "openaiCompatible", "claude"] as const) {
    const inc = incoming[key] as Record<string, string> | undefined;
    if (!inc) continue;
    const cur = (current[key] as Record<string, string>) ?? {};
    const merged: Record<string, string> = { ...cur };
    for (const [k, v] of Object.entries(inc)) {
      if (k === "apiKey" && (v === "" || v == null)) continue; // keep existing key
      if (v != null) merged[k] = v;
    }
    (next as unknown as Record<string, unknown>)[key] = merged;
  }
  return next;
}
