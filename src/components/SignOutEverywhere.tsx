"use client";

import { useState } from "react";
import styles from "./Desk.module.css";

export default function SignOutEverywhere() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const signOut = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ everywhere: true }),
      });
      if (res.ok) {
        window.location.assign("/");
        return;
      }
      setError("That didn't work. Try again.");
    } catch {
      setError("No connection. Try again.");
    }
    setBusy(false);
  };

  return (
    <section className={styles.everywhere}>
      <p className={styles.muted}>Lost a phone or laptop? This signs you out on every device, including this one.</p>
      {error && (
        <p className={styles.problem} role="alert">
          {error}
        </p>
      )}
      <button type="button" className={styles.secondary} onClick={signOut} disabled={busy}>
        {busy ? "Signing out…" : "Sign out everywhere"}
      </button>
    </section>
  );
}
