"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Desk.module.css";

const LINKS = [
  { href: "/home", label: "Overview" },
  { href: "/activity", label: "Activity" },
  { href: "/account", label: "Account" },
];

export default function DeskNav() {
  const path = usePathname();
  return (
    <nav className={styles.nav} aria-label="Desk">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={path === l.href ? styles.navActive : styles.navLink} aria-current={path === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
