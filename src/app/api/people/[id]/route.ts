import { sendLink } from "@/lib/alerts";
import { DESK_APPS } from "@/lib/apps";
import { joinLink, removePerson, resetPerson, setPersonApps } from "@/lib/people";
import { readApps, validId } from "@/lib/rules";
import { currentStaff, refuseCrossSite } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Changes one person. Main account only, and never the main account itself. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = refuseCrossSite(req);
  if (refused) return refused;
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const nothing = () => Response.json({ error: "Not found." }, { status: 404 });
  if (staff.role !== "owner") return nothing();

  const id = (await params).id;
  if (!validId(id)) return nothing();
  const body = (await req.json().catch(() => null)) as { action?: unknown; apps?: unknown } | null;

  try {
    if (body?.action === "apps") {
      const apps = readApps(body.apps, DESK_APPS.map((a) => a.slug));
      if (!apps) return Response.json({ error: "That change wasn't valid." }, { status: 422 });
      return (await setPersonApps(staff, id, apps)) ? Response.json({ ok: true }) : nothing();
    }
    if (body?.action === "reset") {
      const issued = await resetPerson(staff, id);
      if (!issued) return nothing();
      const link = joinLink(req.headers.get("origin")!, issued.token);
      const emailed = await sendLink("reset", issued.email, link, issued.expiresAt);
      return Response.json({ ok: true, email: issued.email, link, emailed });
    }
    if (body?.action === "remove") {
      return (await removePerson(staff, id)) ? Response.json({ ok: true }) : nothing();
    }
    return Response.json({ error: "That change wasn't valid." }, { status: 422 });
  } catch (e) {
    console.error("[people] change failed", e instanceof Error ? e.message : "error");
    return Response.json({ error: "Not saved. Please try again." }, { status: 503 });
  }
}
