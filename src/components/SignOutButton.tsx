"use client";

import styles from "./Desk.module.css";

export default function SignOutButton() {
  const signOut = async () => {
    try {
      await fetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } finally {
      window.location.assign("/");
    }
  };
  return (
    <button type="button" className={styles.signOut} onClick={signOut}>
      Sign out
    </button>
  );
}
