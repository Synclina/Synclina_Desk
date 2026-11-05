import SignOutEverywhere from "@/components/SignOutEverywhere";
import styles from "@/components/Desk.module.css";
import { DESK_APPS } from "@/lib/apps";
import { canUseApp } from "@/lib/rules";
import { requireStaff } from "@/lib/session";

export default async function Account() {
  const staff = await requireStaff();
  const apps = DESK_APPS.filter((a) => canUseApp(staff, a.slug)).map((a) => a.title);

  return (
    <div className={styles.pageIn}>
      <h1 className={styles.pageTitle}>Your account</h1>
      <dl className={styles.details}>
        <div>
          <dt>Name</dt>
          <dd>{staff.name}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{staff.email}</dd>
        </div>
        <div>
          <dt>Access</dt>
          <dd>{staff.role === "owner" ? "Main account: all apps" : apps.join(", ") || "No apps yet"}</dd>
        </div>
      </dl>
      <SignOutEverywhere />
    </div>
  );
}
