"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NOTE_LIMIT, STATUS_LABELS, TICKET_STATUSES, type TicketStatus } from "@/lib/rules";
import type { Ticket } from "@/lib/tickets";
import styles from "./Desk.module.css";

export type BoardTicket = Ticket & { createdLabel: string };
type Filter = TicketStatus | "all";

const STATUS_STYLE: Record<TicketStatus, string> = {
  open: styles.statusOpen,
  in_progress: styles.statusProgress,
  fixed: styles.statusFixed,
};

export default function TicketBoard({ app, appTitle, tickets: loaded }: { app: string; appTitle: string; tickets: BoardTicket[] }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [tickets, setTickets] = useState(loaded);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openRef, setOpenRef] = useState<string | null>(null);

  useEffect(() => setTickets(loaded), [loaded]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: tickets.length, open: 0, in_progress: 0, fixed: 0 };
    for (const t of tickets) c[t.status] += 1;
    return c;
  }, [tickets]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets.filter(
      (t) =>
        // The open ticket stays put when its status changes, until it's closed.
        t.reference === openRef ||
        ((filter === "all" || t.status === filter) &&
          (!q || [t.reference, t.subject, t.topic, t.message, t.userName, t.userEmail].some((v) => v?.toLowerCase().includes(q)))),
    );
  }, [tickets, filter, query, openRef]);

  const replaced = (next: BoardTicket) => setTickets((all) => all.map((t) => (t.reference === next.reference && t.uid === next.uid ? next : t)));

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Filter by status">
          {(["all", ...TICKET_STATUSES] as Filter[]).map((f) => (
            <button key={f} type="button" className={filter === f ? styles.filterActive : styles.filter} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : STATUS_LABELS[f]} <span>{counts[f]}</span>
            </button>
          ))}
        </div>
        <div className={styles.searchRow}>
          <input type="search" className={styles.search} placeholder="Search tickets" aria-label="Search tickets" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="button" className={styles.secondary} disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p key="none" className={styles.emptyNote}>
          {tickets.length === 0 ? "No tickets yet." : "No tickets match."}
        </p>
      ) : (
        <ul key={filter} className={styles.tickets}>
          {shown.map((t, i) => (
            <TicketRow
              key={`${t.uid}/${t.reference}`}
              app={app}
              appTitle={appTitle}
              ticket={t}
              index={i}
              open={openRef === t.reference}
              onToggle={() => setOpenRef(openRef === t.reference ? null : t.reference)}
              onChanged={replaced}
            />
          ))}
        </ul>
      )}
    </>
  );
}

type Saved = { status: TicketStatus; teamNote: string; updatedAt: string | null };

function TicketRow({
  app,
  appTitle,
  ticket,
  index,
  open,
  onToggle,
  onChanged,
}: {
  app: string;
  appTitle: string;
  ticket: BoardTicket;
  index: number;
  open: boolean;
  onToggle: () => void;
  onChanged: (t: BoardTicket) => void;
}) {
  const [note, setNote] = useState(ticket.teamNote);
  const [bodyReady, setBodyReady] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "quiet" | "good" | "bad" } | null>(null);

  // Changes show at once and save behind the scenes, in the order they were made.
  const latest = useRef(ticket);
  latest.current = ticket;
  const confirmed = useRef<Saved>({ status: ticket.status, teamNote: ticket.teamNote, updatedAt: ticket.updatedAt });
  const waiting = useRef<{ status: TicketStatus; note: string } | null>(null);
  const saving = useRef(false);
  const hideNotice = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (open) setBodyReady(true);
  }, [open]);
  useEffect(() => () => clearTimeout(hideNotice.current), []);

  const lastSeenNote = useRef(ticket.teamNote);
  useEffect(() => {
    // A newer note from a refresh, unless something is being typed.
    if (!saving.current) {
      confirmed.current = { status: ticket.status, teamNote: ticket.teamNote, updatedAt: ticket.updatedAt };
      setNote((typed) => (typed === lastSeenNote.current ? ticket.teamNote : typed));
    }
    lastSeenNote.current = ticket.teamNote;
  }, [ticket.status, ticket.teamNote, ticket.updatedAt]);

  const sendWaiting = async () => {
    saving.current = true;
    clearTimeout(hideNotice.current);
    setNotice({ text: "Saving…", tone: "quiet" });
    let problem: string | null = null;
    while (waiting.current && !problem) {
      const job = waiting.current;
      waiting.current = null;
      try {
        const res = await fetch(`/api/apps/${app}/tickets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: ticket.uid, reference: ticket.reference, status: job.status, note: job.note }),
        });
        if (res.status === 401) {
          window.location.reload();
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { error?: string; updatedAt?: string };
        if (res.ok) confirmed.current = { status: job.status, teamNote: job.note.trim(), updatedAt: data.updatedAt ?? null };
        else problem = data.error ?? "Not saved. Please try again.";
      } catch {
        problem = "No connection. Not saved.";
      }
    }
    saving.current = false;
    if (problem) {
      waiting.current = null;
      onChanged({ ...latest.current, ...confirmed.current });
      setNotice({ text: problem, tone: "bad" });
      return;
    }
    onChanged({ ...latest.current, ...confirmed.current });
    setNotice({ text: "Saved. The user sees it in the app.", tone: "good" });
    hideNotice.current = setTimeout(() => setNotice(null), 4000);
  };

  const change = (status: TicketStatus, nextNote: string) => {
    onChanged({ ...ticket, status, teamNote: nextNote.trim() });
    waiting.current = { status, note: nextNote };
    if (!saving.current) void sendWaiting();
  };

  const mail = ticket.userEmail
    ? `mailto:${ticket.userEmail}?subject=${encodeURIComponent(`[${appTitle} ${ticket.reference}] ${ticket.subject}`)}`
    : null;

  const noticeStyle = notice?.tone === "bad" ? styles.problem : notice?.tone === "good" ? styles.saved : styles.muted;

  return (
    <li className={styles.ticket} style={{ animationDelay: `${Math.min(index, 10) * 25}ms` }}>
      <button type="button" className={styles.ticketHead} aria-expanded={open} onClick={onToggle}>
        <span className={STATUS_STYLE[ticket.status]}>{STATUS_LABELS[ticket.status]}</span>
        <span className={styles.ticketSubject}>{ticket.subject}</span>
        <span className={open ? styles.chevronOpen : styles.chevron} aria-hidden="true">
          ›
        </span>
        <span className={styles.ticketMeta}>
          {ticket.reference} · {ticket.createdLabel}
          {ticket.userName ? ` · ${ticket.userName}` : ""}
        </span>
      </button>

      <div className={open ? styles.foldOpen : styles.fold} inert={!open}>
        <div className={styles.foldInner}>
          {bodyReady && (
            <div className={styles.ticketBody}>
              <section>
                <h2>Message</h2>
                {ticket.message ? (
                  <p className={styles.message}>{ticket.message}</p>
                ) : (
                  <p className={styles.muted}>Sent before messages were saved with tickets. It&apos;s in the email with this reference.</p>
                )}
              </section>

              <dl className={styles.details}>
                <div>
                  <dt>Topic</dt>
                  <dd>{ticket.topic || "None"}</dd>
                </div>
                <div>
                  <dt>From</dt>
                  <dd>
                    {ticket.userName ?? "Name not available"}
                    {ticket.userEmail ? ` · ${ticket.userEmail}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Sent</dt>
                  <dd>{ticket.channel === "emailApp" ? "Through the user's email app" : "Through the app"}</dd>
                </div>
                {ticket.deviceInfo && (
                  <div>
                    <dt>App details</dt>
                    <dd>{ticket.deviceInfo}</dd>
                  </div>
                )}
              </dl>

              <section>
                <h2>Status</h2>
                <div className={styles.statusPicker} role="group" aria-label="Status">
                  {TICKET_STATUSES.map((s) => (
                    <button key={s} type="button" aria-pressed={ticket.status === s} className={ticket.status === s ? styles.statusChosen : styles.statusChoice} onClick={() => ticket.status !== s && change(s, ticket.teamNote)}>
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h2>Note for the user</h2>
                <textarea rows={3} maxLength={NOTE_LIMIT} aria-label="Note for the user" placeholder="The user sees this in the app." value={note} onChange={(e) => setNote(e.target.value)} />
                <div className={styles.actions}>
                  <button type="button" className={styles.primary} disabled={note.trim() === ticket.teamNote} onClick={() => change(ticket.status, note)}>
                    Save note
                  </button>
                  {mail && (
                    <a className={styles.secondary} href={mail}>
                      Reply by email
                    </a>
                  )}
                </div>
              </section>

              <div className={notice ? styles.noticeOpen : styles.notice} role="status">
                <div className={styles.foldInner}>{notice && <p className={noticeStyle}>{notice.text}</p>}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
