import { deskApp } from "@/lib/apps";
import { readTicketChange } from "@/lib/rules";
import { currentStaff, refuseCrossSite } from "@/lib/session";
import { NoAccess, changeTicket } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ app: string }> }) {
  const refused = refuseCrossSite(req);
  if (refused) return refused;
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: "Please sign in again." }, { status: 401 });

  const nothing = () => Response.json({ error: "Not found." }, { status: 404 });
  const slug = (await params).app;
  const app = deskApp(slug);
  if (!app) return nothing();

  const change = readTicketChange(await req.json().catch(() => null), app.prefixes);
  if (!change) return Response.json({ error: "That change wasn't valid." }, { status: 422 });

  try {
    const saved = await changeTicket(staff, slug, change);
    if (!saved) return Response.json({ error: "This ticket no longer exists. The user may have deleted their account." }, { status: 404 });
    return Response.json({ ok: true, ...saved });
  } catch (e) {
    // Looks the same as an app that doesn't exist.
    if (e instanceof NoAccess) return nothing();
    console.error("[tickets] not saved", e instanceof Error ? e.message : "error");
    return Response.json({ error: "Not saved. Please try again." }, { status: 503 });
  }
}
