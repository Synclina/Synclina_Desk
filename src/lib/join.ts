import { activityFields, activityLog } from "./activity";
import { deskConfig } from "./config";
import { decryptSecret, hashSecret, newRecoveryCode, normalizeRecoveryCode, sha256 } from "./crypto";
import { deskDb } from "./firebase";
import { invites } from "./people";
import { staffCollection } from "./staff";
import { matchTotp, otpauthUrl } from "./totp";

const RECOVERY_CODES = 8;

/** The link's record and its person, or null when the link is unknown, used, run out or taken back. */
async function openLink(token: string) {
  const cfg = deskConfig();
  if (!cfg) return null;
  const ref = invites().doc(sha256(token));
  const invite = (await ref.get()).data();
  if (!invite || Number(invite.expiresAt) <= Date.now()) return null;
  const staffId = String(invite.staffId);
  const staff = await staffCollection().doc(staffId).get();
  if (!staff.exists || staff.get("removedAt") || staff.get("active") === true) return null;
  return { ref, staffId, staff, secret: decryptSecret(String(invite.totpSecret), cfg.encryptionKey, staffId) };
}

/** What the join page needs to show. */
export async function readLink(token: string) {
  const link = await openLink(token);
  if (!link) return null;
  const email = String(link.staff.get("email"));
  return { email, name: String(link.staff.get("name")), secret: link.secret, otpauth: otpauthUrl(link.secret, email, "Synclina Desk") };
}

export type FinishResult = { outcome: "link" } | { outcome: "code" } | { outcome: "ok"; recovery: string[]; name: string; email: string };

/** Saves the chosen password and authenticator. The link works once, even if used twice at the same moment. */
export async function finishLink(token: string, password: string, code: string, place: string): Promise<FinishResult> {
  const link = await openLink(token);
  if (!link) return { outcome: "link" };
  const step = matchTotp(link.secret, code.trim(), Date.now());
  if (step === null) return { outcome: "code" };

  const passwordHash = await hashSecret(password);
  const recovery = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
  const staffRef = link.staff.ref;

  return deskDb().runTransaction(async (tx): Promise<FinishResult> => {
    const invite = await tx.get(link.ref);
    const staff = await tx.get(staffRef);
    if (!invite.exists || Number(invite.get("expiresAt")) <= Date.now() || !staff.exists || staff.get("removedAt") || staff.get("active") === true) {
      return { outcome: "link" };
    }
    const name = String(staff.get("name"));
    tx.delete(link.ref);
    tx.update(staffRef, {
      active: true,
      passwordHash,
      totpSecret: String(invite.get("totpSecret")),
      recoveryHashes: recovery.map((c) => sha256(normalizeRecoveryCode(c))),
      usedRecovery: [],
      fails: 0,
      lockedUntil: 0,
      // The code just used can't sign in as well.
      lastTotpStep: step,
      setupExpiresAt: 0,
    });
    tx.create(activityLog().doc(), activityFields({ actor: { id: link.staffId, name }, action: "Finished setting up their account", detail: place }));
    return { outcome: "ok", recovery, name, email: String(staff.get("email")) };
  });
}
