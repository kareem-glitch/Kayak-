import test from "node:test";
import assert from "node:assert/strict";
import {
  findTideEvents,
  scoreSlot,
  paddleWindows,
  buildForecast,
  parseNaive,
} from "../src/kayak-logic.js";

// Synthetic semidiurnal tide: high water at 04:00 and 16:24, sampled hourly.
function syntheticTide(hours = 48) {
  const times = [];
  const heights = [];
  for (let h = 0; h < hours; h++) {
    const d = new Date(Date.UTC(2026, 6, 20, h));
    times.push(d.toISOString().slice(0, 16));
    heights.push(1.8 * Math.cos((2 * Math.PI * (h - 4)) / 12.4));
  }
  return { times, heights };
}

test("findTideEvents locates highs and lows with sub-hour precision", () => {
  const { times, heights } = syntheticTide();
  const events = findTideEvents(times, heights);
  const highs = events.filter((e) => e.type === "high");
  const lows = events.filter((e) => e.type === "low");
  assert.ok(highs.length >= 3 && lows.length >= 3);
  const firstHigh = highs[0];
  const expected = parseNaive("2026-07-20T04:00");
  assert.ok(Math.abs(firstHigh.time - expected) < 15 * 60 * 1000);
  assert.ok(firstHigh.height > 1.7);
});

const HW = parseNaive("2026-07-20T14:00");
const LW = parseNaive("2026-07-20T08:00");
const tides = [
  { type: "low", time: LW, height: -1.8 },
  { type: "high", time: HW, height: 1.8 },
];
const slot = (iso, windKn, gustKn = windKn + 3) =>
  scoreSlot({ t: parseNaive(iso), windKn, gustKn, tides });

test("calm hour beside high water is great", () => {
  assert.equal(slot("2026-07-20T13:00", 5).verdict, "great");
});

test("moderate wind beside high water is good", () => {
  assert.equal(slot("2026-07-20T14:00", 8).verdict, "good");
});

test("wind at the 10kn ceiling kills the slot", () => {
  assert.equal(slot("2026-07-20T14:00", 10).verdict, "no");
});

test("low water hour is ok, not good", () => {
  assert.equal(slot("2026-07-20T08:00", 5).verdict, "ok");
});

test("mid-tide hour is a no even in calm", () => {
  assert.equal(slot("2026-07-20T11:00", 3).verdict, "no");
});

test("outside 8am-7pm is off", () => {
  assert.equal(slot("2026-07-20T06:00", 3).verdict, "off");
  assert.equal(slot("2026-07-20T19:00", 3).verdict, "off");
});

test("heavy gusts demote a slot", () => {
  assert.equal(slot("2026-07-20T13:00", 5, 20).verdict, "good");
});

test("paddleWindows merges consecutive slots", () => {
  const mk = (iso, verdict) => ({
    t: parseNaive(iso),
    verdict,
    windKn: 5,
    tide: tides[1],
  });
  const windows = paddleWindows([
    mk("2026-07-20T13:00", "good"),
    mk("2026-07-20T14:00", "great"),
    mk("2026-07-20T15:00", "no"),
    mk("2026-07-20T17:00", "ok"),
  ]);
  assert.equal(windows.length, 2);
  assert.equal(windows[0].verdict, "great");
  assert.equal(windows[0].end - windows[0].start, 2 * 3600 * 1000);
});

test("buildForecast scores wind against the harmonic tide", () => {
  // A calm day (5kn) on 2026-07-21; official Wexford HW is 12:34.
  const times = [];
  for (let h = 0; h < 24; h++) {
    times.push(`2026-07-21T${String(h).padStart(2, "0")}:00`);
  }
  const weather = {
    hourly: {
      time: times,
      wind_speed_10m: times.map(() => 5),
      wind_gusts_10m: times.map(() => 8),
      wind_direction_10m: times.map(() => 180),
      precipitation_probability: times.map(() => 10),
      temperature_2m: times.map(() => 17),
    },
  };
  const { slots, tides } = buildForecast(weather);
  assert.equal(slots.length, 24);
  assert.ok(tides.some((e) => e.type === "high"));
  // The 12:00 slot (midpoint 12:30) is within ±1h of HW 12:34 → great in 5kn.
  const noon = slots.find((s) => s.iso.endsWith("12:00"));
  assert.equal(noon.verdict, "great");
  // Mid-tide morning slot is a no-go even though it's calm.
  const nine = slots.find((s) => s.iso.endsWith("09:00"));
  assert.equal(nine.verdict, "no");
});
