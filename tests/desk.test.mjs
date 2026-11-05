import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decryptSecret,
  encryptSecret,
  hashSecret,
  newEncryptionKey,
  newRecoveryCode,
  normalizeRecoveryCode,
  safeEqual,
  staffIdForEmail,
  verifySecret,
} from "../src/lib/crypto.ts";
import {
  IDLE_LIMIT_MS,
  IP_MAX_TRIES,
  IP_WINDOW_MS,
  SESSION_LIMIT_MS,
  canUseApp,
  ipTry,
  lockAfter,
  normalizeEmail,
  sameOrigin,
  sessionAlive,
  validEmail,
  visibleActivity,
} from "../src/lib/rules.ts";
import { base32Encode, codeForStep, matchTotp, newTotpSecret, stepAt } from "../src/lib/totp.ts";

test("a password matches its hash and nothing else", async () => {
  const stored = await hashSecret("correct horse battery", 14);
  assert.equal(await verifySecret("correct horse battery", stored), true);
  assert.equal(await verifySecret("correct horse batterz", stored), false);
  assert.equal(await verifySecret("", stored), false);
  assert.equal(await verifySecret("x", "not-a-hash"), false);
  assert.ok(!stored.includes("correct"));
});

test("safeEqual", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
});

test("an authenticator key survives encryption and hides its value", () => {
  const key = newEncryptionKey();
  const stored = encryptSecret("JBSWY3DPEHPK3PXP", key, "person-a");
  assert.ok(!stored.includes("JBSWY3DPEHPK3PXP"));
  assert.equal(decryptSecret(stored, key, "person-a"), "JBSWY3DPEHPK3PXP");
  assert.notEqual(encryptSecret("same", key, "a"), encryptSecret("same", key, "a"));
});

test("an encrypted key can't be read with the wrong key, moved to another person, or altered", () => {
  const key = newEncryptionKey();
  const stored = encryptSecret("JBSWY3DPEHPK3PXP", key, "person-a");
  assert.throws(() => decryptSecret(stored, newEncryptionKey(), "person-a"));
  assert.throws(() => decryptSecret(stored, key, "person-b"));
  const parts = stored.split(":");
  parts[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decryptSecret(parts.join(":"), key, "person-a"));
});

test("the same email always means the same person, whatever its case", () => {
  assert.equal(staffIdForEmail(normalizeEmail(" A@Example.com ")), staffIdForEmail("a@example.com"));
  assert.notEqual(staffIdForEmail("a@example.com"), staffIdForEmail("b@example.com"));
  assert.ok(!staffIdForEmail("a@example.com").includes("example"));
});

test("emails are checked", () => {
  assert.equal(validEmail("a@example.com"), true);
  for (const bad of ["", "a", "a@b", "a b@example.com", "@example.com"]) assert.equal(validEmail(bad), false);
});

test("recovery codes have a fixed form and ignore case and spaces", () => {
  const code = newRecoveryCode();
  assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.equal(normalizeRecoveryCode(` ${code.toLowerCase()} `), code);
});

test("TOTP matches the RFC 6238 published values", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(codeForStep(secret, Math.floor(59 / 30)), "287082");
  assert.equal(codeForStep(secret, Math.floor(1111111109 / 30)), "081804");
  assert.equal(codeForStep(secret, Math.floor(2000000000 / 30)), "279037");
});

test("a used code can't be used again, and bad codes are refused", () => {
  const secret = newTotpSecret();
  const now = Date.now();
  const step = stepAt(now);
  const code = codeForStep(secret, step);
  assert.equal(matchTotp(secret, code, now, step - 2), step);
  assert.equal(matchTotp(secret, code, now, step), null);
  for (const bad of ["", "12345", "1234567", "abcdef"]) assert.equal(matchTotp(secret, bad, now), null);
});

test("a person's sign-in locks after 5 wrong tries, for an hour at most", () => {
  assert.equal(lockAfter(4), 0);
  assert.equal(lockAfter(5), 15 * 60 * 1000);
  assert.equal(lockAfter(6), 30 * 60 * 1000);
  assert.equal(lockAfter(50), 60 * 60 * 1000);
});

test("one address gets a limited number of tries in a window", () => {
  const now = 1_000_000;
  let entry;
  for (let i = 0; i < IP_MAX_TRIES; i++) {
    const r = ipTry(entry, now);
    assert.equal(r.blocked, false);
    entry = r.next;
  }
  assert.equal(ipTry(entry, now).blocked, true);
  assert.deepEqual(ipTry(entry, now + IP_WINDOW_MS + 1), { blocked: false, next: { count: 1, since: now + IP_WINDOW_MS + 1 } });
});

test("a session ends when idle or too old", () => {
  const now = 100_000_000;
  assert.equal(sessionAlive(now - 1000, now - 1000, now), true);
  assert.equal(sessionAlive(now - 1000, now - IDLE_LIMIT_MS, now), false);
  assert.equal(sessionAlive(now - SESSION_LIMIT_MS, now, now), false);
});

test("same-site check", () => {
  assert.equal(sameOrigin("https://desk.example", "desk.example"), true);
  assert.equal(sameOrigin("https://evil.example", "desk.example"), false);
  assert.equal(sameOrigin(null, "desk.example"), false);
  assert.equal(sameOrigin("nonsense", "desk.example"), false);
});

const owner = { id: "o", role: "owner", apps: [] };
const maintainer = { id: "m", role: "maintainer", apps: ["drivsync"] };

test("the main account reaches every app; a maintainer only theirs", () => {
  assert.equal(canUseApp(owner, "instagro"), true);
  assert.equal(canUseApp(maintainer, "drivsync"), true);
  assert.equal(canUseApp(maintainer, "instagro"), false);
  assert.equal(canUseApp({ id: "n", role: "maintainer", apps: [] }, "drivsync"), false);
});

test("a maintainer sees their own actions and their apps' activity, nothing else", () => {
  const entries = [
    { id: 1, actorId: "m", app: null },
    { id: 2, actorId: "x", app: "drivsync" },
    { id: 3, actorId: "x", app: "instagro" },
    { id: 4, actorId: "o", app: null },
    { id: 5, actorId: null, app: null },
  ];
  assert.deepEqual(visibleActivity(maintainer, entries).map((e) => e.id), [1, 2]);
  assert.equal(visibleActivity(owner, entries).length, 5);
});
