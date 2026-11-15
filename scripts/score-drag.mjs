#!/usr/bin/env node
// Scores how a drag plays back on a 120 Hz display: raw touch samples against the smoothed path. The smoother is imported
// from its TypeScript source, so this needs Node 22.18 or later, which strips the types itself.
//
//   node scripts/score-drag.mjs samples.json[#n] ...   [tMs, x, y] samples in points; #n picks trace n of a nested file
//   node scripts/score-drag.mjs --synthetic [--seed n]  a slow 20–60 pt/s drag with 0.33-point steps and irregular reports
//   add --module path.ts   score another estimator that exports startSmoother, stepSmoother and DEFAULT_SMOOTHER
//   add --params key=value,...   to score one setting of the module's parameters
//   add --search a.json[#n],b.json   to search the parameters on those traces, then report every trace named.
//     The search covers each key of DEFAULT_SMOOTHER within SEARCH_BOUNDS (optional export; default 0.001 to 1000).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

const modulePath = option('--module') ?? '../src/ui/motionsmoother.ts';
const lib = await import(pathToFileURL(resolve(import.meta.dirname, modulePath)).href);
const { DEFAULT_SMOOTHER, startSmoother, stepSmoother } = lib;
const SEARCH_BOUNDS = lib.SEARCH_BOUNDS ?? {};

const FRAME_MS = 1000 / 120;
const WINDOW_MS = 100;
// A frame is slow when the finger's speed over the 200 ms around it is under this many points per second.
const SLOW_SPEED = 200;
const STUTTER_POINTS = 0.01;
const LIMITS = { slowMeanLag: 0.3, slowMaxLag: 2.5, maxLag: 8, overshoot: 0.3 };
// A stop is a stretch of at least this many frames with the touch held still after the finger moved.
const STOP_FRAMES = 12;

// Constant-speed sweeps keep the lag honest where the trace is fast. They are not part of the per-trace report.
const SLOW_SWEEP = [20, 60, 100, 199];
const ANY_SWEEP = [200, 300, 1000];
const STEP = 0.33;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synthetic(seed) {
  const rand = mulberry32(seed);
  const quantize = (v) => Math.round(v / STEP) * STEP;
  // Distance in points at each millisecond. Speed is 40 ± 20 pt/s, so it runs from 20 to 60, and it eases in from rest.
  const along = [0];
  for (let ms = 1; ms <= 3000; ms++) {
    const sec = ms / 1000;
    const speed = (40 + 20 * Math.sin((2 * Math.PI * sec) / 1.5)) * Math.min(1, sec / 0.25);
    along.push(along[ms - 1] + speed / 1000);
  }
  const samples = [];
  for (let t = 0; t <= 3000; ) {
    const s = along[Math.round(t)];
    samples.push([t, quantize(100 + 0.8 * s), quantize(100 + 0.6 * s)]);
    // Reports come every 3 to 5 display frames, with a little jitter, so they never line up with frames.
    const frames = 3 + Math.floor(rand() * 3);
    t += frames * FRAME_MS + (rand() - 0.5) * 2;
  }
  return samples;
}

// A finger can't go from rest to full speed in one frame, so the sweep eases in over 250 ms and then holds the speed.
function sweep(speed) {
  const ease = 0.25;
  const samples = [];
  for (let t = 0; t <= 1000; t += FRAME_MS) {
    const sec = t / 1000;
    const travelled = sec < ease ? (speed * sec * sec) / (2 * ease) : speed * (ease / 2 + (sec - ease));
    samples.push([t, 100 + 0.8 * travelled, 100 + 0.6 * travelled]);
  }
  return samples;
}

function heldAt(samples, t) {
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  return samples[lo];
}

// Replays the samples at 120 Hz the way the app does: each frame reads the latest report held so far.
function run(samples, params) {
  const t0 = samples[0][0];
  const count = Math.floor((samples[samples.length - 1][0] - t0) / FRAME_MS) + 1;
  const raw = [];
  const moving = [];
  const speed = [];
  for (let i = 0; i < count; i++) {
    const t = t0 + i * FRAME_MS;
    const [, x, y] = heldAt(samples, t);
    raw.push([x, y]);
    const [, ax, ay] = heldAt(samples, t - WINDOW_MS);
    const [, bx, by] = heldAt(samples, t + WINDOW_MS);
    const travel = Math.hypot(bx - ax, by - ay);
    moving.push(travel > 0);
    speed.push((travel / (2 * WINDOW_MS)) * 1000);
  }
  const filtered = [raw[0]];
  let state = startSmoother(raw[0][0], raw[0][1]);
  for (let i = 1; i < count; i++) {
    state = stepSmoother(state, raw[i][0], raw[i][1], FRAME_MS, params);
    filtered.push([state.x, state.y]);
  }
  return { raw, filtered, moving, speed };
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// The overshoot after each stop: how far the filtered path runs past the final touch point, measured along the direction
// the finger was moving just before it stopped.
function overshoot(r) {
  let worst = 0;
  for (let k = 1; k < r.raw.length; k++) {
    const moved = dist(r.raw[k], r.raw[k - 1]) > 0;
    if (!moved) continue;
    // k is the last frame that moved; the stop runs from k onwards while the touch point stays put.
    let m = k + 1;
    while (m < r.raw.length && dist(r.raw[m], r.raw[k]) === 0) m++;
    if (m - k - 1 < STOP_FRAMES) continue;
    const back = Math.max(0, k - STOP_FRAMES);
    const u = [r.raw[k][0] - r.raw[back][0], r.raw[k][1] - r.raw[back][1]];
    const len = Math.hypot(u[0], u[1]);
    if (len === 0) continue;
    const final = r.raw[k];
    for (let j = k; j < m; j++) {
      const along = ((r.filtered[j][0] - final[0]) * u[0] + (r.filtered[j][1] - final[1]) * u[1]) / len;
      worst = Math.max(worst, along);
    }
  }
  return worst;
}

// Per-frame metrics restricted to slow frames. Stutter is the share of slow frames that move under 0.01 points. Jerk is the
// RMS change in the per-frame displacement vector across slow frames. Lag is the distance from the held touch point.
function slowMetrics(r, path) {
  const slow = r.moving.map((m, i) => m && r.speed[i] < SLOW_SPEED);
  let stuck = 0;
  let count = 0;
  let sq = 0;
  let jerkN = 0;
  for (let i = 1; i < path.length; i++) {
    if (!slow[i]) continue;
    count++;
    if (dist(path[i], path[i - 1]) < STUTTER_POINTS) stuck++;
    if (i >= 2) {
      const vx = path[i][0] - path[i - 1][0];
      const vy = path[i][1] - path[i - 1][1];
      const ux = path[i - 1][0] - path[i - 2][0];
      const uy = path[i - 1][1] - path[i - 2][1];
      sq += (vx - ux) ** 2 + (vy - uy) ** 2;
      jerkN++;
    }
  }
  let meanLag = 0;
  let maxSlowLag = 0;
  let maxLag = 0;
  let lagN = 0;
  for (let i = 0; i < path.length; i++) {
    const d = dist(path[i], r.raw[i]);
    maxLag = Math.max(maxLag, d);
    if (!slow[i]) continue;
    meanLag += d;
    maxSlowLag = Math.max(maxSlowLag, d);
    lagN++;
  }
  return {
    frames: count,
    stutter: count ? (100 * stuck) / count : 0,
    jerk: Math.sqrt(sq / Math.max(1, jerkN)),
    meanLag: lagN ? meanLag / lagN : 0,
    maxSlowLag,
    maxLag,
    overshoot: overshoot(r),
  };
}

// The same stutter and jerk, measured on the touch points themselves, for comparison with the filtered path.
function rawMetrics(r) {
  const { stutter, jerk } = slowMetrics(r, r.raw);
  return { stutter, jerk };
}

// The constant-speed sweeps, scored as the largest lag they reach.
function sweepLag(speeds, params) {
  let max = 0;
  for (const speed of speeds) {
    const r = run(sweep(speed), params);
    for (let i = 0; i < r.raw.length; i++) max = Math.max(max, dist(r.filtered[i], r.raw[i]));
  }
  return max;
}

function evaluate(samples, params) {
  const r = run(samples, params);
  const m = slowMetrics(r, r.filtered);
  const over = (v, limit) => Math.max(0, v - limit);
  const penalty =
    over(m.meanLag, LIMITS.slowMeanLag) * 100 +
    over(m.maxSlowLag, LIMITS.slowMaxLag) +
    over(m.maxLag, LIMITS.maxLag) +
    over(m.overshoot, LIMITS.overshoot) * 100;
  return { m, feasible: penalty === 0, penalty, cost: m.jerk + 1000 * penalty };
}

// Hard limits and the sweeps sit in the search cost, so a feasible setting always beats an infeasible one.
function evaluateSweeps(params) {
  const slow = sweepLag(SLOW_SWEEP, params);
  const any = sweepLag(ANY_SWEEP, params);
  return { slow, any, over: Math.max(0, slow - LIMITS.slowMaxLag) + Math.max(0, any - LIMITS.maxLag) };
}

function searchCost(traces, params) {
  let total = 0;
  let penalty = 0;
  for (const samples of traces) {
    const e = evaluate(samples, params);
    total += e.cost / traces.length;
    penalty += e.penalty;
  }
  const sw = evaluateSweeps(params);
  return total + 1000 * sw.over + 1000 * penalty / Math.max(1, traces.length);
}

// The lag limits make a narrow ridge, so a coarse grid finds it and a hill-climb refines. Each key gets its own grid.
const KEYS = Object.keys(DEFAULT_SMOOTHER);
const bounds = (key) => SEARCH_BOUNDS[key] ?? [0.001, 1000];
// Geometric spacing, or linear when the range starts at zero.
const geometric = (key, n = 9) => {
  const [lo, hi] = bounds(key);
  return Array.from({ length: n }, (_, i) => (lo > 0 ? lo * (hi / lo) ** (i / (n - 1)) : lo + ((hi - lo) * i) / (n - 1)));
};

function search(traces) {
  const grids = KEYS.map((key) => geometric(key));
  let best = null;
  const visit = (i, p) => {
    if (i === KEYS.length) {
      const c = searchCost(traces, p);
      if (!best || c < best.c) best = { p: { ...p }, c };
      return;
    }
    for (const v of grids[i]) visit(i + 1, { ...p, [KEYS[i]]: v });
  };
  visit(0, {});
  let factor = 1.5;
  for (let round = 0; round < 80 && factor > 1.01; round++) {
    let improved = false;
    for (const key of KEYS) {
      for (const f of [factor, 1 / factor]) {
        const [lo, hi] = bounds(key);
        const value = best.p[key] * f;
        if (value < lo || value > hi) continue;
        const p = { ...best.p, [key]: value };
        const c = searchCost(traces, p);
        if (c < best.c) {
          best = { p, c };
          improved = true;
        }
      }
    }
    if (!improved) factor = Math.sqrt(factor);
  }
  return best.p;
}

function loadSamples(spec) {
  if (spec === '--synthetic') return { samples: synthetic(Number(option('--seed') ?? 1)), name: `synthetic seed ${option('--seed') ?? 1}` };
  const [file, index] = spec.split('#');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const samples = index === undefined ? data : data[Number(index)];
  if (!Array.isArray(samples) || samples.length < 2 || samples.some((s) => s.length !== 3 || !s.every(Number.isFinite))) {
    console.error(`${spec} must name an array of at least two [tMs, x, y] numeric samples`);
    process.exit(2);
  }
  return { samples, name: index === undefined ? file : `${file}#${index}` };
}

const pad = (v, n) => String(v).padStart(n);
const fixed = (v, d) => v.toFixed(d).padStart(d + 5);

function report(name, samples, params) {
  const r = run(samples, params);
  const raw = rawMetrics(r);
  const e = evaluate(samples, params);
  const m = e.m;
  const sw = evaluateSweeps(params);
  const ok = e.feasible && sw.over === 0;
  console.log(
    `${name.padEnd(22)} slow frames ${pad(m.frames, 4)}  stutter ${fixed(m.stutter, 1)}%  jerk ${fixed(m.jerk, 3)}  ` +
      `mean lag ${fixed(m.meanLag, 3)}  max lag ${fixed(m.maxSlowLag, 3)}  all-frame max lag ${fixed(m.maxLag, 3)}  ` +
      `overshoot ${fixed(m.overshoot, 3)}  ${ok ? 'within limits' : 'OUTSIDE LIMITS'}`,
  );
  console.log(`${''.padEnd(22)} raw: stutter ${fixed(raw.stutter, 1)}%  jerk ${fixed(raw.jerk, 3)}   sweeps: slow max ${sw.slow.toFixed(3)}, any max ${sw.any.toFixed(3)}`);
  return ok;
}

const format = (p) => Object.entries(p).map(([k, v]) => `${k} ${v.toPrecision(4)}`).join('  ');

const inputs = [];
const searchSpec = option('--search');
if (flag('--synthetic')) inputs.push('--synthetic');
for (const a of args) if (a.endsWith('.json') || a.includes('.json#')) inputs.push(a);
if (searchSpec) for (const a of searchSpec.split(',')) if (!inputs.includes(a)) inputs.push(a);

if (inputs.length === 0) {
  console.error('usage: node scripts/score-drag.mjs <samples.json[#n]> ... | --synthetic [--seed n]  [--module f.ts] [--params key=value,...] [--search a.json#n,...]');
  process.exit(2);
}

let params = DEFAULT_SMOOTHER;
if (option('--params')) {
  params = { ...DEFAULT_SMOOTHER };
  for (const pair of option('--params').split(',')) {
    const [key, value] = pair.split('=');
    if (!(key in DEFAULT_SMOOTHER)) throw new Error(`unknown parameter ${key}`);
    params[key] = Number(value);
  }
}
if (searchSpec) {
  const trainNames = searchSpec.split(',');
  const traces = trainNames.map((s) => loadSamples(s).samples);
  params = search(traces);
  console.log(`searched on ${trainNames.join(', ')}: ${format(params)}\n`);
}

for (const spec of inputs) {
  const { samples, name } = loadSamples(spec);
  report(name, samples, params);
}
