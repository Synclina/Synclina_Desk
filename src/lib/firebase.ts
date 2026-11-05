import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { initializeFirestore, type Firestore } from "firebase-admin/firestore";
import type { DeskApp } from "./apps";
import { keyFitsProject } from "./rules";

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

const keyName = (slug: string) => `APP_${slug.toUpperCase()}_FIREBASE_KEY_B64`;

/** An app is connected once its key is added. */
export const appConnected = (slug: string) => Boolean(process.env[keyName(slug)]);

function appFirebase(app: DeskApp): App {
  const name = `app-${app.slug}`;
  const existing = getApps().find((a) => a.name === name);
  if (existing) return existing;
  // On the local emulators, each app is a project of its own too.
  if (process.env.FIRESTORE_EMULATOR_HOST) return initializeApp({ projectId: `demo-app-${app.slug}` }, name);
  const encoded = process.env[keyName(app.slug)];
  if (!encoded) throw new Error(`${app.slug} isn't connected`);
  const key = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  if (!keyFitsProject(key.project_id, app.firebaseProject)) throw new Error(`The key for ${app.slug} is for another project`);
  return initializeApp({ credential: cert(key) }, name);
}

const appStores = new Map<string, Firestore>();

/** An app's own database. Only tickets.ts calls this, after checking access. */
export function appDb(app: DeskApp): Firestore {
  let store = appStores.get(app.slug);
  if (!store) {
    store = initializeFirestore(appFirebase(app), process.env.FIRESTORE_EMULATOR_HOST ? {} : { preferRest: true });
    appStores.set(app.slug, store);
  }
  return store;
}

/** Loaded only when needed, so saving a ticket starts faster. */
export async function appAuth(app: DeskApp) {
  const { getAuth } = await import("firebase-admin/auth");
  return getAuth(appFirebase(app));
}
