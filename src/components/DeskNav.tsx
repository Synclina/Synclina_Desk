"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Desk.module.css";

export default function DeskNav({ apps, showPeople }: { apps: { slug: string; title: string }[]; showPeople: boolean }) {
  const path = usePathname();
  const links = [
    { href: "/home", label: "Overview" },
    ...apps.map((a) => ({ href: `/apps/${a.slug}`, label: a.title })),
    ...(showPeople ? [{ href: "/people", label: "People" }] : []),
    { href: "/activity", label: "Activity" },
    { href: "/account", label: "Account" },
  ];
  return (
    <nav className={styles.nav} aria-label="Desk">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={path === l.href ? styles.navActive : styles.navLink} aria-current={path === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
