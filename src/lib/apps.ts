/**
 * The apps Desk knows. Each has its own Firebase project; `connected` turns true once
 * its tickets are wired up.
 */
export const DESK_APPS = [
  { slug: "drivsync", title: "DrivSync", accent: "#a855f7", connected: false },
  { slug: "tripsync", title: "TripSync", accent: "#10b981", connected: false },
  { slug: "instagro", title: "Instagro", accent: "#ec4899", connected: false },
];

export const deskApp = (slug: string) => DESK_APPS.find((a) => a.slug === slug);
