// Preloaded into the recording API (rebuild.sh: node --import ./demo/clock.mjs),
// so its "today" is the demo's (D257), the same day the browser is pinned to.
import { DEMO_TODAY, pinClock } from '../../web/src/demo-clock.js';

pinClock(DEMO_TODAY);
