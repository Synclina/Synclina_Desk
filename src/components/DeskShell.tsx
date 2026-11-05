import Link from "next/link";
import DeskNav from "./DeskNav";
import SignOutButton from "./SignOutButton";
import SynclinaMark from "./SynclinaMark";
import styles from "./Desk.module.css";

export default function DeskShell({ apps, children }: { apps: { slug: string; title: string }[]; children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/home" className={styles.brand} aria-label="Overview">
          <SynclinaMark size={26} />
        </Link>
        <DeskNav apps={apps} />
        <SignOutButton />
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

export function LoadProblem() {
  return <p className={styles.problem}>This couldn&apos;t load. Refresh the page in a moment.</p>;
}
