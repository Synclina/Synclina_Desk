import { after } from "next/server";
import { requestIp, requestPlace, sendAlert, whenIndia } from "@/lib/alerts";
import { deskConfig } from "@/lib/config";
import { refuseCrossSite, startSession } from "@/lib/session";
import { checkSignIn, ipUsedUp } from "@/lib/signin";
import { ownerEmails } from "@/lib/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WRONG = "That didn't work. Check your details and try again. After several wrong tries, sign-in pauses for a while.";
const wrong = () => Response.json({ error: WRONG }, { status: 401 });

export async function POST(req: Request) {
  const refused = refuseCrossSite(req);
  if (refused) return refused;
  if (!deskConfig()) return new Response(null, { status: 404 });

  let email: unknown, password: unknown, code: unknown;
  try {
    ({ email, password, code } = (await req.json()) as Record<string, unknown>);
  } catch {
    return Response.json({ error: "Not allowed." }, { status: 400 });
  }
  if (typeof email !== "string" || typeof password !== "string" || typeof code !== "string") return wrong();
  if (email.length > 254 || password.length > 200 || code.length > 20) return wrong();

  try {
    if (await ipUsedUp(requestIp(req.headers))) {
      return Response.json({ error: "Too many tries from here. Please try again later." }, { status: 429 });
    }
    const place = requestPlace(req.headers);
    const result = await checkSignIn(email, password, code, place);
    const staff = result.staff;
    if (result.outcome === "ok" && staff) {
      await startSession(staff.id);
      // Sent after answering, so the email never slows signing in.
      after(() =>
        sendAlert([staff.email], "Synclina Desk: you signed in", [
          `Your Desk account signed in at ${whenIndia()} IST, from ${place}.`,
          result.usedRecovery ? "A recovery code was used. It can't be used again." : "",
          "If this wasn't you, tell the main account holder straight away.",
        ]),
      );
      return Response.json({ ok: true, to: "/home" });
    }
    if (result.lockedNow && staff) {
      after(async () =>
        sendAlert([staff.email, ...(await ownerEmails())], "Synclina Desk: sign-in locked", [
          `Too many wrong tries on ${staff.email} at ${whenIndia()} IST, from ${place}. That account's sign-in is locked for a while.`,
        ]),
      );
    }
    return wrong();
  } catch (e) {
    console.error("[login] failed", e instanceof Error ? e.message : "error");
    return Response.json({ error: "Sign-in isn't available right now." }, { status: 503 });
  }
}
