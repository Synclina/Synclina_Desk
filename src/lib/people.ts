import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { activityFields, activityLog } from "./activity";
import { deskConfig } from "./config";
import { encryptSecret, newToken, sha256, staffIdForEmail } from "./crypto";
import { deskDb } from "./firebase";
import { INVITE_LIFE_MS, personState, type Access, type InviteRequest, type PersonState } from "./rules";
import { endAllSessions } from "./session";
import { staffCollection, type Staff } from "./staff";
import { newTotpSecret } from "./totp";

export type Person = { id: string; email: string; name: string; apps: string[]; state: PersonState };

export type IssuedLink = { email: string; token: string; expiresAt: number };

/** Links are stored only as a hash of their token, so a copy of the database can't use one. */
export const invites = () => deskDb().collection("invites");

export class NotOwner extends Error {}

/** Everything here is for the main account alone, whatever a page or route remembered to check. */
function ownerOnly(who: Access) {
  if (who.role !== "owner") throw new NotOwner();
}

function encryptionKey(): string {
  const cfg = deskConfig();
  if (!cfg) throw new Error("Desk isn't configured");
  return cfg.encryptionKey;
}

const noSecrets = () => ({
  passwordHash: FieldValue.delete(),
  totpSecret: FieldValue.delete(),
  recoveryHashes: FieldValue.delete(),
  usedRecovery: FieldValue.delete(),
  lastTotpStep: 0,
  fails: 0,
  lockedUntil: 0,
});

export const joinLink = (origin: string, token: string) => `${origin}/join#${token}`;

/** Everyone, without any of their secrets. */
export async function listPeople(who: Access): Promise<Person[]> {
  ownerOnly(who);
  const snap = await staffCollection().get();
  const now = Date.now();
  const order: PersonState[] = ["main", "active", "waiting", "expired", "removed"];
  return snap.docs
    .map((d) => ({
      id: d.id,
      email: String(d.get("email") ?? ""),
      name: String(d.get("name") ?? ""),
      apps: Array.isArray(d.get("apps")) ? (d.get("apps") as unknown[]).map(String) : [],
      state: personState(d.data(), now),
    }))
    .sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.name.localeCompare(b.name));
}

/** Makes a new link, ending any earlier one. The authenticator key is fixed now, so reopening the link shows the same one. */
function writeLink(tx: Transaction, staffId: string, earlier: FirebaseFirestore.QuerySnapshot, key: string) {
  earlier.docs.forEach((d) => tx.delete(d.ref));
  const token = newToken();
  const now = Date.now();
  const expiresAt = now + INVITE_LIFE_MS;
  tx.set(invites().doc(sha256(token)), {
    staffId,
    totpSecret: encryptSecret(newTotpSecret(), key, staffId),
    createdAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

const linksOf = (staffId: string) => invites().where("staffId", "==", staffId);

/** Adds a maintainer who can't sign in until they use their link. Never makes a main account. */
export async function invitePerson(who: Staff, request: InviteRequest): Promise<IssuedLink | "exists"> {
  ownerOnly(who);
  const key = encryptionKey();
  const id = staffIdForEmail(request.email);
  const ref = staffCollection().doc(id);
  return deskDb().runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const earlier = await tx.get(linksOf(id));
    if (current.exists && !current.get("removedAt")) return "exists" as const;
    const { token, expiresAt } = writeLink(tx, id, earlier, key);
    tx.set(ref, {
      email: request.email,
      name: request.name,
      role: "maintainer",
      apps: request.apps,
      active: false,
      fails: 0,
      lockedUntil: 0,
      lastTotpStep: 0,
      createdAt: Date.now(),
      setupExpiresAt: expiresAt,
    });
    tx.create(activityLog().doc(), activityFields({ actor: who, action: "Person invited", detail: `${request.email}: ${request.apps.join(", ")}` }));
    return { email: request.email, token, expiresAt };
  });
}

/**
 * Takes away the old password and authenticator at once, and makes a link to choose new ones.
 * Also how someone gets a new link when theirs is lost or has run out.
 */
export async function resetPerson(who: Staff, id: string): Promise<IssuedLink | null> {
  ownerOnly(who);
  const key = encryptionKey();
  const ref = staffCollection().doc(id);
  const issued = await deskDb().runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const earlier = await tx.get(linksOf(id));
    if (!current.exists || current.get("role") !== "maintainer" || current.get("removedAt")) return null;
    const email = String(current.get("email"));
    const { token, expiresAt } = writeLink(tx, id, earlier, key);
    tx.update(ref, { ...noSecrets(), active: false, setupExpiresAt: expiresAt });
    tx.create(activityLog().doc(), activityFields({ actor: who, action: current.get("active") === true ? "Sign-in reset" : "New invite link", detail: email }));
    return { email, token, expiresAt };
  });
  if (issued) await endAllSessions(id);
  return issued;
}

/** Ends their access for good. The record stays, so the activity log still makes sense. */
export async function removePerson(who: Staff, id: string): Promise<boolean> {
  ownerOnly(who);
  const ref = staffCollection().doc(id);
  const removed = await deskDb().runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const earlier = await tx.get(linksOf(id));
    if (!current.exists || current.get("role") !== "maintainer" || current.get("removedAt")) return false;
    earlier.docs.forEach((d) => tx.delete(d.ref));
    tx.update(ref, { ...noSecrets(), active: false, apps: [], removedAt: Date.now(), setupExpiresAt: FieldValue.delete() });
    tx.create(activityLog().doc(), activityFields({ actor: who, action: "Person removed", detail: String(current.get("email")) }));
    return true;
  });
  if (removed) await endAllSessions(id);
  return removed;
}

/** Which apps someone can use. Takes effect on their next click. */
export async function setPersonApps(who: Staff, id: string, apps: string[]): Promise<boolean> {
  ownerOnly(who);
  const ref = staffCollection().doc(id);
  return deskDb().runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists || current.get("role") !== "maintainer" || current.get("removedAt")) return false;
    tx.update(ref, { apps });
    tx.create(activityLog().doc(), activityFields({ actor: who, action: "App access changed", detail: `${current.get("email")}: ${apps.join(", ") || "no apps"}` }));
    return true;
  });
}
