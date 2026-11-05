import { FieldValue } from "firebase-admin/firestore";
import { deskDb } from "./firebase";
import { visibleActivity, type Access } from "./rules";

export type ActivityEntry = {
  id: string;
  at: string;
  actorId: string | null;
  actor: string;
  action: string;
  detail: string;
  app: string | null;
};

export const activityLog = () => deskDb().collection("activity");

export type ActivityInput = { actor: { id: string; name: string } | null; action: string; detail?: string; app?: string | null };

export const activityFields = ({ actor, action, detail = "", app = null }: ActivityInput) => ({
  actorId: actor?.id ?? null,
  actor: actor?.name ?? "",
  action,
  detail,
  app,
  at: FieldValue.serverTimestamp(),
});

export const logActivity = async (input: ActivityInput) => {
  await activityLog().add(activityFields(input));
};

const SCAN = 300;
const SHOWN = 100;

/** The latest entries this person may see. Scoped here, on the server. */
export async function recentActivity(who: Access): Promise<ActivityEntry[]> {
  const snap = await activityLog().orderBy("at", "desc").limit(SCAN).get();
  const entries = snap.docs.map((d) => ({
    id: d.id,
    at: d.get("at")?.toDate?.().toISOString() ?? "",
    actorId: (d.get("actorId") as string | null) ?? null,
    actor: String(d.get("actor") ?? ""),
    action: String(d.get("action") ?? ""),
    detail: String(d.get("detail") ?? ""),
    app: (d.get("app") as string | null) ?? null,
  }));
  return visibleActivity(who, entries).slice(0, SHOWN);
}
