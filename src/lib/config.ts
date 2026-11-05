export type DeskConfig = { encryptionKey: string };

/**
 * What Desk needs to run, or null when anything is missing. Also null on Vercel preview
 * deployments, so they can never sign anyone in even if a value leaks there.
 */
export function deskConfig(): DeskConfig | null {
  if (process.env.VERCEL_ENV === "preview") return null;
  const encryptionKey = process.env.DESK_ENCRYPTION_KEY;
  if (!encryptionKey || Buffer.from(encryptionKey, "base64url").length !== 32) return null;
  return { encryptionKey };
}
