import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { logActivity } from "./activity";
import { deskApp } from "./apps";
import { appAuth, appConnected, appDb } from "./firebase";
import { STATUS_LABELS, canUseApp, readStatus, type Access, type TicketChange, type TicketStatus } from "./rules";

export type Ticket = {
  uid: string;
  reference: string;
  subject: string;
  topic: string;
  channel: string;
  message: string | null;
  deviceInfo: string | null;
  status: TicketStatus;
  teamNote: string;
  createdAt: string;
  updatedAt: string | null;
  userName: string | null;
  userEmail: string | null;
};

export class NoAccess extends Error {}

/**
 * The one way to an app's database. Everything in this file comes through it, so a page
 * that forgets its own check still can't reach another app's tickets.
 */
function ticketsOf(who: Access, slug: string) {
  const known = deskApp(slug);
  if (!known || !canUseApp(who, slug) || !appConnected(slug)) throw new NoAccess();
  return appDb(known);
}

/** How many of the newest tickets are shown. The page says so when there are more. */
export const TICKET_LIMIT = 500;

const uidOf = (doc: DocumentSnapshot) => {
  const account = doc.ref.parent.parent;
  return account?.parent.id === "accounts" ? account.id : null;
};

const iso = (value: unknown): string | null => {
  const date = (value as { toDate?: () => Date } | null)?.toDate?.();
  return date ? date.toISOString() : null;
};

const toTicket = (doc: DocumentSnapshot, uid: string): Ticket => ({
  uid,
  reference: doc.id,
  subject: String(doc.get("subject") ?? ""),
  topic: String(doc.get("topic") ?? ""),
  channel: String(doc.get("channel") ?? "sent"),
  message: (doc.get("message") as string | undefined) ?? null,
  deviceInfo: (doc.get("deviceInfo") as string | undefined) ?? null,
  status: readStatus(doc.get("status")),
  teamNote: (doc.get("teamNote") as string | undefined) ?? "",
  createdAt: iso(doc.get("createdAt")) ?? "",
  updatedAt: iso(doc.get("updatedAt")),
  userName: null,
  userEmail: null,
});

/** Names change rarely, so a page refresh needn't ask for them again. Kept per app. */
const USER_CACHE_MS = 10 * 60 * 1000;
const userCache = new Map<string, { name: string | null; email: string | null; at: number }>();

/** The tickets of one app, with each user's name and email from that app's accounts. */
export async function listTickets(who: Access, slug: string): Promise<Ticket[]> {
  const db = ticketsOf(who, slug);
  const snap = await db.collectionGroup("support").orderBy("createdAt", "desc").limit(TICKET_LIMIT).get();
  const tickets = snap.docs.flatMap((doc) => {
    const uid = uidOf(doc);
    return uid ? [toTicket(doc, uid)] : [];
  });

  const now = Date.now();
  const cacheKey = (uid: string) => `${slug}/${uid}`;
  const uids = [...new Set(tickets.map((t) => t.uid))].filter((uid) => now - (userCache.get(cacheKey(uid))?.at ?? 0) > USER_CACHE_MS);
  try {
    if (uids.length) {
      const accounts = await appAuth(deskApp(slug)!);
      for (let i = 0; i < uids.length; i += 100) {
        const { users } = await accounts.getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
        for (const u of users) userCache.set(cacheKey(u.uid), { name: u.displayName ?? null, email: u.email ?? null, at: now });
      }
    }
  } catch (e) {
    // Tickets still show without names if the key can't read accounts.
    console.error("[tickets] user details not loaded", e instanceof Error ? e.message : "error");
  }
  return tickets.map((t) => {
    const user = userCache.get(cacheKey(t.uid));
    return { ...t, userName: user?.name ?? null, userEmail: user?.email ?? null };
  });
}

export type TicketCounts = Record<TicketStatus, number> & { total: number };

/** Counts for the overview; reads only the status of each ticket. */
export async function countTickets(who: Access, slug: string): Promise<TicketCounts> {
  const db = ticketsOf(who, slug);
  const snap = await db.collectionGroup("support").orderBy("createdAt", "desc").limit(TICKET_LIMIT).select("status").get();
  const counts: TicketCounts = { open: 0, in_progress: 0, fixed: 0, total: 0 };
  for (const doc of snap.docs) {
    if (!uidOf(doc)) continue;
    counts[readStatus(doc.get("status"))] += 1;
    counts.total += 1;
  }
  return counts;
}

/** Saves a status and note on the user's ticket; the app reads them from there. */
export async function changeTicket(who: Access & { name: string }, slug: string, change: TicketChange): Promise<{ updatedAt: string } | null> {
  const db = ticketsOf(who, slug);
  const ref = db.collection("accounts").doc(change.uid).collection("support").doc(change.reference);
  const summary = await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return null;
    const before = readStatus(doc.get("status"));
    const noteChanged = (doc.get("teamNote") ?? "") !== change.note;
    tx.update(ref, {
      status: change.status,
      teamNote: change.note ? change.note : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const moved = before === change.status ? STATUS_LABELS[before] : `${STATUS_LABELS[before]} → ${STATUS_LABELS[change.status]}`;
    return `${change.reference}: ${moved}${noteChanged ? ", note changed" : ""}`;
  });
  if (!summary) return null;
  // Another project, so it can't share the transaction. The change is saved either way.
  await logActivity({ actor: who, action: "Ticket updated", detail: summary, app: slug }).catch((e) =>
    console.error("[tickets] not logged", e instanceof Error ? e.message : "error"),
  );
  return { updatedAt: new Date().toISOString() };
}
