/** Security emails. A failed email never blocks anything. True when it was accepted for sending. */
export async function sendAlert(to: string[], subject: string, lines: string[]): Promise<boolean> {
  const key = process.env.BREVO_API_KEY;
  const sender = process.env.DESK_ALERT_SENDER;
  if (!key || !sender || to.length === 0) return false;
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "Synclina Desk", email: sender },
        to: [...new Set(to)].map((email) => ({ email })),
        subject,
        textContent: lines.join("\n"),
        tags: ["desk-alert"],
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) console.error("[alert] Brevo answered", res.status);
    return res.ok;
  } catch (e) {
    console.error("[alert] not sent", e instanceof Error ? e.name : "error");
    return false;
  }
}

export function requestIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown address";
}

/** Who made a request, for the alert email and the activity log. */
export function requestPlace(headers: Headers): string {
  const city = headers.get("x-vercel-ip-city");
  const ip = requestIp(headers);
  return city ? `${ip} (${decodeURIComponent(city)})` : ip;
}

export const whenIndia = (at = new Date()) =>
  at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

/** Sends someone their link to set up or reset their account. */
export function sendLink(kind: "invite" | "reset", to: string, link: string, expiresAt: number): Promise<boolean> {
  return sendAlert(
    [to],
    kind === "invite" ? "You're invited to Synclina Desk" : "Synclina Desk: choose a new password",
    [
      kind === "invite"
        ? "You've been invited to Synclina Desk. Use this link to choose a password and add Desk to your authenticator app:"
        : "Your Desk sign-in was reset by the main account holder. Use this link to choose a new password and add Desk to your authenticator app again:",
      "",
      link,
      "",
      `It works once, until ${whenIndia(new Date(expiresAt))} IST. Don't share it. If you weren't expecting this, you can ignore it.`,
    ],
  );
}
