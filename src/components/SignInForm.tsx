"use client";

import { useState, type FormEvent } from "react";
import SynclinaMark from "./SynclinaMark";
import styles from "./Desk.module.css";

export default function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, code }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; to?: string };
      if (res.ok && data.to) {
        window.location.assign(data.to);
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
    <main className={styles.signInPage}>
      <form className={styles.signIn} onSubmit={submit}>
        <SynclinaMark size={36} />
        <h1>Synclina Desk</h1>
        <label>
          Email
          <input type="email" autoComplete="username" autoCapitalize="none" autoFocus required maxLength={254} spellCheck={false} enterKeyHint="next" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required maxLength={200} enterKeyHint="next" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>
          Authenticator code
          <input type="text" autoComplete="one-time-code" required maxLength={20} spellCheck={false} enterKeyHint="go" value={code} onChange={(e) => setCode(e.target.value)} />
          <small>Lost your phone? Enter a recovery code instead.</small>
        </label>
        {error && (
          <p className={styles.problem} role="alert">
            {error}
          </p>
        )}
        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
