/** Security emails. A failed email never blocks anything. */
export async function sendAlert(to: string[], subject: string, lines: string[]): Promise<void> {
  const key = process.env.BREVO_API_KEY;
  const sender = process.env.DESK_ALERT_SENDER;
  if (!key || !sender || to.length === 0) return;
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
  } catch (e) {
    console.error("[alert] not sent", e instanceof Error ? e.name : "error");
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

export const whenIndia = () =>
  new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
