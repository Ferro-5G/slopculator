// Drives the built app in Chrome and saves screenshots: node scripts/shot.mjs [outdir]
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { appUrl, launchBrowser } from './lib/app.mjs';

const out = resolve(process.argv[2] ?? '.shots');
mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
const errors = [];

async function session(name, scheme, steps) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(appUrl);
  await page.waitForTimeout(150);
  await steps(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
}

const type = async (page, text) => {
  await page.keyboard.type(text, { delay: 2 });
  await page.keyboard.press('Enter');
};

await session('normal-light', 'light', async (page) => {
  await type(page, 'normalcdf(-inf, -2.5, 0, 1)');
  await type(page, 'zscore(180, 280, 40)');
  await type(page, 'invNorm(0.975)');
  await page.keyboard.press('Control+Alt+N');
  await page.waitForTimeout(100);
  await page.fill('.dist .max', '-2.5');
  await page.locator('.rows .row').nth(1).locator('.expr').click();
});

await session('normal-dark', 'dark', async (page) => {
  await type(page, 'μ = 400');
  await type(page, 'σ = 50');
  await page.keyboard.type('normaldist(μ, σ)');
  await page.check('.dist .cdf');
  await page.fill('.dist .min', '350');
  await page.fill('.dist .max', '500');
  await page.focus('.dist .max');
  await page.keyboard.press('Enter');
  await type(page, 'empirical(400, 50, 350, 500)');
});

await session('features', 'light', async (page) => {
  await type(page, 'y = x^3 - 3x');
  await type(page, 'y = 1');
  await page.keyboard.type('norm');
  await page.locator('.rows .row').nth(0).locator('.expr').click();
  await page.locator('.rows .row').nth(2).locator('.expr').click();
  await page.mouse.move(0, 0);
});

await session('graphs', 'light', async (page) => {
  await type(page, 'y = sin(x)');
  await page.keyboard.press('Control+Alt+D');
  await type(page, 'a = 2');
  await type(page, 'y > a(x - 1)^2 - 4');
  await type(page, 'x^2 + y^2 = 16');
  await type(page, '{(1, 2), (3, -1), (-2, 4)}');
  await type(page, 'det([[1,2],[3,4]])');
  await type(page, 'inv([[1,2],[3,4]])');
});

console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
