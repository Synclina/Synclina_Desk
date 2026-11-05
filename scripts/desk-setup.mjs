// Sets up Desk's main account. Run it yourself: npm run desk:setup
// Add --reset to give the main account a new password, authenticator and recovery codes.
// It writes .env.desk (never committed) with the values for Vercel.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createInterface } from "node:readline/promises";
import QRCode from "qrcode";
import {
  encryptSecret,
  hashSecret,
  newEncryptionKey,
  newRecoveryCode,
  normalizeRecoveryCode,
  sha256,
  staffIdForEmail,
} from "../src/lib/crypto.ts";
import { PASSWORD_MIN, normalizeEmail, validEmail } from "../src/lib/rules.ts";
import { matchTotp, newTotpSecret, otpauthUrl } from "../src/lib/totp.ts";

const require = createRequire(import.meta.url);
const { cert, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const OUTPUT = ".env.desk";
const APP_PROJECTS = ["drivsync-2034b"];
const reset = process.argv.includes("--reset");

/** Reads a line without showing what is typed. */
function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const input = process.stdin;
    input.setRawMode?.(true);
    input.resume();
    input.setEncoding("utf8");
    let text = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          input.setRawMode?.(false);
          input.pause();
          input.off("data", onData);
          process.stdout.write("\n");
          resolve(text);
          return;
        }
        if (ch === "\u0003") process.exit(1);
        text = ch === "\b" || ch === "\u007f" ? text.slice(0, -1) : text + ch;
      }
    };
    input.on("data", onData);
  });
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(question)).trim();
  rl.close();
  return answer;
}

const envValue = (text, name) => text.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim() ?? "";
const existing = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";

// The Firebase key
let keyB64 = envValue(existing, "DESK_FIREBASE_KEY_B64");
if (!keyB64) {
  const keyPath = (await ask("Path of the Desk Firebase key file: ")).replace(/^"|"$/g, "");
  keyB64 = Buffer.from(readFileSync(keyPath, "utf8")).toString("base64");
}
const key = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8"));
if (APP_PROJECTS.includes(key.project_id)) {
  console.error(`This key is for "${key.project_id}", an app's project. Desk needs its own Firebase project.`);
  process.exit(1);
}
console.log(`Using Firebase project: ${key.project_id}`);
const db = getFirestore(initializeApp({ credential: cert(key) }));

// The account
const emailAnswer = await ask("Main account email [synclinaai@gmail.com]: ");
const email = normalizeEmail(emailAnswer || "synclinaai@gmail.com");
if (!validEmail(email)) {
  console.error("That doesn't look like an email address.");
  process.exit(1);
}
const name = (await ask("Your name, as shown in the activity log [Synclina]: ")) || "Synclina";
const id = staffIdForEmail(email);
const ref = db.collection("staff").doc(id);
const already = await ref.get();
if (already.exists && !reset) {
  console.error("This account already exists. To give it new details, run: npm run desk:setup -- --reset");
  process.exit(1);
}

let password;
for (;;) {
  password = await askHidden(`Choose a password (at least ${PASSWORD_MIN} characters): `);
  if (password.length < PASSWORD_MIN) {
    console.log("Too short.");
    continue;
  }
  if ((await askHidden("Type it again: ")) === password) break;
  console.log("They didn't match. Try again.");
}

// The authenticator: proved working before anything is saved, so this can't lock you out.
const totp = newTotpSecret();
console.log("\nScan this with your authenticator app (Google Authenticator, Authy…):\n");
console.log(await QRCode.toString(otpauthUrl(totp, email, "Synclina Desk"), { type: "terminal", small: true }));
console.log(`Can't scan it? Enter this key by hand: ${totp}\n`);
for (;;) {
  const code = await ask("Enter the 6-digit code it shows, to check it works: ");
  if (matchTotp(totp, code, Date.now()) !== null) break;
  console.log("That code didn't match. Wait for the next one and try again.");
}

console.log("Working…");
const encryptionKey = envValue(existing, "DESK_ENCRYPTION_KEY") || newEncryptionKey();
const recovery = Array.from({ length: 8 }, newRecoveryCode);

await ref.set({
  email,
  name,
  role: "owner",
  apps: [],
  active: true,
  passwordHash: await hashSecret(password),
  totpSecret: encryptSecret(totp, encryptionKey, id),
  recoveryHashes: recovery.map((c) => sha256(normalizeRecoveryCode(c))),
  usedRecovery: [],
  fails: 0,
  lockedUntil: 0,
  lastTotpStep: 0,
  createdAt: Date.now(),
});
const sessions = await db.collection("sessions").where("staffId", "==", id).get();
await Promise.all(sessions.docs.map((d) => d.ref.delete()));
await db.collection("activity").add({
  actorId: id,
  actor: name,
  action: already.exists ? "Main account details were reset" : "Main account was created",
  detail: "From the setup script",
  app: null,
  at: FieldValue.serverTimestamp(),
});

writeFileSync(OUTPUT, [`DESK_ENCRYPTION_KEY=${encryptionKey}`, `DESK_FIREBASE_KEY_B64=${keyB64}`, ""].join("\n"), { mode: 0o600 });

console.log("\nSave these recovery codes somewhere safe. Each one works once, if you lose your phone:\n");
for (const code of recovery) console.log(`   ${code}`);
console.log(`\nDone. Add the two values in ${OUTPUT} to Vercel, for Production only.`);
console.log(`Keep DESK_ENCRYPTION_KEY safe: without it, nobody's authenticator can be read. Then delete ${OUTPUT}.\n`);
process.exit(0);
