import { logActivity } from "@/lib/activity";
import { currentStaff, endAllSessions, endSession, refuseCrossSite } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Signs out this browser, or every browser with { everywhere: true }. */
export async function POST(req: Request) {
  const refused = refuseCrossSite(req);
  if (refused) return refused;
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { everywhere?: unknown };
  try {
    if (body.everywhere === true) {
      await endAllSessions(staff.id);
      await logActivity({ actor: staff, action: "Signed out everywhere" });
    } else {
      await logActivity({ actor: staff, action: "Signed out" });
    }
    await endSession();
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[logout] failed", e instanceof Error ? e.message : "error");
    return Response.json({ error: "That didn't work. Try again." }, { status: 503 });
  }
}
