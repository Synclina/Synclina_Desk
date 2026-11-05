import { notFound } from "next/navigation";
import { LoadProblem } from "@/components/DeskShell";
import PeopleBoard from "@/components/PeopleBoard";
import styles from "@/components/Desk.module.css";
import { DESK_APPS } from "@/lib/apps";
import { listPeople, type Person } from "@/lib/people";
import { requireStaff } from "@/lib/session";

export default async function People() {
  const staff = await requireStaff();
  if (staff.role !== "owner") notFound();

  let people: Person[] | null = null;
  try {
    people = await listPeople(staff);
  } catch (e) {
    console.error("[people] not loaded", e instanceof Error ? e.message : "error");
  }

  return (
    <div className={styles.pageIn}>
      <h1 className={styles.pageTitle}>People</h1>
      {people ? <PeopleBoard people={people} apps={DESK_APPS.map(({ slug, title }) => ({ slug, title }))} /> : <LoadProblem />}
    </div>
  );
}
