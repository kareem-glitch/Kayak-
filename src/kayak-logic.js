// Core scoring logic for the Wexford kayak clock.
//
// All times are handled as "Dublin wall-clock" values: the Open-Meteo APIs are
// asked for timezone=Europe/Dublin and return naive ISO strings, which we parse
// as if they were UTC. That keeps every comparison timezone-free and gives the
// same result in Node and in any viewer's browser. Use the fmt* helpers to
// display these values — never local Date getters.

export const SPOT = {
  name: "Wexford Harbour",
  // Wexford town quayfront; the marine grid point snaps a little offshore,
  // which is what we want for tide phase anyway.
  lat: 52.336,
  lon: -6.457,
};

export const DEFAULT_RULES = {
  maxWindKn: 10, // hard ceiling on mean wind — at or above this, no paddle
  calmWindKn: 6, // at or below this the slot reads "great"
  gustCeilingKn: 16, // gusts at/above this demote the slot one step
  tideWindowHrs: 1.0, // paddle within ±1h of high water (low water as fallback)
  dayStartHour: 8, // earliest launch 08:00
  dayEndHour: 19, // off the water by 19:00
};

export const API = {
  weather: (lat, lon, days = 7) =>
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation_probability` +
    `&wind_speed_unit=kn&timezone=Europe%2FDublin&forecast_days=${days}`,
  marine: (lat, lon, days = 7) =>
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
    `&hourly=sea_level_height_msl&timezone=Europe%2FDublin&forecast_days=${days}`,
};

// "2026-07-20T14:00" -> ms, treating the naive Dublin timestamp as UTC.
export const parseNaive = (iso) => Date.parse(iso + (iso.length === 16 ? ":00Z" : "Z"));

const HOUR = 3_600_000;

export const hourOf = (t) => new Date(t).getUTCHours();
export const fmtTime = (t) => new Date(t).toISOString().slice(11, 16);
export const fmtDay = (t) => {
  const d = new Date(t);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
};

// Find high/low water from the hourly sea-level series. Each local extremum is
// refined with a quadratic fit through its neighbours, so timings are good to a
// few minutes despite the hourly sampling.
export function findTideEvents(times, heights) {
  const events = [];
  for (let i = 1; i < heights.length - 1; i++) {
    const [a, b, c] = [heights[i - 1], heights[i], heights[i + 1]];
    const isHigh = b >= a && b > c;
    const isLow = b <= a && b < c;
    if (!isHigh && !isLow) continue;
    const denom = a - 2 * b + c;
    const offset = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
    const t = parseNaive(times[i]) + offset * HOUR;
    const height = b - 0.25 * (a - c) * offset;
    events.push({ type: isHigh ? "high" : "low", time: t, height });
  }
  return events;
}

function nearestEvent(events, type, t) {
  let best = null;
  for (const e of events) {
    if (e.type !== type) continue;
    if (!best || Math.abs(e.time - t) < Math.abs(best.time - t)) best = e;
  }
  return best;
}

// Score one hour-long slot starting at `t`. The tide condition is evaluated at
// the slot midpoint, so a "good" slot keeps the whole hour inside ±1.5h of the
// tide turn — comfortably the ±1h paddle the rules ask for.
export function scoreSlot({ t, windKn, gustKn, tides, rules = DEFAULT_RULES }) {
  const h = hourOf(t);
  if (h < rules.dayStartHour || h >= rules.dayEndHour) {
    return { verdict: "off", reasons: ["outside daylight window"] };
  }

  const reasons = [];
  if (windKn >= rules.maxWindKn) {
    return { verdict: "no", reasons: [`wind ${windKn.toFixed(0)}kn`] };
  }

  const mid = t + HOUR / 2;
  const hw = nearestEvent(tides, "high", mid);
  const lw = nearestEvent(tides, "low", mid);
  const dtHigh = hw ? Math.abs(hw.time - mid) / HOUR : Infinity;
  const dtLow = lw ? Math.abs(lw.time - mid) / HOUR : Infinity;

  let verdict;
  let tide = null;
  if (dtHigh <= rules.tideWindowHrs) {
    verdict = windKn <= rules.calmWindKn ? "great" : "good";
    tide = hw;
  } else if (dtLow <= rules.tideWindowHrs) {
    verdict = "ok";
    tide = lw;
    reasons.push(`low water ${fmtTime(lw.time)}`);
  } else {
    return { verdict: "no", reasons: ["between tides"] };
  }

  if (gustKn >= rules.gustCeilingKn) {
    const demote = { great: "good", good: "ok", ok: "no" };
    verdict = demote[verdict];
    reasons.push(`gusts ${gustKn.toFixed(0)}kn`);
  }
  return { verdict, tide, reasons };
}

// Combine the two API payloads into scored hourly slots.
export function buildForecast(weather, marine, rules = DEFAULT_RULES) {
  const tides = findTideEvents(
    marine.hourly.time,
    marine.hourly.sea_level_height_msl
  );
  const w = weather.hourly;
  const slots = w.time.map((iso, i) => {
    const t = parseNaive(iso);
    const windKn = w.wind_speed_10m[i];
    const gustKn = w.wind_gusts_10m[i];
    const scored = scoreSlot({ t, windKn, gustKn, tides, rules });
    return {
      t,
      iso,
      windKn,
      gustKn,
      windDir: w.wind_direction_10m[i],
      rainPct: w.precipitation_probability ? w.precipitation_probability[i] : null,
      ...scored,
    };
  });
  return { slots, tides };
}

const PADDLEABLE = new Set(["great", "good", "ok"]);

// Merge consecutive paddleable slots into windows, e.g. "Tue 13:00–16:00".
export function paddleWindows(slots) {
  const windows = [];
  let cur = null;
  for (const s of slots) {
    if (PADDLEABLE.has(s.verdict)) {
      if (!cur) cur = { start: s.t, end: s.t + HOUR, slots: [s] };
      else {
        cur.end = s.t + HOUR;
        cur.slots.push(s);
      }
    } else if (cur) {
      windows.push(finishWindow(cur));
      cur = null;
    }
  }
  if (cur) windows.push(finishWindow(cur));
  return windows;
}

const RANK = { great: 3, good: 2, ok: 1 };

function finishWindow(w) {
  const best = w.slots.reduce((a, b) => (RANK[b.verdict] > RANK[a.verdict] ? b : a));
  const minWind = Math.min(...w.slots.map((s) => s.windKn));
  return { ...w, verdict: best.verdict, tide: best.tide, minWind };
}
