// Imported first by main.jsx, so the demo's clock is pinned (D257) before
// any other module runs. Does nothing outside the demo build.
import { DEMO_TODAY, pinClock } from './demo-clock';

if (import.meta.env.VITE_DEMO === '1') pinClock(DEMO_TODAY);
