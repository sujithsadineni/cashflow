/**
 * Draws the Wallet card (D373) — the colour fields, the sheen, the frost
 * that falls on everything but the named colour, and a fine grain — in one
 * pass on the GPU, at the canvas's full resolution, every frame. No CSS
 * blur or blend layer is involved: those, re-rasterised under a 3D tilt
 * every frame, were what made the first version flicker.
 *
 * The fragment shader runs exactly the blend weightsAt() runs in JS
 * (lib/overview/wallet-fields.js), as a one-pass ("online") softmax, so the
 * hover names the colour that's drawn. Without WebGL — or when the GPU
 * drops the context — the same picture is painted on a 2D canvas instead.
 *
 * The renderer owns its canvas: it makes a fresh one inside `host` and
 * removes it on dispose(). A canvas that has held a WebGL context can't
 * be reused (not for WebGL once the context is lost, never for 2D), and
 * React mounts effects twice in development — reusing one canvas is what
 * broke the first GPU version.
 *
 *   const r = createWalletRenderer(host);     // { kind, canvas, draw(scene), lost, dispose() }
 *   r.draw({ fields, focusMix, sheen, dark })  // fields: [{ cx, cy, csx, csy, amp, hl, lab }]
 */
import { SHARPNESS, MAX_FIELDS, weightsAt, labToRgb, cardHeight } from '../../../lib/overview/wallet-fields';

const VERT = `attribute vec2 p; varying vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
#define MAX ${MAX_FIELDS}
varying vec2 uv;
uniform int uCount;
uniform vec4 uGeo[MAX];    // cx, cy, csx, csy (card units: width 1, height ${cardHeight.toFixed(5)})
uniform vec4 uCol[MAX];    // OKLab L, a, b, amp
uniform vec4 uHl[MAX];     // x: how named this field is (0–1)
uniform float uAnyHl, uSheen, uDark;
uniform vec2 uRes;

vec3 toSrgb(vec3 lab) {
  float l = pow(lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z, 3.0);
  float m = pow(lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z, 3.0);
  float s = pow(lab.x - 0.0894841775 * lab.y - 1.291485548 * lab.z, 3.0);
  vec3 lin = clamp(vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s), 0.0, 1.0);
  return mix(lin * 12.92, 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, lin));
}
float grain(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 q = vec2(uv.x, (1.0 - uv.y) * ${cardHeight.toFixed(5)});
  float best = -1e9, sum = 0.0, mem = 0.0;
  vec3 lab = vec3(0.0);
  for (int i = 0; i < MAX; i++) {
    if (i >= uCount) break;
    vec4 g = uGeo[i];
    vec2 d = (q - g.xy) / g.zw;
    float e = -${SHARPNESS.toFixed(3)} * dot(d, d) + log(uCol[i].w + 1e-4);
    if (e > best) { float k = exp(best - e); sum = sum * k + 1.0; lab = lab * k + uCol[i].xyz; mem = mem * k + uHl[i].x; best = e; }
    else { float w = exp(e - best); sum += w; lab += w * uCol[i].xyz; mem += w * uHl[i].x; }
  }
  lab /= sum; mem /= sum;
  float frost = max(uAnyHl - mem, 0.0) * 0.8;                       // everything but the named colour frosts over
  lab = vec3(mix(lab.x, mix(0.95, 0.32, uDark), frost), lab.yz * (1.0 - frost));
  float band = (q.x * 0.82 + q.y * 0.57) - uSheen;                  // a soft diagonal sheen passing over
  lab.x += 0.07 * exp(-band * band * 60.0);
  vec3 rgb = toSrgb(lab) + (grain(uv * uRes) - 0.5) / 255.0 * 3.0;   // grain doubles as dither: no banding
  gl_FragColor = vec4(rgb, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
  return sh;
}

function glRenderer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
  if (!gl) return null;
  if (gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) < MAX_FIELDS * 3 + 8) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(['uCount', 'uGeo', 'uCol', 'uHl', 'uAnyHl', 'uSheen', 'uDark', 'uRes'].map((n) => [n, gl.getUniformLocation(prog, n)]));
  const geo = new Float32Array(MAX_FIELDS * 4), col = new Float32Array(MAX_FIELDS * 4), hl = new Float32Array(MAX_FIELDS * 4);
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
  return {
    kind: 'webgl',
    get lost() { return lost || gl.isContextLost(); },
    draw({ fields, focusMix, sheen, dark }) {
      if (lost) return;
      const n = Math.min(fields.length, MAX_FIELDS);
      for (let i = 0; i < n; i++) {
        const f = fields[i];
        geo.set([f.cx, f.cy, f.csx, f.csy], i * 4); col.set([f.lab[0], f.lab[1], f.lab[2], f.amp], i * 4); hl[i * 4] = f.hl;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1i(u.uCount, n); gl.uniform4fv(u.uGeo, geo); gl.uniform4fv(u.uCol, col); gl.uniform4fv(u.uHl, hl);
      gl.uniform1f(u.uAnyHl, focusMix); gl.uniform1f(u.uSheen, sheen); gl.uniform1f(u.uDark, dark ? 1 : 0);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}

function freshCanvas(host) {
  const c = document.createElement('canvas');
  c.className = 'absolute inset-0 size-full';
  host.append(c);
  return c;
}

/** The same picture without WebGL: painted small and scaled up smoothly (no CSS blur). */
function canvasRenderer(canvas) {
  const ctx = canvas.getContext('2d'); if (!ctx) return null;
  const small = document.createElement('canvas'); small.width = 160; small.height = Math.round(160 * cardHeight);
  const sctx = small.getContext('2d'), img = sctx.createImageData(small.width, small.height);
  return {
    kind: '2d', lost: false,
    draw({ fields, focusMix, dark }) {
      const d = img.data, W = new Float64Array(fields.length);
      for (let y = 0; y < small.height; y++) for (let x = 0; x < small.width; x++) {
        weightsAt((x + 0.5) / small.width, ((y + 0.5) / small.height) * cardHeight, fields, W);
        let L = 0, A = 0, B = 0, mem = 0;
        for (let i = 0; i < fields.length; i++) { const w = W[i], lab = fields[i].lab; L += w * lab[0]; A += w * lab[1]; B += w * lab[2]; mem += w * fields[i].hl; }
        const fz = Math.max(focusMix - mem, 0) * 0.8;
        L += ((dark ? 0.32 : 0.95) - L) * fz; A *= 1 - fz; B *= 1 - fz;
        const [r, g, b] = labToRgb([L, A, B]), o = (y * small.width + x) * 4;
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
      sctx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    },
    dispose() {},
  };
}

export function createWalletRenderer(host, { prefer = 'webgl' } = {}) {
  const own = (canvas, r) => ({ ...r, canvas, kind: r.kind, get lost() { return r.lost; }, draw: r.draw, dispose() { r.dispose(); canvas.remove(); } });
  if (prefer === 'webgl') {
    const canvas = freshCanvas(host);
    try { const r = glRenderer(canvas); if (r) return own(canvas, r); } catch { /* a GPU that can't compile it: paint in 2D */ }
    canvas.remove();
  }
  const canvas = freshCanvas(host);
  return own(canvas, canvasRenderer(canvas));
}
