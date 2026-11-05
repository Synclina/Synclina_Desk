import DeskShell from "@/components/DeskShell";
import { DESK_APPS } from "@/lib/apps";
import { canUseApp } from "@/lib/rules";
import { requireStaff } from "@/lib/session";

/** Stays in place between pages, so only the content changes. Each page checks the session too. */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const apps = DESK_APPS.filter((a) => canUseApp(staff, a.slug)).map(({ slug, title }) => ({ slug, title }));
  return <DeskShell apps={apps}>{children}</DeskShell>;
}
