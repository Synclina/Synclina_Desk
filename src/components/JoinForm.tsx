"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { PASSWORD_LIMIT, PASSWORD_MIN } from "@/lib/rules";
import SynclinaMark from "./SynclinaMark";
import styles from "./Desk.module.css";

type Details = { email: string; name: string; secret: string; otpauth: string; qr: string };

const send = (body: object) =>
  fetch("/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function JoinForm() {
  const [token, setToken] = useState("");
  const [details, setDetails] = useState<Details | null>(null);
  const [problem, setProblem] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);

  useEffect(() => {
    // After the #, so the token never reaches a server log or another site.
    const found = window.location.hash.slice(1);
    setToken(found);
    send({ step: "check", token: found })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok) setDetails(data as Details);
        else setProblem((data as { error?: string }).error ?? "This link doesn't work any more.");
      })
      .catch(() => setProblem("No connection. Refresh the page to try again."));
  }, []);

  return (
    <main className={styles.signInPage}>
      <div className={`${styles.signIn} ${styles.joinCard}`}>
        <SynclinaMark size={36} />
        {recovery ? (
          <SavedCodes codes={recovery} />
        ) : details ? (
          <SetupForm token={token} details={details} onDone={setRecovery} />
        ) : problem ? (
          <>
            <h1>Synclina Desk</h1>
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          </>
        ) : (
          <>
            <h1>Synclina Desk</h1>
            <p className={styles.muted}>Checking your link…</p>
          </>
        )}
      </div>
    </main>
  );
}

function SetupForm({ token, details, onDone }: { token: string; details: Details; onDone: (codes: string[]) => void }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== again) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await send({ step: "finish", token, password, code });
      const data = (await res.json().catch(() => ({}))) as { error?: string; recovery?: string[] };
      if (res.ok && data.recovery) {
        onDone(data.recovery);
        return;
      }
      setError(data.error ?? "That didn't work. Try again.");
      setCode("");
    } catch {
      setError("No connection. Try again.");
    }
    setBusy(false);
  };

  return (
    <form className={styles.joinForm} onSubmit={submit}>
      <h1>Set up your account</h1>
      <p className={styles.muted}>
        Hello {details.name}. You&apos;ll sign in to Desk as <strong>{details.email}</strong>.
      </p>
      <input type="email" className={styles.hiddenField} autoComplete="username" value={details.email} readOnly tabIndex={-1} aria-hidden="true" />
      <label>
        Choose a password
        <input type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_LIMIT} enterKeyHint="next" value={password} onChange={(e) => setPassword(e.target.value)} />
        <small>At least {PASSWORD_MIN} characters.</small>
      </label>
      <label>
        Type it again
        <input type="password" autoComplete="new-password" required maxLength={PASSWORD_LIMIT} enterKeyHint="next" value={again} onChange={(e) => setAgain(e.target.value)} />
      </label>

      <section className={styles.qrStep}>
        <h2>Add Desk to your authenticator app</h2>
        <p className={styles.muted}>Use Google Authenticator, Authy or similar, and scan this code.</p>
        <img className={styles.qr} src={details.qr} alt="QR code for your authenticator app" width={180} height={180} />
        <p className={styles.muted}>
          On this phone? <a href={details.otpauth}>Open your authenticator app</a>, or enter this key by hand:
        </p>
        <code className={styles.keyText}>{details.secret}</code>
      </section>

      <label>
        The 6-digit code it shows
        <input type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} spellCheck={false} enterKeyHint="go" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      {error && (
        <p className={styles.problem} role="alert">
          {error}
        </p>
      )}
      <button type="submit" className={styles.primary} disabled={busy}>
        {busy ? "Setting up…" : "Finish"}
      </button>
    </form>
  );
}

function SavedCodes({ codes }: { codes: string[] }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <h1>Save your recovery codes</h1>
      <p className={styles.muted}>If you lose your phone, each of these signs you in once, in place of an authenticator code. They won&apos;t be shown again.</p>
      <ul className={styles.codes}>
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <button type="button" className={styles.secondary} onClick={copy}>
        {copied ? "Copied" : "Copy codes"}
      </button>
      <label className={styles.check}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I&apos;ve saved them somewhere safe
      </label>
      {saved ? (
        <>
          <p className={styles.muted}>When you sign in, wait for a new code in your authenticator app. The one you just used won&apos;t work again.</p>
          <Link href="/" className={styles.primary}>
            Go to sign in
          </Link>
        </>
      ) : null}
    </>
  );
}
