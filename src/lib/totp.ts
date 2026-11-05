import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Authenticator-app codes (RFC 6238: 6 digits, 30 seconds, SHA-1). */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export const stepAt = (nowMs: number) => Math.floor(nowMs / 1000 / STEP_SECONDS);

export function codeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const number = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, "0");
}

/**
 * The step the code belongs to, allowing one step of clock drift each way, or null.
 * A code at or before lastStep has been used already and is refused.
 */
export function matchTotp(secret: string, code: string, nowMs: number, lastStep = 0): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(nowMs);
  let found: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const same = timingSafeEqual(Buffer.from(codeForStep(secret, step)), Buffer.from(code));
    if (same && step > lastStep) found = step;
  }
  return found;
}

export const otpauthUrl = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
