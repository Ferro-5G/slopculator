import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const launchBrowser = () => chromium.launch({ channel: process.env.BROWSER ?? 'chrome' });
export const appUrl = pathToFileURL(resolve('dist/index.html')).href;

function keysFrom(file, name) {
  const body = new RegExp(`export const ${name} = \\{([^}]*)\\}`).exec(readFileSync(file, 'utf8'))?.[1];
  if (!body) throw new Error(`${name} isn't in ${file} any more`);
  return Object.fromEntries([...body.matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
}
const constFrom = (file, name) => new RegExp(`export const ${name} = '([^']+)'`).exec(readFileSync(file, 'utf8'))[1];
export const KEYS = {
  ...keysFrom('src/app/persistence.ts', 'KEYS'),
  current: constFrom('src/ui/document.ts', 'CURRENT_SHEET_KEY'),
  history: constFrom('src/ui/history.ts', 'HISTORY_KEY'),
};

/**
 * A page's scripts can read the keys as `slopKeys`, which is why this runs before the page does. A fresh profile
 * would get the first run's example on its sheet; checks start from a blank one unless they clear this flag first.
 */
export const exposeKeys = (context) => context.addInitScript((keys) => {
  window.slopKeys = keys;
  try { if (localStorage.getItem(keys.firstRun) === null && !sessionStorage.getItem('e2e-first-run')) localStorage.setItem(keys.firstRun, 'e2e'); } catch { /* storage blocked: nothing to set */ }
}, KEYS);

/** Open the app and wait for its first frame: boot focuses on the next animation frame, before the first user edit. */
export async function openApp(page) {
  await page.goto(appUrl);
  await page.waitForFunction(() => !!window.slopculator);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
