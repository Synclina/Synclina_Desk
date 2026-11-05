import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { initializeFirestore, type Firestore } from "firebase-admin/firestore";

const DESK = "desk";
let firestore: Firestore | null = null;

function deskFirebase(): App {
  const existing = getApps().find((a) => a.name === DESK);
  if (existing) return existing;
  // Local emulators need no key.
  if (process.env.FIRESTORE_EMULATOR_HOST) return initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-desk" }, DESK);
  const encoded = process.env.DESK_FIREBASE_KEY_B64;
  if (!encoded) throw new Error("DESK_FIREBASE_KEY_B64 is not set");
  return initializeApp({ credential: cert(JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))) }, DESK);
}

/** Desk's own database: staff, sessions and the activity log. Tickets stay in each app's project. */
export function deskDb(): Firestore {
  // preferRest: much faster to start on a serverless function. The emulator only speaks the default.
  firestore ??= initializeFirestore(deskFirebase(), process.env.FIRESTORE_EMULATOR_HOST ? {} : { preferRest: true });
  return firestore;
}
