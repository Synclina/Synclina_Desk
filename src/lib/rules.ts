/** Plain rules with no outside dependencies, so the tests can load them directly. */

export const IDLE_LIMIT_MS = 30 * 60 * 1000;
export const SESSION_LIMIT_MS = 8 * 60 * 60 * 1000;
export const SEEN_WRITE_EVERY_MS = 5 * 60 * 1000;

export const IP_WINDOW_MS = 15 * 60 * 1000;
export const IP_MAX_TRIES = 20;

export const PASSWORD_MIN = 14;

const MAX_LOCK_MS = 60 * 60 * 1000;
const FREE_TRIES = 5;

/** 5 wrong tries lock that person's sign-in for 15 minutes, then 30, then an hour at most. */
export function lockAfter(fails: number): number {
  if (fails < FREE_TRIES) return 0;
  return Math.min(15 * 60 * 1000 * 2 ** (fails - FREE_TRIES), MAX_LOCK_MS);
}

export function sessionAlive(createdAt: number, lastSeenAt: number, now: number): boolean {
  return now - createdAt < SESSION_LIMIT_MS && now - lastSeenAt < IDLE_LIMIT_MS;
}

/** Whether the tries from one address are used up, and the count to store next. */
export function ipTry(entry: { count: number; since: number } | undefined, now: number) {
  if (!entry || now - entry.since > IP_WINDOW_MS) return { blocked: false, next: { count: 1, since: now } };
  const next = { count: entry.count + 1, since: entry.since };
  return { blocked: next.count > IP_MAX_TRIES, next };
}

/** Whether a page's request came from this same site. */
export function sameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const validEmail = (email: string) => email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);

export type Role = "owner" | "maintainer";
export type Access = { id: string; role: Role; apps: string[] };

/** The one check for app access. Everything that touches an app's tickets goes through it. */
export const canUseApp = (who: Access, slug: string) => who.role === "owner" || who.apps.includes(slug);

/** The main account sees everything; anyone else sees their own actions and their apps'. */
export function visibleActivity<T extends { actorId: string | null; app: string | null }>(who: Access, entries: T[]): T[] {
  if (who.role === "owner") return entries;
  return entries.filter((e) => e.actorId === who.id || (e.app !== null && who.apps.includes(e.app)));
}

export type TicketStatus = "open" | "in_progress" | "fixed";
export const TICKET_STATUSES: TicketStatus[] = ["open", "in_progress", "fixed"];

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Pending",
  in_progress: "In progress",
  fixed: "Fixed",
};

/** Reads a stored status the way the apps do: anything unknown counts as pending. */
export function readStatus(value: unknown): TicketStatus {
  const text = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (text === "in_progress" || text === "inprogress") return "in_progress";
  if (["fixed", "resolved", "closed", "done"].includes(text)) return "fixed";
  return "open";
}

export const NOTE_LIMIT = 1000;

export type TicketChange = { uid: string; reference: string; status: TicketStatus; note: string };

/** A ticket change from the page, checked against that app's references; null when anything is off. */
export function readTicketChange(body: unknown, prefixes: string[]): TicketChange | null {
  if (typeof body !== "object" || body === null) return null;
  const { uid, reference, status, note } = body as Record<string, unknown>;
  if (typeof uid !== "string" || !/^[A-Za-z0-9]{1,128}$/.test(uid)) return null;
  if (typeof reference !== "string" || !/^[A-Z]{2}-[A-Z0-9]{6}$/.test(reference) || !prefixes.includes(reference.slice(0, 2))) return null;
  if (typeof status !== "string" || !TICKET_STATUSES.includes(status as TicketStatus)) return null;
  if (typeof note !== "string" || note.length > NOTE_LIMIT) return null;
  return { uid, reference, status: status as TicketStatus, note: note.trim() };
}

/** A key connects an app only when it's for the project that app was told to expect. */
export const keyFitsProject = (keyProject: unknown, expected: string | undefined) =>
  typeof keyProject === "string" && expected !== undefined && keyProject === expected;
