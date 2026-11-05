import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { deskConfig } from "./config";
import { newToken, sha256 } from "./crypto";
import { deskDb } from "./firebase";
import { SEEN_WRITE_EVERY_MS, SESSION_LIMIT_MS, sameOrigin, sessionAlive } from "./rules";
import { staffCollection, staffFrom, type Staff } from "./staff";

const COOKIE = "__Host-desk_session";

/** One document per signed-in browser, named by a hash of its cookie: the cookie itself is never stored. */
const sessions = () => deskDb().collection("sessions");

export async function startSession(staffId: string): Promise<void> {
  const token = newToken();
  const now = Date.now();
  await sessions().doc(sha256(token)).set({ staffId, createdAt: now, lastSeenAt: now });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_LIMIT_MS / 1000,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await sessions().doc(sha256(token)).delete();
  jar.delete(COOKIE);
}

/** Ends every session of one person, on every browser. */
export async function endAllSessions(staffId: string): Promise<void> {
  const snap = await sessions().where("staffId", "==", staffId).get();
  const batch = deskDb().batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

/** Who this request belongs to, or null. Read fresh, so turning someone off works at once. */
export const currentStaff = cache(async (): Promise<Staff | null> => {
  if (!deskConfig()) return null;
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const ref = sessions().doc(sha256(token));
  const data = (await ref.get()).data();
  if (!data) return null;
  const now = Date.now();
  if (!sessionAlive(data.createdAt, data.lastSeenAt, now)) {
    await ref.delete();
    return null;
  }
  const staffDoc = await staffCollection().doc(String(data.staffId)).get();
  const staff = staffDoc.exists ? staffFrom(staffDoc.id, staffDoc.data()!) : null;
  if (!staff?.active) {
    await ref.delete();
    return null;
  }
  if (now - data.lastSeenAt > SEEN_WRITE_EVERY_MS) await ref.update({ lastSeenAt: now });
  return staff;
});

/** For pages: anyone without a session goes back to the sign-in form. */
export async function requireStaff(): Promise<Staff> {
  const staff = await currentStaff();
  if (!staff) redirect("/");
  return staff;
}

/** For changes: same site only, JSON only. Returns the refusal, or null to carry on. */
export function refuseCrossSite(req: Request): Response | null {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!sameOrigin(req.headers.get("origin"), host)) return Response.json({ error: "Not allowed." }, { status: 403 });
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Not allowed." }, { status: 415 });
  }
  return null;
}
