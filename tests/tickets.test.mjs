import assert from "node:assert/strict";
import { test } from "node:test";
import { keyFitsProject, readStatus, readTicketChange, replyLink, textOrNull, ticketOwner } from "../src/lib/rules.ts";

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
