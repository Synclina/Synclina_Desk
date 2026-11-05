// End-to-end check against a real build and the local Firestore emulator. Nothing here
// touches a real project. First, in another terminal (needs Java 21):
//   firebase emulators:start --only firestore,auth --project demo-desk
// Then: NEXT_DIST_DIR=.next-prod npm run build, and npm run test:e2e
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { encryptSecret, hashSecret, newEncryptionKey, newRecoveryCode, normalizeRecoveryCode, sha256, staffIdForEmail } from "../src/lib/crypto.ts";
import { codeForStep, newTotpSecret, stepAt } from "../src/lib/totp.ts";

const require = createRequire(import.meta.url);
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8186";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9199";
const { initializeApp } = require("firebase-admin/app");
const { Timestamp, getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const db = getFirestore(initializeApp({ projectId: "demo-desk" }));
// Two apps, each a project of its own, to prove the wall between them.
const drivApp = initializeApp({ projectId: "demo-app-drivsync" }, "driv");
const tripApp = initializeApp({ projectId: "demo-app-tripsync" }, "trip");
const driv = getFirestore(drivApp);
const trip = getFirestore(tripApp);

const PORT = 3200;
const PREVIEW_PORT = 3201;
const O = `http://localhost:${PORT}`;
const KEY = newEncryptionKey();
const PW = "test-password-for-e2e-only";
const env = { ...process.env, DESK_ENCRYPTION_KEY: KEY, GCLOUD_PROJECT: "demo-desk", NEXT_DIST_DIR: ".next-prod", NODE_ENV: "production", BREVO_API_KEY: "", APP_DRIVSYNC_FIREBASE_KEY_B64: "emulator", APP_TRIPSYNC_FIREBASE_KEY_B64: "emulator", APP_INSTAGRO_FIREBASE_KEY_B64: "" };

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`);
};

// Each test gets its own address, so the per-address limit is tested on its own.
let ipCounter = 0;
const nextIp = () => `203.0.113.${++ipCounter}`;
const get = (p, cookie) => fetch(O + p, { redirect: "manual", headers: cookie ? { cookie } : {} });
const post = (p, body, { cookie, origin = O, type = "application/json", ip = nextIp() } = {}) =>
  fetch(O + p, {
    method: "POST",
    redirect: "manual",
    headers: { ...(origin ? { origin } : {}), ...(type ? { "content-type": type } : {}), ...(cookie ? { cookie } : {}), "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });

const people = {};
async function addPerson(key, email, role, apps, active = true) {
  const id = staffIdForEmail(email);
  const totp = newTotpSecret();
  const recovery = [newRecoveryCode(), newRecoveryCode()];
  await db.collection("staff").doc(id).set({
    email, name: key, role, apps, active,
    passwordHash: await hashSecret(PW),
    totpSecret: encryptSecret(totp, KEY, id),
    recoveryHashes: recovery.map((c) => sha256(normalizeRecoveryCode(c))),
    usedRecovery: [], fails: 0, lockedUntil: 0, lastTotpStep: 0, createdAt: Date.now(),
  });
  people[key] = { id, email, totp, recovery, code: (d = 0) => codeForStep(totp, stepAt(Date.now()) + d) };
}

for (const c of ["staff", "sessions", "activity", "sign_in_limits"]) await db.recursiveDelete(db.collection(c));
await addPerson("Owner", "owner@example.test", "owner", []);
await addPerson("Maya", "maya@example.test", "maintainer", ["drivsync"]);
await addPerson("Tara", "tara@example.test", "maintainer", ["tripsync"]);
await addPerson("Locky", "locky@example.test", "maintainer", ["drivsync"]);
await addPerson("Recov", "recov@example.test", "maintainer", ["drivsync"]);
await addPerson("Gone", "gone@example.test", "maintainer", ["drivsync"], false);

// Tickets
const at = (mins) => Timestamp.fromMillis(Date.now() - mins * 60000);
await driv.recursiveDelete(driv.collection("accounts"));
await driv.recursiveDelete(driv.collection("other"));
await trip.recursiveDelete(trip.collection("accounts"));
await getAuth(drivApp).createUser({ uid: "riderA", displayName: "Asha Rider", email: "asha@example.test" }).catch(() => {});
await getAuth(tripApp).createUser({ uid: "riderA", displayName: "Tripper Tom", email: "tom@example.test" }).catch(() => {});
await driv.doc("accounts/riderA/support/DS-AAAA22").set({ subject: "Backup stuck on Syncing", topic: "Backup", channel: "sent", message: "My backup is stuck.", createdAt: at(5), status: "open" });
await driv.doc("accounts/riderA/support/FS-BBBB33").set({ subject: "Old drive ticket", topic: "Other", channel: "emailApp", createdAt: at(50), status: "fixed", teamNote: "Sorted" });
await driv.doc("other/thing/support/DS-NOTKET").set({ subject: "NOT A TICKET", createdAt: at(1), status: "open" });
await trip.doc("accounts/riderA/support/TS-CCCC44").set({ subject: "Trip secret subject", topic: "Trips", channel: "sent", message: "Private trip message.", createdAt: at(5), status: "open" });

const server = spawn("npx", ["next", "start", "-p", String(PORT)], { shell: true, env, stdio: "ignore" });
const preview = spawn("npx", ["next", "start", "-p", String(PREVIEW_PORT)], { shell: true, env: { ...env, VERCEL_ENV: "preview" }, stdio: "ignore" });
const stop = () => {
  for (const p of [server, preview]) {
    if (process.platform === "win32") spawn("taskkill", ["/F", "/T", "/PID", String(p.pid)], { stdio: "ignore" });
    else p.kill();
  }
};
const waitFor = async (url) => {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`${url} didn't start`);
};

const signIn = (person, code = person.code(), opts) => post("/api/login", { email: person.email, password: PW, code }, opts);
const cookieOf = (r) => (r.headers.get("set-cookie") ?? "").split(";")[0];

try {
  await waitFor(`${O}/robots.txt`);
  await waitFor(`http://localhost:${PREVIEW_PORT}/robots.txt`);

  // The sign-in page and its protections
  let r = await get("/");
  let page = await r.text();
  ok("sign-in page answers", r.status === 200 && page.includes("Authenticator code") && page.includes("Email"));
  const csp = r.headers.get("content-security-policy") ?? "";
  ok("strict policy with a nonce", /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(csp) && csp.includes("frame-ancestors 'none'"));
  ok("page uses that nonce", page.includes(`nonce="${csp.match(/'nonce-([^']+)'/)?.[1]}"`));
  ok("hidden from search engines", /noindex/.test(r.headers.get("x-robots-tag") ?? ""));
  ok("never cached", /no-store/.test(r.headers.get("cache-control") ?? ""));
  ok("robots.txt blocks everything", (await (await get("/robots.txt")).text()).includes("Disallow: /"));
  ok("no framework banner", !r.headers.get("x-powered-by"));
  for (const s of [KEY, people.Owner.totp]) ok("secrets are not in the page", !page.includes(s));

  r = await fetch(`http://localhost:${PREVIEW_PORT}/`, { redirect: "manual" });
  ok("preview deployments answer nothing", r.status === 404);
  r = await fetch(`http://localhost:${PREVIEW_PORT}/api/login`, { method: "POST", redirect: "manual" });
  ok("preview deployments can't sign in", r.status === 404);

  // Nothing without a session
  for (const p of ["/home", "/activity", "/account"]) {
    r = await get(p);
    ok(`${p} sends strangers to sign-in`, r.status === 307 && r.headers.get("location")?.endsWith("/") === true, `${r.status}`);
  }
  r = await get("/home", "__Host-desk_session=made-up-value");
  ok("a made-up cookie gets nowhere", r.status === 307);
  r = await post("/api/logout", {});
  ok("sign-out without a session is refused", r.status === 401);

  // Refused sign-ins all look the same
  const A = people.Maya;
  r = await signIn(A, A.code(), { origin: "https://evil.example" });
  ok("sign-in from another site refused", r.status === 403);
  r = await signIn(A, A.code(), { origin: null });
  ok("sign-in with no origin refused", r.status === 403);
  r = await signIn(A, A.code(), { type: "text/plain" });
  ok("sign-in that isn't JSON refused", r.status === 415);

  const answer = async (body) => {
    const res = await post("/api/login", body);
    return { status: res.status, text: await res.text(), cookie: res.headers.get("set-cookie") };
  };
  const wrongPassword = await answer({ email: A.email, password: "nope-nope-nope-nope", code: A.code() });
  const wrongCode = await answer({ email: A.email, password: PW, code: "000000" });
  const unknown = await answer({ email: "nobody@example.test", password: PW, code: "000000" });
  const turnedOff = await answer({ email: people.Gone.email, password: PW, code: people.Gone.code() });
  ok("wrong password refused", wrongPassword.status === 401);
  ok("wrong code refused", wrongCode.status === 401);
  ok("unknown email refused", unknown.status === 401);
  ok("turned-off person refused", turnedOff.status === 401);
  ok("all four answers are identical", new Set([wrongPassword, wrongCode, unknown, turnedOff].map((a) => a.text)).size === 1);
  ok("none of them made a session", (await db.collection("sessions").get()).empty && !wrongPassword.cookie);
  r = await post("/api/login", { email: A.email, password: "x".repeat(201), code: "000000" });
  ok("oversized password refused", r.status === 401);
  r = await post("/api/login", { email: { $ne: 1 }, password: PW, code: "000000" });
  ok("non-text fields refused", r.status === 401);

  // A real sign-in
  const used = A.code();
  r = await signIn(A, used);
  ok("right details sign in", r.status === 200, `${r.status}`);
  ok("sends them home", (await r.json()).to === "/home");
  const set = r.headers.get("set-cookie") ?? "";
  ok("cookie is locked down", /__Host-desk_session=/.test(set) && /HttpOnly/i.test(set) && /Secure/i.test(set) && /SameSite=Strict/i.test(set) && /Path=\//i.test(set), set);
  const mayaCookie = set.split(";")[0];
  const token = mayaCookie.split("=")[1];
  const sessions = await db.collection("sessions").get();
  ok("only a hash of the session is stored", sessions.size === 1 && sessions.docs[0].id === sha256(token) && !JSON.stringify(sessions.docs[0].data()).includes(token));
  const stored = (await db.collection("staff").doc(A.id).get()).data();
  ok("the database has no plain password or authenticator key", !JSON.stringify(stored).includes(PW) && !JSON.stringify(stored).includes(A.totp));

  r = await signIn(A, used);
  ok("the same code can't be used twice", r.status === 401);
  await db.collection("staff").doc(A.id).update({ fails: 0 });

  r = await get("/home", mayaCookie);
  page = await r.text();
  ok("home opens with the session", r.status === 200 && page.includes("Hello, "));
  ok("a maintainer sees their app", page.includes("DrivSync"));
  ok("a maintainer doesn't see other apps", !page.includes("TripSync") && !page.includes("Instagro"));
  r = await get("/", mayaCookie);
  ok("the sign-in page skips ahead when signed in", r.status === 307 && r.headers.get("location")?.endsWith("/home") === true);
  r = await get("/account", mayaCookie);
  page = await r.text();
  ok("account page shows their access", page.includes(A.email) && page.includes("DrivSync"));

  // The main account
  const B = people.Owner;
  r = await signIn(B);
  ok("main account signs in", r.status === 200);
  const ownerCookie = cookieOf(r);
  page = await (await get("/home", ownerCookie)).text();
  ok("main account sees every app", ["DrivSync", "TripSync", "Instagro"].every((a) => page.includes(a)));

  // Activity is scoped on the server
  const T = people.Tara;
  r = await signIn(T);
  const taraCookie = cookieOf(r);
  await db.collection("activity").add({ actorId: "someone", actor: "Colleague", action: "Changed a DrivSync ticket", detail: "", app: "drivsync", at: new Date() });
  await db.collection("activity").add({ actorId: "someone", actor: "Colleague", action: "Changed a TripSync ticket", detail: "", app: "tripsync", at: new Date() });
  page = await (await get("/activity", ownerCookie)).text();
  ok("main account's activity shows everyone", ["Changed a DrivSync ticket", "Changed a TripSync ticket", "Maya: Signed in", "Tara: Signed in"].every((t) => page.replace(/<!-- -->/g, "").includes(t)));
  page = (await (await get("/activity", mayaCookie)).text()).replace(/<!-- -->/g, "");
  ok("a maintainer sees their own actions and app", page.includes("Maya: Signed in") && page.includes("Changed a DrivSync ticket"));
  ok("a maintainer doesn't see others' actions", !page.includes("Changed a TripSync ticket") && !page.includes("Tara: Signed in") && !page.includes("Owner: Signed in"));

  // Tickets: the wall between apps
  const plain = async (p, cookie) => (await (await get(p, cookie)).text()).replace(/<!-- -->/g, "");
  r = await get("/apps/drivsync", mayaCookie);
  page = (await r.text()).replace(/<!-- -->/g, "");
  ok("a maintainer opens their app's tickets", r.status === 200 && page.includes("Backup stuck on Syncing") && page.includes("Old drive ticket"));
  ok("the user's name comes from that app's accounts", page.includes("Asha Rider") && !page.includes("Tripper Tom"));
  ok("a same-named collection isn't a ticket", !page.includes("NOT A TICKET"));
  ok("another app's ticket isn't on their page", !page.includes("Trip secret subject") && !page.includes("Private trip message"));
  r = await get("/apps/tripsync", mayaCookie);
  page = await r.text();
  ok("another app's page is not found", r.status === 404 || page.includes("NEXT_HTTP_ERROR_FALLBACK;404"), `${r.status}`);
  ok("and shows none of its tickets", !page.includes("Trip secret subject") && !page.includes("Private trip message"));
  page = await plain("/home", mayaCookie);
  ok("home counts their app", page.includes("Pending") && page.includes("/apps/drivsync") && !page.includes("/apps/tripsync"));
  page = await plain("/apps/tripsync", taraCookie);
  ok("the other maintainer sees only theirs", page.includes("Trip secret subject") && page.includes("Tripper Tom") && !page.includes("Backup stuck"));
  page = await plain("/apps/drivsync", taraCookie);
  ok("and not this one", !page.includes("Backup stuck on Syncing"));
  page = await plain("/apps/drivsync", ownerCookie);
  ok("main account opens DrivSync", page.includes("Backup stuck on Syncing"));
  page = await plain("/apps/tripsync", ownerCookie);
  ok("main account opens TripSync", page.includes("Trip secret subject"));
  page = await plain("/apps/instagro", ownerCookie);
  ok("an app with no key says so", page.replace(/&#x27;/g, "'").includes("isn't connected yet"));
  r = await get("/apps/made-up", ownerCookie);
  page = await r.text();
  ok("a made-up app is not found", r.status === 404 || page.includes("NEXT_HTTP_ERROR_FALLBACK;404"), `${r.status}`);
  r = await get("/apps/drivsync");
  ok("tickets need a session", r.status === 307 && !(await r.text()).includes("Backup stuck"));

  const driveChange = { uid: "riderA", reference: "DS-AAAA22", status: "in_progress", note: " Looking into it " };
  const tripChange = { uid: "riderA", reference: "TS-CCCC44", status: "fixed", note: "hacked" };
  r = await post("/api/apps/drivsync/tickets", driveChange);
  ok("changing a ticket needs a session", r.status === 401);
  r = await post("/api/apps/drivsync/tickets", driveChange, { cookie: mayaCookie, origin: "https://evil.example" });
  ok("changing a ticket from another site refused", r.status === 403);
  r = await post("/api/apps/tripsync/tickets", tripChange, { cookie: mayaCookie });
  ok("a maintainer can't change another app's ticket", r.status === 404, `${r.status}`);
  r = await post("/api/apps/drivsync/tickets", tripChange, { cookie: mayaCookie });
  ok("nor slip it in through their own app", r.status === 422, `${r.status}`);
  r = await post("/api/apps/made-up/tickets", driveChange, { cookie: ownerCookie });
  ok("a made-up app can't be changed", r.status === 404);
  r = await post("/api/apps/instagro/tickets", { ...tripChange, reference: "IG-CCCC44" }, { cookie: ownerCookie });
  ok("an unconnected app can't be changed", r.status === 404);
  const tripDoc = (await trip.doc("accounts/riderA/support/TS-CCCC44").get()).data();
  ok("the other app's ticket is untouched", tripDoc.status === "open" && !tripDoc.teamNote);
  r = await post("/api/apps/drivsync/tickets", { ...driveChange, uid: "../x" }, { cookie: mayaCookie });
  ok("a bad user id refused", r.status === 422);
  r = await post("/api/apps/drivsync/tickets", { ...driveChange, reference: "DS-ZZZZZZ" }, { cookie: mayaCookie });
  ok("a ticket that doesn't exist isn't created", r.status === 404 && !(await driv.doc("accounts/riderA/support/DS-ZZZZZZ").get()).exists);

  r = await post("/api/apps/drivsync/tickets", driveChange, { cookie: mayaCookie });
  ok("a maintainer changes their app's ticket", r.status === 200, `${r.status}`);
  const saved = (await driv.doc("accounts/riderA/support/DS-AAAA22").get()).data();
  ok("stored the way the app reads it", saved.status === "in_progress" && saved.teamNote === "Looking into it" && saved.updatedAt);
  page = await plain("/activity", ownerCookie);
  ok("the change is logged under its person and app", page.includes("Maya: Ticket updated") && page.includes("DS-AAAA22: Pending → In progress, note changed"));
  ok("the log doesn't hold the note itself", !page.includes("Looking into it"));
  page = await plain("/activity", taraCookie);
  ok("another app's maintainer doesn't see that change", !page.includes("DS-AAAA22"));
  page = await plain("/activity", mayaCookie);
  ok("the maintainer sees it", page.includes("DS-AAAA22"));
  r = await post("/api/apps/drivsync/tickets", { ...driveChange, status: "fixed", note: "" }, { cookie: ownerCookie });
  ok("main account changes any app's ticket", r.status === 200);
  const cleared = (await driv.doc("accounts/riderA/support/DS-AAAA22").get()).data();
  ok("an empty note removes it", cleared.status === "fixed" && !("teamNote" in cleared));
  ok("no Desk data in the app's database", !(await driv.listCollections()).some((c) => ["staff", "sessions", "activity", "sign_in_limits"].includes(c.id)));

  // Separate lockouts
  const L = people.Locky;
  for (let i = 0; i < 5; i++) await post("/api/login", { email: L.email, password: PW, code: "000000" });
  r = await signIn(L);
  ok("after 5 wrong tries the right details are refused too", r.status === 401);
  const lockedText = await r.text();
  ok("a lock looks like any wrong try", lockedText === wrongPassword.text);
  const lockedDoc = (await db.collection("staff").doc(L.id).get()).data();
  ok("that person is locked", lockedDoc.lockedUntil > Date.now() && lockedDoc.fails === 5);
  await post("/api/login", { email: L.email, password: PW, code: "000000" });
  ok("tries during a lock don't extend it", (await db.collection("staff").doc(L.id).get()).data().fails === 5);
  r = await signIn(people.Recov);
  ok("one person's lock doesn't block anyone else", r.status === 200);
  await post("/api/logout", {}, { cookie: cookieOf(r) });
  await db.collection("staff").doc(L.id).update({ lockedUntil: Date.now() - 1000 });
  r = await signIn(L);
  ok("the right details work once the lock ends", r.status === 200);

  // Recovery codes
  const R = people.Recov;
  await db.collection("staff").doc(R.id).update({ lastTotpStep: 0 });
  r = await signIn(R, R.recovery[0].toLowerCase());
  ok("a recovery code signs in, in any case", r.status === 200, `${r.status}`);
  r = await signIn(R, R.recovery[0]);
  ok("a recovery code works only once", r.status === 401);
  r = await post("/api/login", { email: T.email, password: PW, code: R.recovery[1] });
  ok("someone else's recovery code doesn't work", r.status === 401);
  await db.collection("staff").doc(T.id).update({ fails: 0 });

  // Sessions ending
  r = await signIn(A, A.code(1));
  ok("signing in on a second browser works", r.status === 200, `${r.status}`);
  const mayaSecond = cookieOf(r);
  ok("both browsers stay signed in", (await get("/home", mayaCookie)).status === 200 && (await get("/home", mayaSecond)).status === 200);
  r = await post("/api/logout", {}, { cookie: mayaSecond, origin: "https://evil.example" });
  ok("sign-out from another site refused", r.status === 403);
  r = await post("/api/logout", {}, { cookie: mayaSecond });
  ok("signing out works", r.status === 200 && (await get("/home", mayaSecond)).status === 307);
  ok("the other browser stays signed in", (await get("/home", mayaCookie)).status === 200);

  const idleSnap = await db.collection("sessions").where("staffId", "==", T.id).get();
  await idleSnap.docs[0].ref.update({ lastSeenAt: Date.now() - 31 * 60000 });
  ok("an idle session ends", (await get("/home", taraCookie)).status === 307);
  ok("its record is removed", (await idleSnap.docs[0].ref.get()).exists === false);

  r = await signIn(A, A.code(1));
  ok("re-using a step already used is refused", r.status === 401);
  await db.collection("staff").doc(A.id).update({ lastTotpStep: 0, fails: 0 });
  r = await signIn(A, A.code(1));
  const mayaThird = cookieOf(r);
  r = await post("/api/logout", { everywhere: true }, { cookie: mayaThird });
  ok("sign out everywhere ends every browser", r.status === 200 && (await get("/home", mayaCookie)).status === 307 && (await get("/home", mayaThird)).status === 307);
  ok("and nobody else's", (await get("/home", ownerCookie)).status === 200);
  page = (await (await get("/activity", ownerCookie)).text()).replace(/<!-- -->/g, "");
  ok("it's in the log", page.includes("Maya: Signed out everywhere"));

  await db.collection("staff").doc(B.id).update({ lastTotpStep: 0 });
  await db.collection("staff").doc(L.id).update({ active: false });
  const lockySession = await db.collection("sessions").where("staffId", "==", L.id).get();
  ok("(a session to test with)", lockySession.size === 1);

  // Turning someone off takes effect at once
  await db.collection("staff").doc(R.id).update({ lastTotpStep: 0, active: true });
  r = await signIn(R, R.code(1));
  const recovCookie = cookieOf(r);
  ok("signed in before being turned off", (await get("/home", recovCookie)).status === 200);
  await db.collection("staff").doc(R.id).update({ active: false });
  ok("turned off: out on the next click", (await get("/home", recovCookie)).status === 307);

  // Limit per address
  const ip = "198.51.100.7";
  const statuses = [];
  for (let i = 0; i < 22; i++) statuses.push((await post("/api/login", { email: "nobody@example.test", password: "x", code: "000000" }, { ip })).status);
  ok("one address runs out of tries", statuses[19] === 401 && statuses[20] === 429 && statuses[21] === 429, statuses.join());
  r = await post("/api/login", { email: "nobody@example.test", password: "x", code: "000000" }, { ip: "198.51.100.8" });
  ok("other addresses carry on", r.status === 401);
  const limits = await db.collection("sign_in_limits").get();
  ok("addresses are stored only as hashes", !limits.docs.some((d) => d.id.includes("198.51") || JSON.stringify(d.data()).includes("198.51")));
} catch (e) {
  fail++;
  console.log("FAIL  crashed:", e);
} finally {
  stop();
}

console.log(`\n${pass} passed, ${fail} failed`);
setTimeout(() => process.exit(fail ? 1 : 0), 500);
