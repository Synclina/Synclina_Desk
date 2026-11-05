import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Secrets are stored as "scrypt:<log2 N>:<r>:<p>:<salt>:<hash>" (base64url, no "$",
 * which .env files would try to expand). Keep this file free of imports from the
 * app: the setup script and the tests load it directly.
 */
const KEY_LENGTH = 32;

function derive(secret: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  const N = 2 ** logN;
  return new Promise((resolve, reject) => {
    scrypt(secret.normalize("NFKC"), salt, KEY_LENGTH, { N, r, p, maxmem: 256 * N * r }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashSecret(secret: string, logN = 17): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(secret, salt, logN, 8, 1);
  return ["scrypt", logN, 8, 1, salt.toString("base64url"), key.toString("base64url")].join(":");
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [kind, logN, r, p, salt, key] = stored.split(":");
  if (kind !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await derive(secret, Buffer.from(salt, "base64url"), Number(logN), Number(r), Number(p));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const newToken = () => randomBytes(32).toString("base64url");

export const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a));
  const y = Buffer.from(sha256(b));
  return timingSafeEqual(x, y);
}

/** A one-time recovery code such as "7K2QM-9XRT4". */
export function newRecoveryCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  const text = Array.from(bytes, (b) => chars[b % chars.length]).join("");
  return `${text.slice(0, 5)}-${text.slice(5)}`;
}

export const normalizeRecoveryCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");

/** A person's record is named by a hash of their email, which also keeps emails unique. */
export const staffIdForEmail = (normalizedEmail: string) => sha256(`staff:${normalizedEmail}`);

export const newEncryptionKey = () => randomBytes(32).toString("base64url");

/**
 * Authenticator keys are stored encrypted, because unlike a password they must be read back.
 * `owner` ties the result to one person, so it can't be copied onto someone else's record.
 */
export function encryptSecret(text: string, key: string, owner: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64url"), iv);
  cipher.setAAD(Buffer.from(owner));
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

export function decryptSecret(stored: string, key: string, owner: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64url"), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(owner));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
