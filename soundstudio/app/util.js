// Small shared helpers.
export const $ = s => document.querySelector(s);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Wall-clock milliseconds with sub-millisecond precision; the shared clock that
// devices in a room synchronise against.
export const clk = () => performance.timeOrigin + performance.now();
