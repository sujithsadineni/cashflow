/**
 * The demo's "today" (D257). The invented household (api/demo/seed.mjs)
 * runs Oct 2025 – Sep 2026 and was recorded as of its last day, so the
 * demo keeps that day as today: a visitor in any later month still opens
 * on September 2026 with its data, not an unrecorded empty month.
 *
 * pinClock moves `new Date()` and Date.now() to DEMO_TODAY at the current
 * time of day, still ticking. A date built from arguments is untouched.
 * Plain JS with no imports: record.mjs injects its source into the
 * recorder's browser, and api/demo/clock.mjs runs it in the recording API.
 */
export const DEMO_TODAY = '2026-09-30';

export function pinClock(today) {
  const Real = globalThis.Date;
  const now = new Real();
  const [y, m, d] = today.split('-').map(Number);
  const offset = new Real(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).getTime() - now.getTime();
  class DemoDate extends Real {
    constructor(...args) {
      if (args.length === 0) super(Real.now() + offset);
      else super(...args);
    }
    static now() { return Real.now() + offset; }
  }
  globalThis.Date = DemoDate;
}
