import styles from "@/components/Desk.module.css";
import { DESK_APPS } from "@/lib/apps";
import { canUseApp } from "@/lib/rules";
import { requireStaff } from "@/lib/session";

export default async function Home() {
  const staff = await requireStaff();
  const apps = DESK_APPS.filter((a) => canUseApp(staff, a.slug));

  return (
    <div className={styles.pageIn}>
      <h1 className={styles.pageTitle}>Hello, {staff.name}</h1>
      {apps.length === 0 && <p className={styles.muted}>You haven&apos;t been given any apps yet.</p>}
      <div className={styles.appGrid}>
        {apps.map((app) => (
          <div key={app.slug} className={styles.appCard} style={{ "--accent": app.accent } as React.CSSProperties}>
            <strong>{app.title}</strong>
            <span className={styles.muted}>Tickets aren&apos;t connected yet</span>
          </div>
        ))}
      </div>
    </div>
  );
}
