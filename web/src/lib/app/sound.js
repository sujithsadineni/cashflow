/**
 * A tiny synthesizer for UI sound (D153) — Web Audio only, no files, no
 * package. Everything is a shaped oscillator or a filtered noise burst,
 * so it's a few KB of code rather than a folder of MP3s.
 *
 * Browsers keep audio locked until the page gets a user gesture; until
 * then every call is a quiet no-op, and the first click anywhere unlocks
 * it (resume() is called on each play). `setEnabled(false)` mutes it all.
 * The on/off choice is remembered per browser.
 */

const STORAGE_KEY = 'cashflow_sound';

let ctx = null;
let enabled = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
})();

function audio() {
  if (!enabled || typeof window === 'undefined') return null;
  // Before any click, a context stays suspended with its clock frozen, so
  // notes scheduled now would all fire at once on the first click. Skip them.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export const soundEnabled = () => enabled;

export function setSoundEnabled(on) {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // Blocked storage: the choice still holds for this visit.
  }
}

/** One note: a quick attack, a soft decay, optional stereo position. */
export function note(freq, { dur = 0.18, type = 'sine', gain = 0.05, pan = 0, delay = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const env = a.createGain();
  const panner = a.createStereoPanner();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  panner.pan.value = pan;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(panner).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Several notes, lightly strummed. */
export function chord(freqs, opts = {}) {
  freqs.forEach((f, i) => note(f, { ...opts, delay: (opts.delay ?? 0) + i * 0.035 }));
}

/** A soft air sweep — filtered noise rising in pitch. */
export function whoosh({ dur = 0.5, gain = 0.07, delay = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const buffer = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(350, t);
  filter.frequency.exponentialRampToValueAtTime(3200, t + dur);
  const env = a.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + dur * 0.35);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(env).connect(a.destination);
  src.start(t);
  src.stop(t + dur);
}

/** A very short high click — hover feedback. */
export const tick = (pan = 0) => note(1600, { dur: 0.035, type: 'triangle', gain: 0.02, pan });

// C major, one octave up from middle C and beyond — the wordmark plays
// it letter by letter; the feature boxes pick notes from the pentatonic
// subset so any order sounds consonant.
export const C_MAJOR = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77, 1046.5];
export const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98];
