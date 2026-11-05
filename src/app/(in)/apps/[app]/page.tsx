import { notFound } from "next/navigation";
import { LoadProblem } from "@/components/DeskShell";
import styles from "@/components/Desk.module.css";
import TicketBoard from "@/components/TicketBoard";
import { deskApp } from "@/lib/apps";
import { appConnected } from "@/lib/firebase";
import { canUseApp } from "@/lib/rules";
import { requireStaff } from "@/lib/session";
import { TICKET_LIMIT, listTickets, type Ticket } from "@/lib/tickets";

const label = (iso: string) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "";

export default async function AppTickets({ params }: { params: Promise<{ app: string }> }) {
  const staff = await requireStaff();
  const app = deskApp((await params).app);
  // Someone else's app looks the same as no app at all.
  if (!app || !canUseApp(staff, app.slug)) notFound();

  const connected = appConnected(app.slug);
  let tickets: Ticket[] | null = connected ? null : [];
  if (connected) {
    try {
      tickets = await listTickets(staff, app.slug);
    } catch (e) {
      console.error("[tickets] not loaded", e instanceof Error ? e.message : "error");
    }
  }

  return (
    <div className={styles.pageIn}>
      <h1 className={styles.pageTitle}>{app.title}</h1>
      {!connected ? (
        <p className={styles.emptyNote}>This app isn&apos;t connected yet. Its tickets will show here once it is.</p>
      ) : tickets ? (
        <>
          <TicketBoard app={app.slug} appTitle={app.title} tickets={tickets.map((t) => ({ ...t, createdLabel: label(t.createdAt) }))} />
          {tickets.length >= TICKET_LIMIT && <p className={styles.muted}>Showing the newest {TICKET_LIMIT} tickets.</p>}
          <p className={styles.footNote}>Requests sent while signed out of the app arrive by email, and show here once the user signs in.</p>
        </>
      ) : (
        <LoadProblem />
      )}
    </div>
  );
}
