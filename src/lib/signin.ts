import { activityFields, activityLog, logActivity } from "./activity";
import { deskConfig } from "./config";
import { decryptSecret, hashSecret, normalizeRecoveryCode, sha256, staffIdForEmail, verifySecret } from "./crypto";
import { deskDb } from "./firebase";
import { ipTry, lockAfter, normalizeEmail } from "./rules";
import { staffCollection, staffFrom, type Staff } from "./staff";
import { matchTotp } from "./totp";

export type SignInResult = { outcome: "ok" | "wrong"; staff?: Staff; usedRecovery?: boolean; lockedNow?: boolean };

/** Checked when the email is unknown, so an unknown email takes as long as a known one. */
let decoy: Promise<string> | null = null;
const decoyHash = () => (decoy ??= hashSecret("no account has this password"));

/**
 * Checks email, password and code together. Unknown, turned-off and locked accounts all
 * answer exactly like a wrong password, so nobody can find out which emails exist.
 * Each person's tries are counted on their own record, so one lockout never blocks anyone else.
 */
export async function checkSignIn(rawEmail: string, password: string, code: string, place: string): Promise<SignInResult> {
  const cfg = deskConfig();
  if (!cfg) return { outcome: "wrong" };
  const now = Date.now();
  const ref = staffCollection().doc(staffIdForEmail(normalizeEmail(rawEmail)));
  const before = await ref.get();
  const data = before.data();

  const passwordOk = await verifySecret(password, typeof data?.passwordHash === "string" ? data.passwordHash : await decoyHash());

  if (!data || data.active !== true) {
    await logActivity({ actor: null, action: "Sign-in try with an unknown or turned-off email", detail: place });
    return { outcome: "wrong" };
  }
  // Tries during a lock aren't counted, so a stranger can't keep extending it.
  if (Number(data.lockedUntil ?? 0) > now) return { outcome: "wrong" };

  const staff = staffFrom(ref.id, data);
  const totpStep = matchTotp(decryptSecret(String(data.totpSecret), cfg.encryptionKey, ref.id), code.trim(), now, Number(data.lastTotpStep ?? 0));
  const recoveryHash = sha256(normalizeRecoveryCode(code));
  const recoveryHashes: string[] = Array.isArray(data.recoveryHashes) ? data.recoveryHashes : [];

  return deskDb().runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data() ?? {};
    const used: string[] = Array.isArray(fresh.usedRecovery) ? fresh.usedRecovery : [];
    const recoveryOk = totpStep === null && recoveryHashes.includes(recoveryHash) && !used.includes(recoveryHash);
    // Checked again inside the transaction, so one code can't be used twice at the same moment.
    const codeOk = totpStep !== null ? totpStep > Number(fresh.lastTotpStep ?? 0) : recoveryOk;

    if (passwordOk && codeOk && fresh.active === true) {
      tx.update(ref, {
        fails: 0,
        lockedUntil: 0,
        lastTotpStep: totpStep ?? Number(fresh.lastTotpStep ?? 0),
        usedRecovery: recoveryOk ? [...used, recoveryHash] : used,
      });
      tx.create(activityLog().doc(), activityFields({ actor: staff, action: recoveryOk ? "Signed in with a recovery code" : "Signed in", detail: place }));
      return { outcome: "ok" as const, staff, usedRecovery: recoveryOk };
    }

    const fails = Number(fresh.fails ?? 0) + 1;
    const lock = lockAfter(fails);
    tx.update(ref, { fails, lockedUntil: lock ? now + lock : 0 });
    tx.create(activityLog().doc(), activityFields({ actor: staff, action: lock ? "Sign-in locked after wrong tries" : "Wrong sign-in try", detail: place }));
    return { outcome: "wrong" as const, staff, lockedNow: lock > 0 };
  });
}

/** Counts a try from one address, across server instances. True when they are used up. */
export async function ipUsedUp(ip: string): Promise<boolean> {
  const ref = deskDb().collection("sign_in_limits").doc(sha256(ip));
  return deskDb().runTransaction(async (tx) => {
    const { blocked, next } = ipTry((await tx.get(ref)).data() as { count: number; since: number } | undefined, Date.now());
    tx.set(ref, next);
    return blocked;
  });
}
