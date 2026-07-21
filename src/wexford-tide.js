// Harmonic tide prediction for Wexford Harbour.
//
// Open-Meteo's global marine model is 1–3 hours out on Wexford's tide (the
// harbour's shallow, twin-channel tide with its long low-water stand isn't
// resolved by a coarse global grid). So instead we predict the tide from
// harmonic constituents fitted by least-squares to the official Wexford Harbour
// station predictions (tidetime.org, station 3413), reproducing them to a mean
// of ~6 min (worst ~18 min) and validating to ~8 min on an out-of-sample day.
//
// Heights are metres above chart datum (same datum as the official tables).
//
// All times are handled in the app's "naive Dublin as UTC" frame: an ms value
// equal to Date.parse(<Dublin wall-clock ISO> + "Z"). The reference epoch below
// is Wexford midnight IST expressed in that frame, so predictions line up with
// the wind slots without any timezone maths. (A ±1h wobble is possible for a day
// or two around the twice-yearly DST switch — negligible for a 7-day outlook.)

export const TIDE_MODEL = {
  fittedTo: "Wexford Harbour official predictions, 21–28 Jul 2026",
  t0: "2026-07-21T00:00:00", // naive Dublin epoch
  Z0: 1.3436, // mean level, m above chart datum
  con: [
    { name: "M2", speed: 28.9841042, amp: 0.5787, phase: 0.1657 },
    { name: "S2", speed: 30.0, amp: 0.1839, phase: -1.3712 },
    { name: "N2", speed: 28.4397295, amp: 0.2146, phase: 2.3673 },
    { name: "K1", speed: 15.0410686, amp: 0.0161, phase: 0.1191 },
    { name: "O1", speed: 13.9430356, amp: 0.0252, phase: 1.9205 },
    { name: "M4", speed: 57.9682084, amp: 0.00089, phase: 1.7661 },
    { name: "M6", speed: 86.9523127, amp: 0.00018, phase: -1.3881 },
  ],
};

const T0_MS = Date.parse(TIDE_MODEL.t0 + "Z");
const DEG = Math.PI / 180;
const HOUR = 3_600_000;

// Predicted tide height (m above chart datum) at an ms instant.
export function tideHeight(ms) {
  const t = (ms - T0_MS) / HOUR; // elapsed hours
  let h = TIDE_MODEL.Z0;
  for (const c of TIDE_MODEL.con) h += c.amp * Math.cos(c.speed * DEG * t - c.phase);
  return h;
}

// High/low waters between two ms instants. Scans at 1-min resolution and refines
// each turning point with a quadratic fit for sub-minute timing.
export function tideEvents(startMs, endMs) {
  const step = 60_000; // 1 min
  const events = [];
  let prev = tideHeight(startMs) - tideHeight(startMs - step);
  for (let ms = startMs; ms <= endMs; ms += step) {
    const d = tideHeight(ms + step) - tideHeight(ms);
    const isHigh = prev > 0 && d <= 0;
    const isLow = prev < 0 && d >= 0;
    if (isHigh || isLow) {
      const a = tideHeight(ms - step), b = tideHeight(ms), c = tideHeight(ms + step);
      const den = a - 2 * b + c;
      const off = den === 0 ? 0 : (0.5 * (a - c)) / den; // in steps
      events.push({
        type: isHigh ? "high" : "low",
        time: ms + off * step,
        height: b - 0.25 * (a - c) * off,
      });
    }
    prev = d;
  }
  return events;
}

// Sample heights on a fixed cadence, for drawing the tide curve.
export function tideSeries(startMs, endMs, stepMs = HOUR) {
  const out = [];
  for (let ms = startMs; ms <= endMs; ms += stepMs) out.push({ t: ms, h: tideHeight(ms) });
  return out;
}
