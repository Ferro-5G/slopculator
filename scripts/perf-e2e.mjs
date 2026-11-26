#!/usr/bin/env node
// End-to-end UI performance benchmark against the built web app (dist/index.html).
// Measures cold boot, typing latency on the 25-line benchmark sheet, slider drag frame times, resize reflow, and memory.
//
// Usage:
//   npm run build && node scripts/perf-e2e.mjs
//   node scripts/perf-e2e.mjs --json .shots/perf.json
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { exposeKeys, launchBrowser, openApp } from './lib/app.mjs';

const BENCH_LINES = [
  'μ = 400', 'σ = 50', 'normalcdf(350, 500, μ, σ)', 'invNorm(0.975, μ, σ)', 'zscore(180, 280, 40)',
  'L = {2,4,4,4,5,5,7,9}', 'sdp(L)', 'mean(L)', 'binomcdf(20, 0.3, 7)', 'nCr(52, 5)',
  'det([[1,2,3],[4,5,6],[7,8,10]])', 'inv([[1,2],[3,4]])', 'y = a sin(b(x - c)) + d',
  'a = 2', 'b = 3', 'c = 1', 'd = 0', 'x^2 + y^2 = 25', 'y > x^2 - 4', 'f(x) = x^3 - 3x',
  'sum(n^2, n, 1, 100)', 'compound(1000, 0.05, 12, 10)', 'normaldist(μ, σ)', 'sin(30)', 'log_2(1024)',
];

function pct(values, p) {
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return Number(s[idx].toFixed(2));
}

function stats(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { p50: pct(values, 50), p90: pct(values, 90), max: pct(values, 100), mean: Number(mean.toFixed(2)) };
}

async function waitTwoFrames(page) {
  // Measuring actual post-paint frame completion requires waiting for two animation frames in the browser.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function main() {
  const args = process.argv.slice(2);
  const jsonIdx = args.indexOf('--json');
  const jsonPath = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
  const distPath = resolve('dist/index.html');
  if (!existsSync(distPath)) {
    console.error(`Missing ${distPath}. Run "npm run build" first.`);
    process.exit(1);
  }

  const browser = await launchBrowser();
  try {
    // 1. Cold boot to interactive + first painted frames (5 runs).
    const bootMs = [];
    for (let i = 0; i < 5; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
      await exposeKeys(ctx);
      const page = await ctx.newPage();
      const t0 = performance.now();
      await openApp(page);
      bootMs.push(performance.now() - t0);
      await ctx.close();
    }

    // 2. Typing, slider drag, resize, and memory on the 25-line benchmark sheet.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    await exposeKeys(ctx);
    const page = await ctx.newPage();
    await openApp(page);
    await page.evaluate((lines) => window.slopculator.setLines(lines), BENCH_LINES);
    await waitTwoFrames(page);

    // Keystroke-to-paint latency typing a new expression into the composer on the 25-line sheet.
    const composer = page.locator('.composer .expr');
    await composer.click();
    const chars = 'sin(a*x) + cos(b*x) + 1/3'.split('');
    const typeMs = [];
    for (const ch of chars) {
      const t0 = performance.now();
      await page.keyboard.type(ch);
      await waitTwoFrames(page);
      typeMs.push(performance.now() - t0);
    }

    // Slider drag frame time across 30 distinct steps on parameter `a`.
    const slider = page.getByRole('slider', { name: 'a' });
    const dragMs = [];
    if ((await slider.count()) > 0) {
      const bounds = await slider.evaluate((el) => {
        const inp = /** @type {HTMLInputElement} */ (el);
        return { min: Number(inp.min || -10), max: Number(inp.max || 10), step: Number(inp.step || 1) || 1 };
      });
      await slider.focus();
      for (let step = 0; step < 30; step++) {
        const span = Math.max(bounds.step, bounds.max - bounds.min);
        const raw = bounds.min + ((step * bounds.step) % span);
        const val = Number((Math.round(raw / bounds.step) * bounds.step).toFixed(6));
        const t0 = performance.now();
        await slider.evaluate((el, v) => {
          const inp = /** @type {HTMLInputElement} */ (el);
          inp.value = String(v);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }, val);
        await waitTwoFrames(page);
        dragMs.push(performance.now() - t0);
      }
      await slider.blur();
    }

    // Wide <-> narrow Cascade layout resize reflow.
    const resizeMs = [];
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }, { width: 720, height: 900 }, { width: 1440, height: 900 }]) {
      const t0 = performance.now();
      await page.setViewportSize(vp);
      await waitTwoFrames(page);
      resizeMs.push(performance.now() - t0);
    }

    const resources = await page.evaluate(() => {
      const mem = /** @type {{ usedJSHeapSize?: number }} */ (/** @type {unknown} */ (performance).memory ?? {});
      return {
        domNodes: document.querySelectorAll('*').length,
        jsHeapMB: mem.usedJSHeapSize ? Number((mem.usedJSHeapSize / (1024 * 1024)).toFixed(2)) : null,
        lineCount: window.slopculator.lines().length,
      };
    });

    await ctx.close();

    const report = {
      timestamp: new Date().toISOString(),
      bootMs: stats(bootMs),
      typing25LineMs: stats(typeMs),
      sliderDragMs: dragMs.length ? stats(dragMs) : null,
      resizeReflowMs: stats(resizeMs),
      resources,
    };

    console.log('\nSlopculator UI performance benchmark (dist/index.html)\n');
    console.log('| Metric | p50 (ms) | p90 (ms) | max (ms) |');
    console.log('| --- | ---: | ---: | ---: |');
    console.log(`| Cold boot (5 runs) | ${report.bootMs.p50} | ${report.bootMs.p90} | ${report.bootMs.max} |`);
    console.log(`| Typing on 25-line sheet | ${report.typing25LineMs.p50} | ${report.typing25LineMs.p90} | ${report.typing25LineMs.max} |`);
    if (report.sliderDragMs) {
      console.log(`| Slider drag (30 steps) | ${report.sliderDragMs.p50} | ${report.sliderDragMs.p90} | ${report.sliderDragMs.max} |`);
    }
    console.log(`| Viewport resize reflow | ${report.resizeReflowMs.p50} | ${report.resizeReflowMs.p90} | ${report.resizeReflowMs.max} |`);
    console.log(`\nResources: ${resources.domNodes} DOM nodes, ${resources.lineCount} lines${resources.jsHeapMB !== null ? `, ${resources.jsHeapMB} MB JS heap` : ''}`);

    if (jsonPath) {
      const dest = resolve(jsonPath);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`Wrote ${dest}`);
    }
  } finally {
    await browser.close();
  }
}

await main();
