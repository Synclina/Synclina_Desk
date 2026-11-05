import Link from "next/link";
import styles from "@/components/Desk.module.css";
import { DESK_APPS } from "@/lib/apps";
import { appConnected } from "@/lib/firebase";
import { canUseApp } from "@/lib/rules";
import { requireStaff } from "@/lib/session";
import { countTickets, type TicketCounts } from "@/lib/tickets";

export default async function Home() {
  const staff = await requireStaff();
  const apps = DESK_APPS.filter((a) => canUseApp(staff, a.slug));
  const counts = await Promise.all(
    apps.map(async (app): Promise<TicketCounts | null> => {
      if (!appConnected(app.slug)) return null;
      try {
        return await countTickets(staff, app.slug);
      } catch (e) {
        console.error("[home] counts not loaded", app.slug, e instanceof Error ? e.message : "error");
        return null;
      }
    }),
  );

  return (
    <div className={styles.pageIn}>
      <h1 className={styles.pageTitle}>Hello, {staff.name}</h1>
      {apps.length === 0 && <p className={styles.muted}>You haven&apos;t been given any apps yet.</p>}
      <div className={styles.appGrid}>
        {apps.map((app, i) => {
          const count = counts[i];
          return (
            <Link key={app.slug} href={`/apps/${app.slug}`} className={styles.appCard} style={{ "--accent": app.accent } as React.CSSProperties}>
              <strong>{app.title}</strong>
              {count ? (
                <dl className={styles.counts}>
                  <div>
                    <dt>Pending</dt>
                    <dd>{count.open}</dd>
                  </div>
                  <div>
                    <dt>In progress</dt>
                    <dd>{count.in_progress}</dd>
                  </div>
                  <div>
                    <dt>Fixed</dt>
                    <dd>{count.fixed}</dd>
                  </div>
                </dl>
              ) : (
                <span className={styles.muted}>{appConnected(app.slug) ? "Open to see tickets" : "Not connected yet"}</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
