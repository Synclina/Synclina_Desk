import { sendLink } from "@/lib/alerts";
import { DESK_APPS } from "@/lib/apps";
import { invitePerson, joinLink } from "@/lib/people";
import { readInvite } from "@/lib/rules";
import { currentStaff, refuseCrossSite } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Invites someone. Main account only; anyone else finds nothing here. */
export async function POST(req: Request) {
  const refused = refuseCrossSite(req);
  if (refused) return refused;
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: "Please sign in again." }, { status: 401 });
  if (staff.role !== "owner") return Response.json({ error: "Not found." }, { status: 404 });

  const request = readInvite(await req.json().catch(() => null), DESK_APPS.map((a) => a.slug));
  if (!request) return Response.json({ error: "Check the email and name, and choose at least one app." }, { status: 422 });

  try {
    const issued = await invitePerson(staff, request);
    if (issued === "exists") return Response.json({ error: "This email already has an account. Find them in the list below." }, { status: 409 });
    const link = joinLink(req.headers.get("origin")!, issued.token);
    const emailed = await sendLink("invite", issued.email, link, issued.expiresAt);
    return Response.json({ ok: true, email: issued.email, link, emailed });
  } catch (e) {
    console.error("[people] invite failed", e instanceof Error ? e.message : "error");
    return Response.json({ error: "Not saved. Please try again." }, { status: 503 });
  }
}
