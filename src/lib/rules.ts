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
