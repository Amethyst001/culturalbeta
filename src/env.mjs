import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const envFile = resolve(ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    const err = new Error(`QLOO_KEY_MISSING: ${name} is not set. Put the hackathon key in .env (see .env.example).`);
    err.code = "QLOO_KEY_MISSING";
    throw err;
  }
  return value.trim();
}
