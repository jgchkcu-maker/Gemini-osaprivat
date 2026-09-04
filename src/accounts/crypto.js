import crypto from "node:crypto";
import { resolveRedisCredentials } from "./redis.js";

function deriveKey(seed) {
  if (!seed || String(seed).length < 16) {
    throw new Error("Account encryption seed is missing or too short");
  }
  return crypto.createHash("sha256").update(String(seed)).digest();
}

export function getEncryptionSeed(env = process.env) {
  const explicit = env.ACCOUNT_ENCRYPTION_KEY?.trim();
  if (explicit) return explicit;
  const redis = resolveRedisCredentials(env);
  if (redis?.token) return `redis:${redis.token}`;
  throw new Error("Set ACCOUNT_ENCRYPTION_KEY or configure Upstash Redis");
}

export function encryptSecret(plaintext, seed = getEncryptionSeed()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(seed), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(value, seed = getEncryptionSeed()) {
  const [version, ivText, tagText, ciphertext] = String(value ?? "").split(".");
  if (version !== "v1" || !ivText || !tagText || !ciphertext) {
    throw new Error("Invalid encrypted account secret");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(seed), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
}
