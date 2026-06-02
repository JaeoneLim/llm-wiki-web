import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { loadConfig, saveConfig } from "./config.ts";
import type { AppConfig } from "./types.ts";

export const SESSION_COOKIE = "wiki_sess";
const SESSION_VALUE = "ok";

/** scrypt hash → "salt:hash" hex. */
function hashPassword(password: string, salt = randomBytes(16).toString("hex")): { salt: string; hash: string } {
  const hash = scryptSync(password, salt, 32).toString("hex");
  return { salt, hash };
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Whether a password gate is active (env var or stored hash). */
export function authRequired(cfg: AppConfig): boolean {
  return Boolean(process.env.WIKI_PASSWORD || cfg.auth?.passwordHash);
}

/** Verify a candidate password against the env var (priority) or stored hash. */
export function verifyPassword(cfg: AppConfig, candidate: string): boolean {
  const envPw = process.env.WIKI_PASSWORD;
  if (envPw) {
    const a = Buffer.from(candidate);
    const b = Buffer.from(envPw);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  if (cfg.auth?.passwordHash && cfg.auth.salt) {
    const { hash } = hashPassword(candidate, cfg.auth.salt);
    return safeEqualHex(hash, cfg.auth.passwordHash);
  }
  return false;
}

/** Whether the password is locked to the env var (cannot change via API). */
export function passwordFromEnv(): boolean {
  return Boolean(process.env.WIKI_PASSWORD);
}

/**
 * Set or clear the stored password. `next === ""` clears it (disables the gate).
 * Returns the updated config (already persisted).
 */
export async function setStoredPassword(next: string): Promise<AppConfig> {
  const cfg = await loadConfig();
  cfg.auth = cfg.auth ?? {};
  if (next === "") {
    delete cfg.auth.passwordHash;
    delete cfg.auth.salt;
  } else {
    const { salt, hash } = hashPassword(next);
    cfg.auth.salt = salt;
    cfg.auth.passwordHash = hash;
  }
  await saveConfig(cfg);
  return cfg;
}

/** Stable session-cookie signing secret; generated and persisted on first use. */
export async function getSessionSecret(): Promise<string> {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const cfg = await loadConfig();
  if (cfg.auth?.sessionSecret) return cfg.auth.sessionSecret;
  const secret = randomBytes(32).toString("hex");
  cfg.auth = { ...(cfg.auth ?? {}), sessionSecret: secret };
  await saveConfig(cfg);
  return secret;
}

export const sessionCookieValue = SESSION_VALUE;
