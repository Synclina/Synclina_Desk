/**
 * The apps Desk knows. Each has its own Firebase project, and is connected by adding its
 * key in Vercel as APP_<SLUG>_FIREBASE_KEY_B64. Set `firebaseProject` when connecting one:
 * a key for any other project is then refused, so an app can't show another's tickets.
 */
export type DeskApp = { slug: string; title: string; accent: string; prefixes: string[]; firebaseProject?: string };

export const DESK_APPS: DeskApp[] = [
  { slug: "drivsync", title: "DrivSync", accent: "#a855f7", prefixes: ["DS", "FS"], firebaseProject: "drivsync-2034b" },
  { slug: "tripsync", title: "TripSync", accent: "#10b981", prefixes: ["TS"] },
  { slug: "instagro", title: "Instagro", accent: "#ec4899", prefixes: ["IG"] },
];

export const deskApp = (slug: string) => DESK_APPS.find((a) => a.slug === slug);
