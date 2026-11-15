// Renders assets/icon.svg to a 1024px PNG for `tauri icon`.
import { launchBrowser } from './lib/app.mjs';
import { readFileSync } from 'node:fs';
const svg = readFileSync('assets/icon.svg', 'utf8');
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator('svg').screenshot({ path: 'assets/icon.png', omitBackground: true });
await browser.close();
