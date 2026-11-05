"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { NAME_LIMIT, type PersonState } from "@/lib/rules";
import type { Person } from "@/lib/people";
import styles from "./Desk.module.css";

type App = { slug: string; title: string };
type Issued = { email: string; link: string; emailed: boolean };

const STATES: Record<PersonState, { label: string; style: string }> = {
  main: { label: "Main account", style: styles.statusFixed },
  active: { label: "Active", style: styles.statusFixed },
  waiting: { label: "Invited", style: styles.statusOpen },
  expired: { label: "Link ran out", style: styles.statusProgress },
  removed: { label: "Removed", style: styles.statusOff },
};

/** Sends a change; returns the answer, or the words for what went wrong. */
async function send(path: string, body: object): Promise<{ data: Issued & { ok?: boolean } } | { problem: string }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 401) {
      window.location.reload();
      return { problem: "Please sign in again." };
    }
    const data = await res.json().catch(() => ({}));
    return res.ok ? { data } : { problem: data.error ?? "Not saved. Please try again." };
  } catch {
    return { problem: "No connection. Not saved." };
  }
}

export default function PeopleBoard({ people, apps }: { people: Person[]; apps: App[] }) {
  const router = useRouter();
  const [issued, setIssued] = useState<Issued | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const showLink = (next: Issued) => {
    setIssued(next);
    router.refresh();
  };

  return (
    <>
      {issued && <LinkNotice issued={issued} onClose={() => setIssued(null)} />}
      <InviteForm apps={apps} onInvited={showLink} />
      <h2 className={styles.sectionTitle}>Everyone</h2>
      <ul className={styles.tickets}>
        {people.map((p, i) => (
          <PersonRow
            key={p.id}
            person={p}
            apps={apps}
            index={i}
            open={openId === p.id}
            onToggle={() => setOpenId(openId === p.id ? null : p.id)}
            onLink={showLink}
            onChanged={() => router.refresh()}
          />
        ))}
      </ul>
    </>
  );
}

function LinkNotice({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className={styles.linkNotice} role="status">
      <p className={issued.emailed ? styles.saved : styles.muted}>
        {issued.emailed ? `Emailed to ${issued.email}. If it doesn't arrive, send them this link yourself.` : `Send this link to ${issued.email} yourself. It couldn't be emailed from here.`}
      </p>
      <code className={styles.keyText}>{issued.link}</code>
      <p className={styles.muted}>It works once and runs out in 3 days. It won&apos;t be shown again.</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </button>
        <button type="button" className={styles.secondary} onClick={onClose}>
          Done
        </button>
      </div>
    </section>
  );
}

function AppChoices({ apps, chosen, onChange }: { apps: App[]; chosen: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className={styles.appChoices} role="group" aria-label="Apps">
      {apps.map((a) => (
        <label key={a.slug} className={styles.check}>
          <input type="checkbox" checked={chosen.includes(a.slug)} onChange={(e) => onChange(e.target.checked ? [...chosen, a.slug] : chosen.filter((s) => s !== a.slug))} />
          {a.title}
        </label>
      ))}
    </div>
  );
}

function InviteForm({ apps, onInvited }: { apps: App[]; onInvited: (issued: Issued) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem("");
    if (chosen.length === 0) {
      setProblem("Choose at least one app.");
      return;
    }
    setBusy(true);
    const result = await send("/api/people", { email, name, apps: chosen });
    setBusy(false);
    if ("problem" in result) {
      setProblem(result.problem);
      return;
    }
    setEmail("");
    setName("");
    setChosen([]);
    onInvited(result.data);
  };

  return (
    <form className={styles.inviteForm} onSubmit={submit}>
      <h2 className={styles.sectionTitle}>Invite someone</h2>
      <div className={styles.inviteFields}>
        <label>
          Email
          <input type="email" autoCapitalize="none" autoComplete="off" required maxLength={254} spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Name
          <input type="text" autoComplete="off" required maxLength={NAME_LIMIT} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <AppChoices apps={apps} chosen={chosen} onChange={setChosen} />
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <div>
        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? "Inviting…" : "Invite"}
        </button>
      </div>
    </form>
  );
}

function PersonRow({
  person,
  apps,
  index,
  open,
  onToggle,
  onLink,
  onChanged,
}: {
  person: Person;
  apps: App[];
  index: number;
  open: boolean;
  onToggle: () => void;
  onLink: (issued: Issued) => void;
  onChanged: () => void;
}) {
  const state = STATES[person.state];
  const access = person.state === "main" ? "All apps" : person.state === "removed" ? "No access" : apps.filter((a) => person.apps.includes(a.slug)).map((a) => a.title).join(", ") || "No apps";
  const fixed = person.state === "main" || person.state === "removed";

  const head = (
    <>
      <span className={state.style}>{state.label}</span>
      <span className={styles.ticketSubject}>{person.name}</span>
      {fixed ? (
        <span />
      ) : (
        <span className={open ? styles.chevronOpen : styles.chevron} aria-hidden="true">
          ›
        </span>
      )}
      <span className={styles.ticketMeta}>
        {person.email} · {access}
      </span>
    </>
  );

  return (
    <li className={styles.ticket} style={{ animationDelay: `${Math.min(index, 10) * 25}ms` }}>
      {fixed ? (
        <div className={styles.personHead}>{head}</div>
      ) : (
        <>
          <button type="button" className={styles.ticketHead} aria-expanded={open} onClick={onToggle}>
            {head}
          </button>
          <div className={open ? styles.foldOpen : styles.fold} inert={!open}>
            <div className={styles.foldInner}>
              <PersonActions person={person} apps={apps} onLink={onLink} onChanged={onChanged} />
            </div>
          </div>
        </>
      )}
    </li>
  );
}

function PersonActions({ person, apps, onLink, onChanged }: { person: Person; apps: App[]; onLink: (issued: Issued) => void; onChanged: () => void }) {
  const [chosen, setChosen] = useState(person.apps);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState(false);
  const [asking, setAsking] = useState<"reset" | "remove" | null>(null);

  useEffect(() => setChosen(person.apps), [person.apps]);

  const path = `/api/people/${encodeURIComponent(person.id)}`;
  const changed = chosen.length !== person.apps.length || chosen.some((s) => !person.apps.includes(s));
  const active = person.state === "active";

  const run = async (body: object) => {
    setBusy(true);
    setProblem("");
    setSaved(false);
    const result = await send(path, body);
    setBusy(false);
    setAsking(null);
    if ("problem" in result) {
      setProblem(result.problem);
      return null;
    }
    return result.data;
  };

  const saveApps = async () => {
    if (await run({ action: "apps", apps: chosen })) {
      setSaved(true);
      onChanged();
    }
  };

  const newLink = async () => {
    const data = await run({ action: "reset" });
    if (data) onLink(data);
  };

  const remove = async () => {
    if (await run({ action: "remove" })) onChanged();
  };

  return (
    <div className={styles.ticketBody}>
      <section>
        <h2>Apps they can use</h2>
        <AppChoices apps={apps} chosen={chosen} onChange={(next) => { setChosen(next); setSaved(false); }} />
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={busy || !changed} onClick={saveApps}>
            Save access
          </button>
        </div>
        {saved && <p className={styles.saved}>Saved. It applies on their next click.</p>}
      </section>

      <section>
        <h2>{active ? "Sign-in" : "Invite link"}</h2>
        {asking === "reset" ? (
          <>
            <p className={styles.muted}>{active ? `This signs ${person.name} out and stops their password and authenticator working. They'll set new ones from a link.` : "This stops their earlier link working."}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} disabled={busy} onClick={newLink}>
                {active ? "Reset and make a link" : "Make a new link"}
              </button>
              <button type="button" className={styles.secondary} onClick={() => setAsking(null)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => setAsking("reset")}>
            {active ? "Reset password and authenticator" : "New invite link"}
          </button>
        )}
      </section>

      <section>
        <h2>Remove</h2>
        {asking === "remove" ? (
          <>
            <p className={styles.muted}>{person.name} loses all access straight away. You can invite this email again later.</p>
            <div className={styles.actions}>
              <button type="button" className={styles.danger} disabled={busy} onClick={remove}>
                Remove {person.name}
              </button>
              <button type="button" className={styles.secondary} onClick={() => setAsking(null)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => setAsking("remove")}>
            Remove from Desk
          </button>
        )}
      </section>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
