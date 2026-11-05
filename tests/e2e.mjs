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

for (const c of ["staff", "sessions", "activity", "sign_in_limits", "invites"]) await db.recursiveDelete(db.collection(c));
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
await driv.doc("accounts/riderA/cars/c1/accounts/victim/support/DS-SPOOF1").set({ subject: "SPOOFED OWNER", createdAt: at(1), status: "open" });
await driv.doc("accounts/riderA/support/DS-ODDONE").set({ subject: 5, topic: {}, message: { a: 1 }, deviceInfo: 7, teamNote: [], createdAt: at(2), updatedAt: "not a date", status: 9 });
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
  ok("a ticket nested under another path isn't a ticket", !page.includes("SPOOFED OWNER") && !page.includes("DS-SPOOF1"));
  ok("a ticket with odd fields doesn't break the page", page.includes("DS-ODDONE"));
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

  // People: who may manage them
  await db.collection("staff").doc(B.id).update({ lastTotpStep: 0, fails: 0 });
  r = await signIn(B, B.code(1));
  const boss = cookieOf(r);
  await db.collection("staff").doc(T.id).update({ lastTotpStep: 0, fails: 0 });
  r = await signIn(T, T.code(1));
  const tara2 = cookieOf(r);
  const newbie = { email: "New.Person@Example.test", name: "Nia New", apps: ["tripsync"] };
  const nid = staffIdForEmail("new.person@example.test");
  r = await get("/people");
  ok("people page sends strangers to sign-in", r.status === 307);
  r = await get("/people", tara2);
  page = await r.text();
  ok("a maintainer can't open the people page", (r.status === 404 || page.includes("NEXT_HTTP_ERROR_FALLBACK;404")) && !page.includes(B.email), `${r.status}`);
  page = await plain("/home", tara2);
  ok("a maintainer has no People link", !page.includes('href="/people"'));
  r = await post("/api/people", newbie);
  ok("inviting needs a session", r.status === 401);
  r = await post("/api/people", newbie, { cookie: tara2 });
  ok("a maintainer can't invite", r.status === 404 && !(await db.collection("staff").doc(nid).get()).exists);
  r = await post("/api/people", newbie, { cookie: boss, origin: "https://evil.example" });
  ok("inviting from another site refused", r.status === 403);
  for (const [why, action] of [["reset", { action: "reset" }], ["remove", { action: "remove" }], ["change access of", { action: "apps", apps: ["drivsync", "tripsync"] }]]) {
    r = await post(`/api/people/${T.id}`, action, { cookie: tara2 });
    ok(`a maintainer can't ${why} anyone, even themselves`, r.status === 404);
  }
  ok("their record is unchanged", (await db.collection("staff").doc(T.id).get()).data().apps.join() === "tripsync");

  // The main account can't be touched from here
  for (const action of [{ action: "reset" }, { action: "remove" }, { action: "apps", apps: [] }]) {
    r = await post(`/api/people/${B.id}`, action, { cookie: boss });
    ok(`the main account can't be changed: ${action.action}`, r.status === 404);
  }
  const bossDoc = (await db.collection("staff").doc(B.id).get()).data();
  ok("the main account is unchanged", bossDoc.active === true && bossDoc.role === "owner" && !!bossDoc.passwordHash);
  r = await post("/api/people", { ...newbie, email: B.email }, { cookie: boss });
  ok("inviting the main account's email is refused", r.status === 409);
  r = await post("/api/people", { ...newbie, email: T.email }, { cookie: boss });
  ok("inviting someone who already has an account is refused", r.status === 409);
  ok("and doesn't change them", !!(await db.collection("staff").doc(T.id).get()).data().passwordHash);
  r = await post("/api/people", { ...newbie, role: "owner", apps: ["made-up"] }, { cookie: boss });
  ok("an invite for a made-up app is refused", r.status === 422);
  r = await post("/api/people/..%2F..%2Fx", { action: "remove" }, { cookie: boss });
  ok("a made-up person id is refused", r.status === 404);
  r = await post(`/api/people/${"A".repeat(43)}`, { action: "remove" }, { cookie: boss });
  ok("a person who doesn't exist isn't created", r.status === 404 && !(await db.collection("staff").doc("A".repeat(43)).get()).exists);

  // An invite
  r = await post("/api/people", { ...newbie, role: "owner" }, { cookie: boss });
  let made = await r.json();
  ok("the main account invites someone", r.status === 200 && made.link?.startsWith(`${O}/join#`), JSON.stringify(made).slice(0, 80));
  ok("no email service here, and it says so", made.emailed === false);
  const tokenOf = (link) => link.split("#")[1];
  let joinToken = tokenOf(made.link);
  let nDoc = (await db.collection("staff").doc(nid).get()).data();
  ok("an invite always makes a maintainer", nDoc.role === "maintainer" && nDoc.active === false && nDoc.apps.join() === "tripsync" && nDoc.email === "new.person@example.test");
  ok("nothing secret is stored yet", !nDoc.passwordHash && !nDoc.totpSecret);
  const stolen = await db.collection("invites").get();
  ok("only a hash of the link is stored", stolen.size === 1 && stolen.docs[0].id === sha256(joinToken) && !JSON.stringify(stolen.docs[0].data()).includes(joinToken));
  page = await plain("/people", boss);
  ok("the people page lists them, waiting", page.includes("Nia New") && page.includes("Invited") && page.includes("Main account"));
  ok("no secrets on the people page", !page.includes(joinToken) && !page.includes("passwordHash") && !page.includes("totpSecret") && !page.includes(bossDoc.passwordHash));
  r = await post("/api/login", { email: "new.person@example.test", password: PW, code: "000000" });
  ok("someone invited can't sign in yet", r.status === 401);
  r = await post("/api/people", newbie, { cookie: boss });
  ok("inviting them twice is refused", r.status === 409);

  // The join page
  r = await get("/join");
  page = await r.text();
  ok("the join page opens, and holds nothing", r.status === 200 && !page.includes("new.person"));
  ok("the join page is hidden and uncached", /noindex/.test(r.headers.get("x-robots-tag") ?? "") && /no-store/.test(r.headers.get("cache-control") ?? ""));
  const join = (body, opts) => post("/api/join", body, opts);
  r = await join({ step: "check", token: joinToken }, { origin: "https://evil.example" });
  ok("a link from another site refused", r.status === 403);
  r = await join({ step: "check", token: "A".repeat(43) });
  const madeUp = await r.text();
  ok("a made-up link is refused", r.status === 404);
  r = await join({ step: "check", token: "../staff/x" });
  ok("a link shaped like a path is refused", r.status === 404 && (await r.text()) === madeUp);
  r = await join({ step: "check", token: joinToken });
  let details = await r.json();
  ok("the right link shows who it's for", r.status === 200 && details.email === "new.person@example.test" && details.name === "Nia New");
  ok("and a code to scan", details.qr?.startsWith("data:image/svg+xml;base64,") && details.otpauth?.includes(details.secret));
  r = await join({ step: "check", token: joinToken });
  ok("opening it again shows the same key", (await r.json()).secret === details.secret);
  const stored2 = (await db.collection("invites").doc(sha256(joinToken)).get()).data();
  ok("the key waits encrypted", !JSON.stringify(stored2).includes(details.secret));
  const NEWPW = "another-test-password-e2e";
  const nowCode = (secret, d = 0) => codeForStep(secret, stepAt(Date.now()) + d);
  r = await join({ step: "finish", token: joinToken, password: "too-short", code: nowCode(details.secret) });
  ok("a short password is refused", r.status === 422);
  r = await join({ step: "finish", token: joinToken, password: "x".repeat(201), code: nowCode(details.secret) });
  ok("an oversized password is refused", r.status === 422);
  r = await join({ step: "finish", token: joinToken, password: NEWPW, code: "000000" });
  ok("a wrong code is refused, so it can't lock them out", r.status === 422 && (await db.collection("staff").doc(nid).get()).data().active === false);
  const firstCode = nowCode(details.secret);
  const finishes = await Promise.all([join({ step: "finish", token: joinToken, password: NEWPW, code: firstCode }), join({ step: "finish", token: joinToken, password: "someone-else-password", code: firstCode })]);
  const wins = finishes.filter((x) => x.status === 200);
  ok("used twice at the same moment, one wins", wins.length === 1, finishes.map((x) => x.status).join());
  const winPw = finishes[0].status === 200 ? NEWPW : "someone-else-password";
  const codes = (await wins[0].json()).recovery;
  ok("recovery codes are given once", codes?.length === 8);
  nDoc = (await db.collection("staff").doc(nid).get()).data();
  ok("the person is now active", nDoc.active === true && nDoc.role === "maintainer");
  const whole = JSON.stringify(nDoc);
  ok("no plain password, key or codes stored", !whole.includes(winPw) && !whole.includes(details.secret) && !codes.some((c) => whole.includes(c)));
  r = await join({ step: "check", token: joinToken });
  ok("a link works only once", r.status === 404 && (await r.text()) === madeUp);
  r = await join({ step: "finish", token: joinToken, password: NEWPW, code: nowCode(details.secret, 1) });
  ok("and can't finish again", r.status === 404);
  ok("no sessions from joining", (await db.collection("sessions").where("staffId", "==", nid).get()).empty);
  const nia = { email: "new.person@example.test" };
  r = await post("/api/login", { ...nia, password: winPw, code: firstCode });
  ok("the code used to join can't sign in", r.status === 401);
  await db.collection("staff").doc(nid).update({ fails: 0 });
  r = await post("/api/login", { ...nia, password: winPw, code: nowCode(details.secret, 1) });
  ok("they sign in with their new details", r.status === 200, `${r.status}`);
  const niaCookie = cookieOf(r);
  page = await plain("/apps/tripsync", niaCookie);
  ok("they see their app's tickets", page.includes("Trip secret subject"));
  page = await plain("/apps/drivsync", niaCookie);
  ok("and not another app's", !page.includes("Backup stuck on Syncing"));
  r = await post("/api/apps/drivsync/tickets", { ...driveChange, note: "hacked" }, { cookie: niaCookie });
  ok("nor can they change another app's", r.status === 404);

  // Access
  r = await post(`/api/people/${nid}`, { action: "apps", apps: ["made-up"] }, { cookie: boss });
  ok("access to a made-up app is refused", r.status === 422);
  r = await post(`/api/people/${nid}`, { action: "apps", apps: ["drivsync"] }, { cookie: boss });
  ok("the main account changes their apps", r.status === 200);
  page = await plain("/apps/drivsync", niaCookie);
  ok("the new app opens on their next click", page.includes("Backup stuck on Syncing"));
  page = await plain("/apps/tripsync", niaCookie);
  ok("the old one is gone on their next click", !page.includes("Trip secret subject"));
  r = await post("/api/apps/tripsync/tickets", tripChange, { cookie: niaCookie });
  ok("and can't be changed either", r.status === 404);

  // Reset
  r = await post(`/api/people/${nid}`, { action: "reset" }, { cookie: boss });
  made = await r.json();
  ok("the main account resets someone", r.status === 200 && made.link?.includes("/join#"));
  ok("they're out at once", (await get("/home", niaCookie)).status === 307);
  ok("their sessions are gone", (await db.collection("sessions").where("staffId", "==", nid).get()).empty);
  nDoc = (await db.collection("staff").doc(nid).get()).data();
  ok("their old details are gone, their apps stay", !nDoc.passwordHash && !nDoc.totpSecret && !nDoc.recoveryHashes && nDoc.apps.join() === "drivsync");
  r = await post("/api/login", { ...nia, password: winPw, code: nowCode(details.secret, 1) });
  ok("the old password and authenticator stop working", r.status === 401);
  r = await post("/api/login", { ...nia, password: winPw, code: codes[0] });
  ok("so do the old recovery codes", r.status === 401);
  const firstReset = tokenOf(made.link);
  r = await post(`/api/people/${nid}`, { action: "reset" }, { cookie: boss });
  made = await r.json();
  r = await join({ step: "check", token: firstReset });
  ok("a newer link ends the earlier one", r.status === 404);
  joinToken = tokenOf(made.link);
  r = await join({ step: "check", token: joinToken });
  details = await r.json();
  ok("the newer link works, with a new key", r.status === 200 && details.secret);
  await db.collection("invites").doc(sha256(joinToken)).update({ expiresAt: Date.now() - 1000 });
  r = await join({ step: "check", token: joinToken });
  ok("a link that's run out is refused", r.status === 404 && (await r.text()) === madeUp);
  r = await join({ step: "finish", token: joinToken, password: NEWPW, code: nowCode(details.secret) });
  ok("and can't be finished", r.status === 404);
  await db.collection("staff").doc(nid).update({ setupExpiresAt: Date.now() - 1000 });
  page = await plain("/people", boss);
  ok("the people page says it ran out", page.includes("Link ran out"));
  r = await post(`/api/people/${nid}`, { action: "reset" }, { cookie: boss });
  made = await r.json();
  joinToken = tokenOf(made.link);
  details = await (await join({ step: "check", token: joinToken })).json();
  r = await join({ step: "finish", token: joinToken, password: NEWPW, code: nowCode(details.secret) });
  ok("they set new details from the new link", r.status === 200);
  r = await post("/api/login", { ...nia, password: NEWPW, code: nowCode(details.secret, 1) });
  ok("and sign in with them", r.status === 200, `${r.status}`);
  const niaAgain = cookieOf(r);

  // Remove
  r = await post(`/api/people/${nid}`, { action: "remove" }, { cookie: boss });
  ok("the main account removes someone", r.status === 200);
  ok("they're out at once", (await get("/home", niaAgain)).status === 307 && (await db.collection("sessions").where("staffId", "==", nid).get()).empty);
  nDoc = (await db.collection("staff").doc(nid).get()).data();
  ok("no secrets or apps are left, and the record stays for the log", nDoc.active === false && !nDoc.passwordHash && !nDoc.totpSecret && nDoc.apps.length === 0 && nDoc.removedAt > 0 && nDoc.email === nia.email);
  r = await post("/api/login", { ...nia, password: NEWPW, code: nowCode(details.secret, 2) });
  ok("they can't sign in", r.status === 401);
  r = await post(`/api/people/${nid}`, { action: "remove" }, { cookie: boss });
  ok("removing twice finds nothing", r.status === 404);
  for (const action of [{ action: "reset" }, { action: "apps", apps: ["drivsync"] }]) {
    r = await post(`/api/people/${nid}`, action, { cookie: boss });
    ok(`someone removed can't be given back access by ${action.action}`, r.status === 404);
  }
  page = await plain("/people", boss);
  ok("the people page shows them as removed", page.includes("Removed") && page.includes("Nia New"));
  // A removed person's unfinished link dies with them
  r = await post("/api/people", { email: "second@example.test", name: "Sam", apps: ["drivsync"] }, { cookie: boss });
  made = await r.json();
  const samId = staffIdForEmail("second@example.test");
  const samToken = tokenOf(made.link);
  details = await (await join({ step: "check", token: samToken })).json();
  r = await post(`/api/people/${samId}`, { action: "remove" }, { cookie: boss });
  r = await join({ step: "finish", token: samToken, password: NEWPW, code: nowCode(details.secret) });
  ok("removing someone ends their unused link", r.status === 404 && (await db.collection("staff").doc(samId).get()).data().active === false);
  r = await post("/api/people", { ...newbie, name: "Nia Again" }, { cookie: boss });
  made = await r.json();
  ok("someone removed can be invited again, fresh", r.status === 200 && made.link);
  nDoc = (await db.collection("staff").doc(nid).get()).data();
  ok("with nothing left over", !nDoc.removedAt && nDoc.active === false && nDoc.name === "Nia Again" && nDoc.apps.join() === "tripsync");
  r = await join({ step: "check", token: tokenOf(made.link) });
  details = await r.json();
  ok("and a new key", r.status === 200 && details.email === nia.email);

  // The log
  page = await plain("/activity", boss);
  ok("people changes are in the log", ["Person invited", "Finished setting up their account", "App access changed", "Sign-in reset", "New invite link", "Person removed"].every((t) => page.includes(t)));
  ok("no links in the log", !page.includes("/join#"));
  page = await plain("/activity", tara2);
  ok("a maintainer doesn't see people changes", !page.includes("Person invited") && !page.includes("Person removed") && !page.includes("new.person@example.test"));

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
