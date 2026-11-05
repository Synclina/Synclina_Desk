import assert from "node:assert/strict";
import { test } from "node:test";
import { keyFitsProject, readStatus, readTicketChange } from "../src/lib/rules.ts";

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
