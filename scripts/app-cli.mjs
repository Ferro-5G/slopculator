#!/usr/bin/env node
// Reusable CLI to drive the built web app (dist/index.html) the way a user does, for quick checks and agent verification.
// Run `npm run build` first so dist/index.html reflects your changes.
//
// Examples:
//   node scripts/app-cli.mjs doctor
//   node scripts/app-cli.mjs eval "normalcdf(-1, 1)"
//   node scripts/app-cli.mjs state --seed "a = 2" --seed "y = a x"
//   node scripts/app-cli.mjs run --type "0.1 + 0.2" --press Enter --click "File" --snapshot --shot .shots/cli.png
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { exposeKeys, launchBrowser, openApp } from './lib/app.mjs';

const HELP = `Usage: node scripts/app-cli.mjs <command> [options]

Commands:
  doctor              Verify dist/index.html exists, boots cleanly, and exposes window.slopculator
  eval <expr>         Evaluate an expression against the sheet (with optional --seed lines)
  lines               Print current sheet lines and results as JSON
  state               Print lines, settings, graph view, presence phases, scroll state, and modals
  run                 Execute interactive steps in order (--type, --press, --click, --seed, --snapshot, --shot)
  help                Show this help

Options:
  --phone             Use a 390x844 mobile viewport with touch enabled
  --dark              Use prefers-color-scheme: dark
  --seed <line>       Seed a sheet line before running (repeatable)
  --type <text>       Type text into the focused element (run)
  --press <key>       Press a keyboard shortcut or key, e.g. Enter, Escape, Control+k (run)
  --click <name>      Click a visible button or menuitem by accessible name or text (run)
  --snapshot          Print visible controls and landmarks as JSON (run)
  --shot <path>       Save a PNG screenshot (run / state)`;

function parseArgs(argv) {
  let command = null;
  const opts = { phone: false, dark: false, seeds: [], steps: [], shot: null, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--phone') opts.phone = true;
    else if (a === '--dark') opts.dark = true;
    else if (a === '--seed') opts.seeds.push(argv[++i] ?? '');
    else if (a === '--type') opts.steps.push({ op: 'type', value: argv[++i] ?? '' });
    else if (a === '--press') opts.steps.push({ op: 'press', value: argv[++i] ?? '' });
    else if (a === '--click') opts.steps.push({ op: 'click', value: argv[++i] ?? '' });
    else if (a === '--snapshot') opts.steps.push({ op: 'snapshot' });
    else if (a === '--shot') {
      const target = argv[++i] ?? '';
      opts.shot = target;
      opts.steps.push({ op: 'shot', value: target });
    } else if (a === '--help' || a === '-h') return { command: 'help', opts };
    else if (!command) command = a;
    else opts.positional.push(a);
  }
  return { command: command ?? 'help', opts };
}

async function readState(page) {
  return page.evaluate(() => {
    const api = window.slopculator;
    const presence = [...document.querySelectorAll('[data-presence]')].map((el) => ({
      class: el.className,
      presence: el.getAttribute('data-presence'),
      hidden: el.hidden,
      open: el.classList.contains('open'),
    }));
    const list = document.querySelector('#list, .rows');
    const modals = [...document.querySelectorAll('dialog[open], [role=dialog][aria-modal=true]:not([hidden])')].map((el) => ({
      tag: el.tagName.toLowerCase(),
      class: el.className,
      label: el.getAttribute('aria-label') ?? el.querySelector('h2')?.textContent ?? null,
    }));
    const inertCount = document.querySelectorAll('[inert]').length;
    return {
      version: api.version,
      lines: api.lines(),
      settings: api.settings(),
      graphView: api.graph.view(),
      graphNames: api.graph.names(),
      scrollState: list?.getAttribute('data-scroll') ?? null,
      presence,
      modals,
      inertCount,
    };
  });
}

async function readSnapshot(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden], [inert]');
    };
    const controls = [...document.querySelectorAll('button, input, a[href], [role=menuitem], [role=tab], [role=dialog]')]
      .filter(visible)
      .slice(0, 80)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') ?? (el.tagName === 'BUTTON' ? 'button' : el.tagName === 'INPUT' ? el.type || 'textbox' : null),
        name: el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent?.trim().slice(0, 60) ?? '',
        expanded: el.getAttribute('aria-expanded'),
        pressed: el.getAttribute('aria-pressed'),
      }));
    return { controls, lineCount: window.slopculator.lines().length };
  });
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (command === 'help' || !['doctor', 'eval', 'lines', 'state', 'run'].includes(command)) {
    console.log(HELP);
    process.exit(command === 'help' ? 0 : 1);
  }
  const distPath = resolve('dist/index.html');
  if (!existsSync(distPath)) {
    console.error(`Missing ${distPath}. Run "npm run build" first.`);
    process.exit(1);
  }

  const browser = await launchBrowser();
  const pageErrors = [];
  try {
    const context = await browser.newContext(opts.phone
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: opts.dark ? 'dark' : 'light' }
      : { viewport: { width: 1440, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light' });
    await exposeKeys(context);
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await openApp(page);

    if (opts.seeds.length > 0) {
      await page.evaluate((lines) => window.slopculator.setLines(lines), opts.seeds);
    }

    if (command === 'doctor') {
      const info = await page.evaluate(() => ({
        ok: typeof window.slopculator?.evaluate === 'function',
        version: window.slopculator?.version ?? null,
        functions: window.slopculator?.functions().length ?? 0,
        composerFocused: !!document.querySelector('.composer .expr'),
      }));
      const out = { ...info, distPath, pageErrors };
      console.log(JSON.stringify(out, null, 2));
      if (!info.ok || !info.composerFocused || pageErrors.length > 0) process.exitCode = 1;
      return;
    }

    if (command === 'eval') {
      const expr = opts.positional.join(' ').trim();
      if (!expr) {
        console.error('Usage: node scripts/app-cli.mjs eval "<expression>"');
        process.exitCode = 1;
        return;
      }
      const res = await page.evaluate((e) => window.slopculator.evaluate(e), expr);
      console.log(JSON.stringify(res, null, 2));
      if (!res.ok || pageErrors.length > 0) process.exitCode = 1;
      return;
    }

    if (command === 'lines') {
      const res = await page.evaluate(() => window.slopculator.lines());
      console.log(JSON.stringify(res, null, 2));
      return;
    }

    if (command === 'state') {
      const st = await readState(page);
      if (opts.shot) {
        mkdirSync(dirname(resolve(opts.shot)), { recursive: true });
        await page.screenshot({ path: opts.shot });
      }
      console.log(JSON.stringify({ ...st, pageErrors }, null, 2));
      if (pageErrors.length > 0) process.exitCode = 1;
      return;
    }

    if (command === 'run') {
      const output = { steps: [], pageErrors };
      for (const step of opts.steps) {
        if (step.op === 'type') {
          await page.keyboard.type(step.value);
          output.steps.push({ op: 'type', value: step.value });
        } else if (step.op === 'press') {
          await page.keyboard.press(step.value);
          output.steps.push({ op: 'press', value: step.value });
        } else if (step.op === 'click') {
          const byRole = page.getByRole('button', { name: step.value }).or(page.getByRole('menuitem', { name: step.value }));
          const target = (await byRole.count()) > 0 ? byRole.first() : page.getByText(step.value).first();
          await target.click();
          output.steps.push({ op: 'click', value: step.value });
        } else if (step.op === 'snapshot') {
          output.steps.push({ op: 'snapshot', data: await readSnapshot(page) });
        } else if (step.op === 'shot') {
          const dest = resolve(step.value);
          mkdirSync(dirname(dest), { recursive: true });
          await page.screenshot({ path: dest });
          output.steps.push({ op: 'shot', path: dest });
        }
      }
      output.state = await readState(page);
      console.log(JSON.stringify(output, null, 2));
      if (pageErrors.length > 0) process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

await main();
