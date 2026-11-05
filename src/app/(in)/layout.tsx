import DeskShell from "@/components/DeskShell";
import { requireStaff } from "@/lib/session";

/** Stays in place between pages, so only the content changes. Each page checks the session too. */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();
  return <DeskShell>{children}</DeskShell>;
}
