// The hosted website: builds it with SITE_URL into dist-site/, serves it the way Cloudflare Pages does (the _headers
// rules, /app -> app.html), and checks each page in Chrome under its real content security policy.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { launchBrowser } from './lib/app.mjs';

const dir = resolve('dist-site');
execFileSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--outDir', dir, '--emptyOutDir'], {
  env: { ...process.env, SITE_URL: 'https://slopculator.example/' },
  stdio: 'ignore',
});

let failed = 0;
const expect = (ok, what) => {
  if (!ok) {
    failed++;
    console.log(`FAIL  ${what}`);
  }
};

for (const f of ['index.html', 'app.html', 'privacy.html', '_headers', 'preview.png', 'sitemap.xml', 'robots.txt']) expect(existsSync(join(dir, f)), `the build has ${f}`);
const rules = readFileSync(join(dir, '_headers'), 'utf8');
const headers = Object.fromEntries(rules.split('\n').filter((l) => l.startsWith('  ') && !l.startsWith('  !')).map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));
const app = readFileSync(join(dir, 'app.html'), 'utf8');
const script = /<script type="module"[^>]*>([\s\S]*?)<\/script>/.exec(app)?.[1] ?? '';
const hash = createHash('sha256').update(script).digest('base64');
expect(headers['Content-Security-Policy']?.includes(`'sha256-${hash}'`), "the CSP's script hash is app.html's script");
expect(/^ {2}! Nel$/m.test(rules) && /^ {2}! Report-To$/m.test(rules), "_headers removes Cloudflare's Network Error Logging headers");
for (const page of ['index.html', 'privacy.html']) {
  const html = readFileSync(join(dir, page), 'utf8');
  expect(!/<script/i.test(html), `${page} has no script`);
  expect(!html.includes('{{'), `${page} has every placeholder filled`);
}

const types = { html: 'text/html; charset=utf-8', png: 'image/png', xml: 'application/xml', txt: 'text/plain' };
const server = createServer((req, res) => {
  let path = new URL(req.url, 'http://x').pathname;
  if (path === '/') path = '/index.html';
  if (!path.includes('.')) path += '.html';
  const file = join(dir, path);
  if (!existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { ...headers, 'Content-Type': types[path.split('.').pop()] });
  res.end(readFileSync(file));
}).listen(0);
const base = `http://localhost:${server.address().port}`;
const browser = await launchBrowser();

async function visit(path, viewport, check) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('request', (r) => !/^(data:|blob:)/.test(r.url()) && !r.url().startsWith(base) && problems.push(`requested ${r.url()}`));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP blocked ${e.blockedURI} (${e.violatedDirective})`)));
  await page.goto(base + path);
  await page.evaluate(() => document.fonts.ready);
  const where = `${path} at ${viewport.width}px`;
  expect(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `${where} doesn't scroll sideways`);
  if (check) await check(page, where);
  expect(problems.length === 0, `${where} has no errors, CSP violations or outside requests: ${problems.join('; ')}`);
  await context.close();
}

for (const width of [1440, 390]) {
  await visit('/', { width, height: 900 }, async (page, where) => {
    expect((await page.locator('h1').textContent()).length > 0, `${where} has a headline`);
    expect(await page.locator(`.shot.${width < 600 ? 'phone' : 'desktop'}`).isVisible(), `${where} shows the screenshot for its width`);
  });
  await visit('/privacy', { width, height: 900 }, async (page, where) => {
    expect((await page.locator('main h2').count()) >= 4, `${where} shows the policy's sections`);
  });
}
await visit('/', { width: 1280, height: 800 }, async (page) => {
  await page.click('.hero .btn.primary');
  await page.waitForFunction(() => !!window.slopculator);
  expect(new URL(page.url()).pathname === '/app', `Open Slopculator goes to /app, not ${page.url()}`);
});
for (const width of [1280, 390]) {
  await visit('/app', { width, height: 800 }, async (page, where) => {
    await page.waitForFunction(() => !!window.slopculator);
    const title = await page.locator('.sheet-title').isVisible();
    expect(!title, `${where}: an unnamed sheet's title steps aside for the logo link`);
    await page.click('.brand-home');
    await page.waitForURL(`${base}/`);
    expect(!(await page.locator('dialog[open]').count()), `${where}: the logo opened a dialog instead of going home`);
  });
}
await visit('/app#q=2*21', { width: 1280, height: 800 }, async (page) => {
  await page.waitForFunction(() => window.slopculator?.lines().some((l) => l.text === '2*21' && l.result === '42'));
});

await browser.close();
server.close();
console.log(failed ? `${failed} site checks failed` : 'site checks passed');
process.exit(failed ? 1 : 0);
