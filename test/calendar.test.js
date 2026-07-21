import test from "node:test";
import assert from "node:assert/strict";
import { windowsToEvents, reconcile, SYNC_TAG } from "../src/calendar-sync.js";
import { parseNaive } from "../src/kayak-logic.js";

const HW = { type: "high", time: parseNaive("2026-07-20T10:00"), height: 1.8 };
const mk = (iso, verdict, windKn = 5) => ({
  t: parseNaive(iso),
  verdict,
  windKn,
  tide: HW,
});

test("only great/good windows become calendar events", () => {
  const slots = [
    mk("2026-07-20T09:00", "great"),
    mk("2026-07-20T10:00", "great"),
    mk("2026-07-20T11:00", "no"),
    mk("2026-07-20T15:00", "ok"), // low-water fallback — excluded
  ];
  const events = windowsToEvents(slots);
  assert.equal(events.length, 1);
  assert.match(events[0].summary, /Great/);
  // Event starts 15 min before the 09:00 on-water window for prep.
  assert.equal(events[0].startTime, "2026-07-20T08:45");
  assert.equal(events[0].endTime, "2026-07-20T11:00");
  assert.match(events[0].description, /on-water window is 09:00–11:00/);
  assert.equal(events[0].availability, "AVAILABILITY_FREE");
  assert.equal(events[0].timeZone, "Europe/Dublin");
  assert.match(events[0].description, new RegExp(SYNC_TAG));
});

test("reconcile leaves unchanged windows alone and clears stale ones", () => {
  const slots = [mk("2026-07-20T09:00", "great"), mk("2026-07-20T10:00", "great")];
  const desired = windowsToEvents(slots);

  // One already on the calendar matching, one stale tagged event to remove.
  const existing = [
    {
      id: "keep1",
      summary: desired[0].summary,
      start: desired[0].startTime,
      description: `x [${SYNC_TAG}]`,
    },
    {
      id: "stale1",
      summary: "🛶 Kayak — Wexford (Great)",
      start: "2026-07-19T09:00",
      description: `old [${SYNC_TAG}]`,
    },
  ];
  const { toCreate, toDelete } = reconcile(desired, existing);
  assert.equal(toCreate.length, 0, "matching window is not recreated");
  assert.equal(toDelete.length, 1);
  assert.equal(toDelete[0].id, "stale1");
});

test("reconcile never deletes untagged (user's own) events", () => {
  const desired = [];
  const existing = [
    { id: "mine", summary: "🛶 Kayak — Wexford (Great)", start: "2026-07-19T09:00", description: "" },
  ];
  const { toDelete } = reconcile(desired, existing);
  assert.equal(toDelete.length, 0);
});
