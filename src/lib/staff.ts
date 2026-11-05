import { deskDb } from "./firebase";
import type { Access, Role } from "./rules";

/** Someone with a Desk login, without any of their secrets. */
export type Staff = Access & { email: string; name: string; active: boolean };

export const staffCollection = () => deskDb().collection("staff");

export function staffFrom(id: string, data: FirebaseFirestore.DocumentData): Staff {
  return {
    id,
    email: String(data.email ?? ""),
    name: String(data.name ?? ""),
    role: (data.role === "owner" ? "owner" : "maintainer") as Role,
    apps: Array.isArray(data.apps) ? data.apps.map(String) : [],
    active: data.active === true,
  };
}

export async function ownerEmails(): Promise<string[]> {
  const snap = await staffCollection().where("role", "==", "owner").get();
  return snap.docs.map((d) => String(d.get("email") ?? "")).filter(Boolean);
}
