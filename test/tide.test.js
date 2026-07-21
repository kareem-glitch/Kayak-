import test from "node:test";
import assert from "node:assert/strict";
import { tideEvents, tideHeight } from "../src/wexford-tide.js";

const naive = (iso) => Date.parse(iso + "Z");

// Official Wexford Harbour predictions (tidetime.org, station 3413).
// The model is fitted to these, so it should reproduce them closely; the
// 2026-07-20 entries are OUT of the fit window (independent check).
const OFFICIAL = [
  ["2026-07-20T11:43", "high"], // from Tides Near Me screenshot, not in fit set
  ["2026-07-21T12:34", "high"],
  ["2026-07-21T06:11", "low"],
  ["2026-07-22T13:25", "high"],
  ["2026-07-23T14:21", "high"],
  ["2026-07-24T15:25", "high"],
  ["2026-07-27T18:31", "high"],
];

test("harmonic model matches official Wexford tide times within 20 min", () => {
  const events = tideEvents(naive("2026-07-19T00:00"), naive("2026-07-28T00:00"));
  let worst = 0;
  for (const [iso, type] of OFFICIAL) {
    const want = naive(iso);
    let best = null;
    for (const e of events) {
      if (e.type !== type) continue;
      if (!best || Math.abs(e.time - want) < Math.abs(best.time - want)) best = e;
    }
    const errMin = Math.abs(best.time - want) / 60000;
    worst = Math.max(worst, errMin);
    assert.ok(errMin < 20, `${iso} off by ${errMin.toFixed(0)} min`);
  }
  assert.ok(worst < 20);
});

test("tide oscillates in a sane range above chart datum", () => {
  const events = tideEvents(naive("2026-07-21T00:00"), naive("2026-07-24T00:00"));
  const highs = events.filter((e) => e.type === "high");
  const lows = events.filter((e) => e.type === "low");
  assert.ok(highs.length >= 4 && lows.length >= 4);
  for (const h of highs) assert.ok(h.height > 1.4 && h.height < 2.4);
  for (const l of lows) assert.ok(l.height > 0.5 && l.height < 1.3);
});

test("tideHeight is continuous and finite", () => {
  const t = naive("2026-07-22T09:30");
  assert.ok(Number.isFinite(tideHeight(t)));
  assert.ok(Math.abs(tideHeight(t) - tideHeight(t + 60000)) < 0.1);
});
