import { after } from "next/server";
import QRCode from "qrcode";
import { requestIp, requestPlace, sendAlert, whenIndia } from "@/lib/alerts";
import { deskConfig } from "@/lib/config";
import { finishLink, readLink } from "@/lib/join";
import { PASSWORD_LIMIT, PASSWORD_MIN, validId } from "@/lib/rules";
import { refuseCrossSite } from "@/lib/session";
import { ipUsedUp } from "@/lib/signin";
import { ownerEmails } from "@/lib/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The same for a made-up, used, run-out or taken-back link. */
const badLink = () => Response.json({ error: "This link doesn't work any more. Ask the main account holder for a new one." }, { status: 404 });

export async function POST(req: Request) {
  const refused = refuseCrossSite(req);
  if (refused) return refused;
  if (!deskConfig()) return new Response(null, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const { step, token, password, code } = body ?? {};
  try {
    if (await ipUsedUp(requestIp(req.headers))) {
      return Response.json({ error: "Too many tries from here. Please try again later." }, { status: 429 });
    }
    if (!validId(token)) return badLink();

    if (step === "check") {
      const link = await readLink(token);
      if (!link) return badLink();
      const svg = await QRCode.toString(link.otpauth, { type: "svg", margin: 2 });
      return Response.json({
        email: link.email,
        name: link.name,
        secret: link.secret,
        otpauth: link.otpauth,
        qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      });
    }

    if (step === "finish") {
      if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > PASSWORD_LIMIT) {
        return Response.json({ error: `Choose a password of at least ${PASSWORD_MIN} characters.` }, { status: 422 });
      }
      if (typeof code !== "string" || code.length > 20) {
        return Response.json({ error: "That code didn't match. Wait for the next one and try again." }, { status: 422 });
      }
      const place = requestPlace(req.headers);
      const result = await finishLink(token, password, code, place);
      if (result.outcome === "link") return badLink();
      if (result.outcome === "code") return Response.json({ error: "That code didn't match. Wait for the next one and try again." }, { status: 422 });
      after(async () =>
        sendAlert(await ownerEmails(), "Synclina Desk: someone finished joining", [
          `${result.name} (${result.email}) finished setting up their account at ${whenIndia()} IST, from ${place}.`,
        ]),
      );
      return Response.json({ ok: true, recovery: result.recovery });
    }
    return Response.json({ error: "Not allowed." }, { status: 400 });
  } catch (e) {
    console.error("[join] failed", e instanceof Error ? e.message : "error");
    return Response.json({ error: "This isn't available right now. Try again in a moment." }, { status: 503 });
  }
}
