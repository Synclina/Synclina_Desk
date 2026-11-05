import { LoadProblem } from "@/components/DeskShell";
import styles from "@/components/Desk.module.css";
import { recentActivity, type ActivityEntry } from "@/lib/activity";
import { deskApp } from "@/lib/apps";
import { requireStaff } from "@/lib/session";

const label = (iso: string) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "";

export default async function Activity() {
  const staff = await requireStaff();
  let entries: ActivityEntry[] | null = null;
  try {
    entries = await recentActivity(staff);
  } catch (e) {
    console.error("[activity] not loaded", e instanceof Error ? e.message : "error");
  }

  return (
    <div className={styles.pageIn}>
      <h1 className={styles.pageTitle}>Activity</h1>
      <p className={styles.muted}>{staff.role === "owner" ? "The last 100 actions by anyone." : "The last 100 actions, yours and your apps'."}</p>
      {!entries && <LoadProblem />}
      <ul className={styles.activity}>
        {entries?.map((e, i) => (
          <li key={e.id} style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}>
            <span>
              {e.actor ? `${e.actor}: ` : ""}
              {e.action}
            </span>
            <span className={styles.muted}>{[e.app ? deskApp(e.app)?.title ?? e.app : "", e.detail].filter(Boolean).join(" · ")}</span>
            <time className={styles.muted}>{label(e.at)}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}
