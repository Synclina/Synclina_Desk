import assert from "node:assert/strict";
import { test } from "node:test";
import { keyFitsProject, personState, readApps, readInvite, readStatus, readTicketChange, replyLink, textOrNull, ticketOwner, validId } from "../src/lib/rules.ts";

const DRIVSYNC = ["DS", "FS"];
const good = { uid: "abc123", reference: "DS-ABC234", status: "fixed", note: " Done " };

test("a good ticket change is read, with its note trimmed", () => {
  assert.deepEqual(readTicketChange(good, DRIVSYNC), { uid: "abc123", reference: "DS-ABC234", status: "fixed", note: "Done" });
  assert.equal(readTicketChange({ ...good, reference: "FS-ABC234" }, DRIVSYNC)?.reference, "FS-ABC234");
});

test("bad ticket changes are refused", () => {
  for (const bad of [
    null,
    "x",
    { ...good, uid: "../deletions/x" },
    { ...good, uid: "" },
    { ...good, reference: "DS-abc" },
    { ...good, reference: "../../x" },
    { ...good, status: "pending" },
    { ...good, status: undefined },
    { ...good, note: 5 },
    { ...good, note: "x".repeat(1001) },
  ]) {
    assert.equal(readTicketChange(bad, DRIVSYNC), null);
  }
});

test("a reference must belong to the app it's changed under", () => {
  assert.equal(readTicketChange({ ...good, reference: "TS-ABC234" }, DRIVSYNC), null);
  assert.equal(readTicketChange(good, ["TS"]), null);
  assert.equal(readTicketChange({ ...good, reference: "TS-ABC234" }, ["TS"])?.reference, "TS-ABC234");
});

test("statuses are read the way the app reads them", () => {
  assert.equal(readStatus("in progress"), "in_progress");
  assert.equal(readStatus("Fixed"), "fixed");
  assert.equal(readStatus("whatever"), "open");
  assert.equal(readStatus(undefined), "open");
});

test("a key is refused unless it's for the app's own project", () => {
  assert.equal(keyFitsProject("drivsync-2034b", "drivsync-2034b"), true);
  assert.equal(keyFitsProject("other-project", "drivsync-2034b"), false);
  assert.equal(keyFitsProject(undefined, "drivsync-2034b"), false);
  // An app that hasn't been told its project can't be connected by accident.
  assert.equal(keyFitsProject("anything", undefined), false);
});

test("a ticket belongs to someone only at the exact path", () => {
  assert.equal(ticketOwner("accounts/abc/support/DS-AAAA22"), "abc");
  for (const bad of [
    "accounts/me/vehicles/v/accounts/victim/support/DS-AAAA22",
    "other/thing/support/DS-AAAA22",
    "accounts/abc/notes/DS-AAAA22",
    "accounts/abc/support",
  ]) {
    assert.equal(ticketOwner(bad), null);
  }
});

test("stored fields that aren't text are ignored", () => {
  assert.equal(textOrNull("hello"), "hello");
  for (const bad of [5, {}, [], null, undefined, true]) assert.equal(textOrNull(bad), null);
});

test("a reply link only uses a plain address, and encodes the subject", () => {
  assert.equal(replyLink("a@example.com", "Hi & bye"), "mailto:a@example.com?subject=Hi%20%26%20bye");
  for (const bad of [null, "", "a@example.com?bcc=x@evil.test", "a@example.com&cc=x", "a%40b@example.com", "a,b@example.com", "not-an-email"]) {
    assert.equal(replyLink(bad, "Hi"), null);
  }
});

const APPS = ["drivsync", "tripsync", "instagro"];
const invite = { email: " New.Person@Example.com ", name: " New Person ", apps: ["tripsync"] };

test("a good invite is read and tidied", () => {
  assert.deepEqual(readInvite(invite, APPS), { email: "new.person@example.com", name: "New Person", apps: ["tripsync"] });
});

test("an invite has no way to ask for more than a maintainer", () => {
  assert.equal("role" in readInvite({ ...invite, role: "owner" }, APPS), false);
});

test("bad invites are refused", () => {
  for (const bad of [
    null,
    "x",
    { ...invite, email: "nope" },
    { ...invite, email: "a@b.com?bcc=x@evil.test" },
    { ...invite, email: "a@b.com,c@d.com" },
    { ...invite, email: 5 },
    { ...invite, name: "" },
    { ...invite, name: "   " },
    { ...invite, name: "x".repeat(61) },
    { ...invite, name: "two\nlines" },
    { ...invite, apps: [] },
    { ...invite, apps: ["made-up"] },
    { ...invite, apps: "drivsync" },
  ]) {
    assert.equal(readInvite(bad, APPS), null);
  }
});

test("apps are read in a steady order, each once, known ones only", () => {
  assert.deepEqual(readApps(["instagro", "drivsync", "drivsync"], APPS), ["drivsync", "instagro"]);
  assert.deepEqual(readApps([], APPS), []);
  for (const bad of [null, "drivsync", ["drivsync", "x"], [5], [{}]]) assert.equal(readApps(bad, APPS), null);
});

test("a person's state comes from their record", () => {
  const now = 1000;
  assert.equal(personState({ role: "owner", active: true }, now), "main");
  assert.equal(personState({ role: "owner", active: false }, now), "main");
  assert.equal(personState({ role: "maintainer", active: true }, now), "active");
  assert.equal(personState({ role: "maintainer", active: false, setupExpiresAt: 2000 }, now), "waiting");
  assert.equal(personState({ role: "maintainer", active: false, setupExpiresAt: 500 }, now), "expired");
  assert.equal(personState({ role: "maintainer", active: false }, now), "expired");
  assert.equal(personState({ role: "maintainer", active: false, removedAt: 5, setupExpiresAt: 2000 }, now), "removed");
});

test("ids and tokens can't be paths", () => {
  assert.equal(validId("A".repeat(43)), true);
  assert.equal(validId("a_b-".repeat(10) + "abc"), true);
  for (const bad of [null, 5, "", "A".repeat(42), "A".repeat(44), "../".repeat(14) + "a", "A/".repeat(21) + "A"]) assert.equal(validId(bad), false);
});
