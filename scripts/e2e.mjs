import { mkdirSync, readFileSync } from 'node:fs';
import { exposeKeys, launchBrowser, openApp } from './lib/app.mjs';

mkdirSync('.shots', { recursive: true });
// Independent browser profiles make optional parallel batches safe. E2E_SHARD=0/4 runs the first of four.
const shard = process.env.E2E_SHARD?.split('/').map(Number);
if (shard && (shard.length !== 2 || !shard.every(Number.isInteger) || shard[1] < 1 || shard[0] < 0 || shard[0] >= shard[1])) throw new Error('E2E_SHARD must be index/count, with 0 <= index < count');
let checkIndex = 0;
const browser = await launchBrowser();
const results = [];
const errors = [];

/** @param phone true for a 390 × 844 phone, or a phone's viewport ({ width: 375, height: 667 }). */
async function check(name, fn, phone = false, { folded = false, clock = false, tauriCsp = false } = {}) {
  const index = checkIndex++;
  if (shard && index % shard[1] !== shard[0]) return;
  if (process.env.E2E_MATCH && !name.includes(process.env.E2E_MATCH)) return;
  const context = await browser.newContext(phone
    ? { viewport: phone === true ? { width: 390, height: 844 } : phone, isMobile: true, hasTouch: true, colorScheme: 'light' }
    : { viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await exposeKeys(context);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  // Before the app starts, so a timer from before a freeze can't fire past it and clearTimeout can't miss one.
  if (clock) await page.clock.install();
  await openApp(page, { tauriCsp });
  if (!phone && folded) {
    await page.keyboard.press('Control+Alt+Shift+K');
    await page.waitForTimeout(250);
  }
  try {
    await fn(page);
    results.push(`PASS  ${name}`);
  } catch (e) {
    results.push(`FAIL  ${name}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `.shots/e2e-fail-${name.replace(/\W+/g, '-')}.png` });
  }
  if (process.env.E2E_MATCH || shard) console.log(results.at(-1));
  await context.close();
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const lines = (page) => page.evaluate(() => window.slopculator.lines());
/** For a check run with { clock: true }. Only page.clock.runFor moves the page's clock then, so holds and toasts don't depend on how busy the machine is. */
const freezeClock = (page) => page.clock.pauseAt(Date.now() + 1000);
/** Records what the graph writes on its canvases, which nothing in the DOM shows. */
const watchCanvasText = (page) => page.evaluate(() => {
  const real = CanvasRenderingContext2D.prototype.fillText;
  window.canvasText = [];
  CanvasRenderingContext2D.prototype.fillText = function (text, x, y) {
    window.canvasText.push({ text, x, y, font: this.font });
    return real.call(this, text, x, y);
  };
});

await check('Tauri CSP keeps both looks styled and the parabola visible', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['2+2', 'x*x']));
  expect((await lines(page))[0].result === '4', 'arithmetic under the native CSP');
  // The policy drops inline style attributes, which is how the keypad's tabs once lost their colors.
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.ti-tab')].map((t) => getComputedStyle(t).getPropertyValue('--tab').trim()));
  expect(tabs.length === 5 && tabs.every(Boolean), `CSP blocked a tab's color: ${JSON.stringify(tabs)}`);
  for (const look of ['modern', 'retro']) {
    await page.selectOption('select.look', look, { force: true });
    const theme = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return { ink: style.getPropertyValue('--ink').trim(), curve: style.getPropertyValue('--curve-1').trim() };
    });
    expect(theme.ink && theme.curve, `${look}: CSP blocked the look stylesheet: ${JSON.stringify(theme)}`);
    const colored = await page.evaluate(async () => {
      const image = new Image();
      image.src = window.slopculator.graph.png();
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (Math.max(...pixels.slice(i, i + 3)) - Math.min(...pixels.slice(i, i + 3)) > 60) count++;
      }
      return count;
    });
    expect(colored > 100, `${look}: no colored curve in the graph export, ${colored} pixels`);
    await page.screenshot({ path: `.shots/e2e-tauri-csp-${look}.png` });
  }
}, false, { tauriCsp: true });

await check('two tabs: lines typed in one are still there after typing in the other', async (page) => {
  const typed = (p, text) => p.waitForFunction((t) => window.slopculator.lines().some((l) => l.text === t), text);
  await page.keyboard.type('10+1');
  await page.keyboard.press('Enter');
  await page.waitForFunction((key) => (localStorage.getItem(key) ?? '').includes('10+1'), (await page.evaluate(() => window.slopKeys)).document);
  const other = await page.context().newPage();
  await openApp(other);
  await typed(other, '10+1');
  await other.keyboard.type('20+2');
  await other.keyboard.press('Enter');
  // The first tab hears the save and takes the sheet, so its next edit builds on both lines.
  await typed(page, '20+2');
  await page.bringToFront();
  await page.keyboard.type('30+3');
  await page.keyboard.press('Enter');
  await typed(other, '30+3');
  await other.reload();
  await other.waitForFunction(() => !!window.slopculator);
  const kept = await other.evaluate(() => window.slopculator.lines().map((l) => l.text).filter(Boolean));
  expect(JSON.stringify(kept) === '["10+1","20+2","30+3"]', `the second tab lost lines: ${kept}`);
  // A dialog open in a tab was opened about the sheet as it was, so it closes when the tab takes the other tab's
  // sheet: Rename can't then rename the wrong sheet, and a History entry chosen after reopening lands on both lines.
  await page.bringToFront();
  await page.keyboard.press('Control+Alt+s');
  await page.waitForSelector('dialog[open]');
  await other.bringToFront();
  await other.keyboard.type('40+4');
  await other.keyboard.press('Enter');
  await typed(page, '40+4');
  expect(!(await page.evaluate(() => !!document.querySelector('dialog[open]'))), 'the dialog stayed open over a sheet that changed under it');
  await page.bringToFront();
  await page.keyboard.press('Control+Alt+y');
  await page.locator('dialog.history-dialog .history-open', { hasText: '10+1' }).first().click();
  await other.waitForFunction(() => window.slopculator.lines().filter((l) => l.text === '10+1').length === 2);
  const both = await other.evaluate(() => window.slopculator.lines().map((l) => l.text).filter(Boolean));
  expect(both.includes('40+4') && both.filter((t) => t === '10+1').length === 2, `choosing a History entry saved over the other tab: ${both}`);
  // A rename in one tab reaches the other, so its next edit doesn't save under the old name.
  await other.bringToFront();
  await other.evaluate(() => { window.prompt = () => null; });
  await other.keyboard.press('Control+Alt+s');
  await other.locator('dialog[open] input').fill('Shared');
  await other.locator('dialog[open] button[value=ok]').click();
  await page.waitForFunction(() => document.title.startsWith('Shared'));
  await other.close();
});

await check('Esc closes a tab page opened with the mouse, and the matrix editor names itself and its size buttons', async (page) => {
  await page.locator('.ti-tab').nth(1).click();
  await page.waitForFunction(() => !document.querySelector('.ti-page').hidden);
  expect(await page.evaluate(() => document.activeElement?.classList.contains('expr')), 'a mouse click on a tab moved the caret out of the line');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.ti-tab.lit'));
  expect(await page.evaluate(() => document.activeElement?.classList.contains('expr')), 'Esc took the caret out of the line');
  await page.keyboard.press('Control+Alt+4');
  await page.locator('.ti-tile', { hasText: 'Any size' }).click();
  await page.waitForSelector('dialog.mx[open]');
  const named = await page.evaluate(() => ({ dialog: document.querySelector('dialog.mx').getAttribute('aria-label'), title: document.querySelector('dialog.mx h2')?.textContent, buttons: [...document.querySelectorAll('dialog.mx .mx-size button')].map((b) => b.getAttribute('aria-label')) }));
  expect(named.dialog === 'New matrix' && named.title === 'New matrix', `the editor has no name: ${JSON.stringify(named)}`);
  expect(JSON.stringify(named.buttons) === '["Remove a row","Add a row","Remove a column","Add a column"]', `the size buttons: ${named.buttons}`);
});

await check('motion states: a cancelled Modes entry cannot reopen a closed sheet', async (page) => {
  const late = await page.evaluate(() => {
    const real = window.requestAnimationFrame, pending = [];
    window.requestAnimationFrame = (cb) => { pending.push(cb); return 100000 + pending.length; };
    try {
      document.querySelector('button.pill.more').click();
      document.querySelector('.ms-done').click();
    } finally { window.requestAnimationFrame = real; }
    // Deliver even the cancelled callback, as a stale completion from another motion engine could arrive.
    for (const cb of pending) cb(performance.now());
    return document.querySelector('.mode-sheet').classList.contains('open');
  });
  expect(!late, 'a stale entry frame repainted the sheet open after close');
  await page.waitForFunction(() => document.querySelector('.mode-sheet').hidden);
  expect(!(await page.evaluate(() => document.querySelector('#app').inert)), 'closed sheet kept the page inert');
}, true);

await check('motion states: Modes owns its closing input boundary and reverses safely', async (page) => {
  await page.click('button.pill.more');
  await page.waitForFunction(() => {
    const sheet = document.querySelector('.mode-sheet');
    return sheet.classList.contains('open') && sheet.getAnimations().every((a) => a.playState === 'finished');
  });
  const closing = await page.evaluate(() => {
    document.querySelector('.ms-done').click();
    const sheet = document.querySelector('.mode-sheet');
    const state = { phase: sheet.dataset.presence, hidden: sheet.hidden, inert: document.querySelector('#app').inert };
    document.querySelector('button.pill.more').click();
    return state;
  });
  expect(closing.phase === 'closing' && !closing.hidden && closing.inert, `closing lost modal ownership: ${JSON.stringify(closing)}`);
  await page.waitForFunction(() => document.querySelector('.mode-sheet').dataset.presence === 'open');
  await page.selectOption('.mode-sheet select.motion', 'off');
  await page.click('.ms-done');
  expect(await page.locator('.mode-sheet').isHidden(), 'Off did not close immediately');
}, true);

await check('motion states: Off and Reduced stop an active graph zoom', async (page) => {
  for (const motion of ['off', 'reduced']) {
    await page.evaluate(() => {
      const s = document.querySelector('select.motion'); s.value = 'full'; s.dispatchEvent(new Event('change', { bubbles: true }));
      window.slopculator.graph.reset();
      document.querySelector('.graph-tools button').click();
    });
    await page.clock.runFor(40);
    const stopped = await page.evaluate((motion) => {
      const s = document.querySelector('select.motion'); s.value = motion; s.dispatchEvent(new Event('change', { bubbles: true }));
      return window.slopculator.graph.view();
    }, motion);
    await page.clock.runFor(100);
    expect(JSON.stringify(await page.evaluate(() => window.slopculator.graph.view())) === JSON.stringify(stopped), `${motion}: a graph zoom kept moving`);
  }
}, false, { clock: true });

await check('motion states: Off settles keypad and graph panel transitions', async (page) => {
  const panels = await page.evaluate(() => {
    const s = document.querySelector('select.motion'); s.value = 'full'; s.dispatchEvent(new Event('change', { bubbles: true }));
    const button = (name) => [...document.querySelectorAll('.modebar button')].find((b) => b.textContent.trim() === name);
    button('Keypad').click(); button('Graph').click(); button('Graph').click();
    const running = document.querySelector('.keypad').getAnimations().length + document.querySelector('.graph-pane').getAnimations().length;
    s.value = 'off'; s.dispatchEvent(new Event('change', { bubbles: true }));
    return { running, keypad: document.querySelector('.keypad').hidden, graph: document.querySelector('.graph-pane').hidden,
      active: document.querySelector('.keypad').getAnimations().filter((a) => a.playState === 'running').length + document.querySelector('.graph-pane').getAnimations().filter((a) => a.playState === 'running').length,
      overflow: document.querySelector('.main').style.overflow };
  });
  expect(panels.running > 0 && panels.keypad && !panels.graph && panels.active === 0 && !panels.overflow, `panel policy state: ${JSON.stringify(panels)}`);
});

await check('motion states: Off settles an active notebook alignment glide', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(Array.from({ length: 40 }, (_, i) => `${i}+1`)));
  await page.clock.runFor(50);
  const phase = await page.evaluate(() => {
    const list = document.querySelector('.rows');
    // Exercise the JS settle without the browser's independent native scroll snap taking over first.
    list.style.scrollSnapType = 'none';
    list.scrollTop = 0;
    list.dispatchEvent(new Event('scrollend'));
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: 13 }));
    list.scrollTop = 13;
    list.dispatchEvent(new Event('scroll'));
    list.dispatchEvent(new Event('scrollend'));
    return list.dataset.scroll;
  });
  expect(phase === 'settling', `fixture did not start a glide: ${phase}`);
  await page.clock.runFor(40);
  const stopped = await page.evaluate(() => {
    const s = document.querySelector('select.motion'); s.value = 'off'; s.dispatchEvent(new Event('change', { bubbles: true }));
    return document.querySelector('.rows').scrollTop;
  });
  await page.clock.runFor(100);
  expect(Math.abs((await page.evaluate(() => document.querySelector('.rows').scrollTop)) - stopped) < 0.5, 'notebook alignment kept moving after Off');
}, false, { clock: true });

await check('motion states: pointer down takes ownership from a graph zoom immediately', async (page) => {
  await page.evaluate(() => document.querySelector('.graph-tools button').click());
  await page.clock.runFor(40);
  const box = await page.locator('.graph-canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.4);
  await page.mouse.down();
  const caught = await page.evaluate(() => window.slopculator.graph.view());
  await page.clock.runFor(100);
  expect(JSON.stringify(await page.evaluate(() => window.slopculator.graph.view())) === JSON.stringify(caught), 'the zoom kept moving under the held pointer');
  await page.mouse.up();
}, false, { clock: true });

await check('starter example loads a shaded curve', async (page) => {
  await page.click('.starter-card');
  await page.waitForTimeout(400);
  const l = await lines(page);
  expect(l.some((x) => x.probability && Math.abs(x.probability - 0.8186) < 1e-3), JSON.stringify(l));
  await page.screenshot({ path: '.shots/e2e-starter.png' });
});

await check('the Konami code unlocks Pride, strips itself from the line, and lands in Appearance', async (page) => {
  await page.click('.appear-btn');
  expect((await page.locator('.appear-menu button', { hasText: 'Pride colors' }).count()) === 0, 'Pride in Appearance before the code');
  await page.keyboard.press('Escape');
  await page.keyboard.type('88224646ba');
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-pride')), 'no data-pride after the code');
  const l = await lines(page);
  expect(l[0].text === '', `the code stayed in the line: ${l[0].text}`);
  await page.click('.appear-btn');
  expect((await page.locator('.appear-menu button', { hasText: 'Pride colors' }).count()) === 1, 'no Pride switch in Appearance');
  await page.keyboard.press('Escape');
  for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight']) await page.keyboard.press(k);
  await page.keyboard.type('ba');
  await page.waitForTimeout(250);
  expect(!(await page.evaluate(() => document.documentElement.hasAttribute('data-pride'))), 'the second code did not switch Pride off');
  await page.reload();
  await page.waitForTimeout(200);
  await page.click('.appear-btn');
  expect((await page.locator('.appear-menu button', { hasText: 'Pride colors' }).count()) === 1, 'Pride left Appearance after a reload');
  await page.screenshot({ path: '.shots/e2e-pride.png' });
});

await check('typo shows a fix button that corrects it', async (page) => {
  await page.keyboard.type('normcdf(1)');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const fix = page.locator('.fix').first();
  expect(await fix.isVisible(), 'no fix button');
  expect((await fix.textContent()).includes('normalcdf'), await fix.textContent());
  await fix.click();
  await page.waitForTimeout(150);
  const l = await lines(page);
  expect(l[0].text === 'normalcdf(1)' && Math.abs(Number(l[0].result) - 0.8413447) < 1e-6, JSON.stringify(l[0]));
});

await check('command palette inserts a function', async (page) => {
  await page.keyboard.press('Control+/');
  await page.keyboard.type('invn');
  await page.keyboard.press('Enter');
  await page.keyboard.type('0.975');
  await page.waitForTimeout(150);
  const l = await lines(page);
  expect(l[0].result?.startsWith('1.95996'), JSON.stringify(l[0]));
});

await check('copy graph image puts a PNG on the clipboard', async (page) => {
  await page.keyboard.type('y = sin(x)');
  await page.waitForTimeout(600);
  await page.locator('.graph-host').focus();
  await page.keyboard.press('c');
  // The picture is encoded and written asynchronously, so a slow machine needs longer than a fixed wait.
  let types = [];
  for (let i = 0; i < 50 && !types.includes('image/png'); i++) {
    await page.waitForTimeout(100);
    types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types));
  }
  const seen = await page.evaluate(() => ({ focus: document.activeElement?.className, toast: document.querySelector('.toast')?.textContent ?? null, visible: document.visibilityState, focused: document.hasFocus() }));
  expect(types.includes('image/png'), JSON.stringify({ types, ...seen }));
});

await check('a saved SVG of a trig graph labels x in multiples of π, as the canvas does', async (page) => {
  await page.keyboard.press('Control+Alt+D');
  expect((await page.evaluate(() => window.slopculator.settings().deg)) === false, 'in radians');
  await page.keyboard.type('y = sin(x)');
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+/');
  await page.keyboard.type('Save the graph as SVG');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 3000 }),
    page.keyboard.press('Enter'),
  ]);
  const svg = readFileSync(await download.path(), 'utf8');
  expect(/text-anchor="middle">−?\d*π/.test(svg), svg.slice(0, 400));
});

await check('±1σ shades μ − σ to μ + σ', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['normaldist(400, 50)', '']));
  await page.locator('.rows .row').first().locator('.cdf').check();
  await page.locator('.rows .row').first().locator('.sigma', { hasText: '±1σ' }).click();
  await page.waitForTimeout(200);
  const l = await lines(page);
  expect(Math.abs(l[0].probability - 0.6826894921) < 1e-8, JSON.stringify(l[0]));
  const bounds = await page.locator('.rows .row').first().locator('.bound').evaluateAll((els) => els.map((e) => e.value));
  expect(bounds[0] === '350' && bounds[1] === '450', bounds.join(','));
});

await check('click on a curve pins a label, a second click takes it off, and Delete clears pins', async (page) => {
  await page.keyboard.type('y = x^2 - 4');
  await page.waitForTimeout(700);
  await watchCanvasText(page);
  const box = await page.locator('.graph-canvas').boundingBox();
  const v = await page.evaluate(() => window.slopculator.graph.view());
  const at = (x, y) => [box.x + ((x - v.xmin) / (v.xmax - v.xmin)) * box.width, box.y + ((v.ymax - y) / (v.ymax - v.ymin)) * box.height];
  // png() draws one complete frame synchronously, without hover labels. Recording across
  // animation frames counted a pin again on each redraw. Keep duplicates within this frame.
  // A pin's label is the only 600-weight 12 px text the graph writes.
  const pins = () => page.evaluate(() => {
    window.canvasText.length = 0;
    window.slopculator.graph.png();
    return window.canvasText.filter((t) => t.font.startsWith('600 12px')).map((t) => t.text);
  });
  expect((await pins()).length === 0, 'a pin before any click');
  await page.mouse.click(...at(-5, 9));
  expect((await pins()).length === 0, 'a click away from the curve pinned something');
  await page.mouse.click(...at(3, 5));
  const pinned = await pins();
  expect(pinned.length === 1, `pins after a click on the curve: ${JSON.stringify(pinned)}`);
  const m = /^\(([\d.]+), ([\d.]+)\)$/.exec(pinned[0]);
  expect(m && Math.abs(Number(m[1]) - 3) < 0.2 && Math.abs(Number(m[2]) - (Number(m[1]) ** 2 - 4)) < 0.01, `the label is not a point on the curve: ${pinned[0]}`);
  await page.mouse.click(...at(3, 5));
  expect((await pins()).length === 0, 'a second click left the pin');
  await page.mouse.click(...at(3, 5));
  expect((await pins()).length === 1, 'no pin after clicking again');
  await page.mouse.click(...at(-3, 5));
  const twoPins = await pins();
  expect(twoPins.length === 2 && new Set(twoPins).size === 2, `two distinct pins: ${JSON.stringify(twoPins)}`);
  expect(JSON.stringify(await pins()) === JSON.stringify(twoPins), 'redrawing changed the pin count');
  await page.locator('.graph-host').focus();
  await page.keyboard.press('Delete');
  expect((await pins()).length === 0, 'Delete left the pin');
});

await check('probability is written on the shaded curve', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['normaldist(400, 50)', '']));
  await watchCanvasText(page);
  const row = page.locator('.rows .row').first();
  await row.locator('.cdf').check();
  await row.locator('.min').fill('350');
  await row.locator('.max').fill('500');
  await page.waitForTimeout(500);
  const written = (text) => page.evaluate((t) => window.canvasText.filter((c) => c.text === t), text);
  const label = await written('81.9%');
  expect(label.length > 0, `no 81.9% on the curve: ${JSON.stringify(await page.evaluate(() => window.canvasText.map((c) => c.text).slice(-20)))}`);
  const box = await page.locator('.graph-canvas').boundingBox();
  const v = await page.evaluate(() => window.slopculator.graph.view());
  const x = v.xmin + (label.at(-1).x / box.width) * (v.xmax - v.xmin);
  expect(x >= 350 && x <= 500, `the label sits at x = ${x}, outside the shading`);
  await page.evaluate(() => { window.canvasText.length = 0; });
  await row.locator('.cdf').uncheck();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.canvasText.map((c) => c.text));
  expect(after.length > 0 && !after.includes('81.9%'), `after unshading: ${JSON.stringify(after.slice(-20))}`);
});

await check('line letters label lines and resolve', async (page) => {
  await page.keyboard.press('Control+Alt+L');
  for (const t of ['328 - 400', 'A/50']) { await page.keyboard.type(t); await page.keyboard.press('Enter'); }
  await page.waitForTimeout(150);
  const l = await lines(page);
  expect(l[1].result === '-1.44' && l[1].letter === 'B', JSON.stringify(l));
});

await check('pasting several lines makes several lines', async (page) => {
  await page.evaluate(() => navigator.clipboard.writeText('μ = 400\nσ = 50\nzscore(350, μ, σ)'));
  await page.locator('.rows .expr').first().focus();
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForTimeout(250);
  const l = await lines(page);
  expect(l.length >= 3 && l[2].text === 'zscore(350, μ, σ)' && l[2].result === '-1', JSON.stringify(l));
});

await check('dragging (h, k) moves the slider values', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['h = 1', 'k = -2', 'y = (x - h)^2 + k', '(h, k)']));
  await page.waitForTimeout(700);
  const box = await page.locator('.graph-canvas').boundingBox();
  const scale = box.width / 20; // default view is −10…10 across
  const from = { x: box.x + box.width / 2 + 1 * scale, y: box.y + box.height / 2 + 2 * scale };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 2 * scale, from.y - 3 * scale, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const l = await lines(page);
  expect(Math.abs(Number(l[0].result) - 3) < 0.15 && Math.abs(Number(l[1].result) - 1) < 0.15, JSON.stringify(l.slice(0, 2)));
  await page.screenshot({ path: '.shots/e2e-drag.png' });
});

await check('brackets auto-close without doubling', async (page) => {
  await page.keyboard.type('normalcdf(-inf, -2.5, 0, 1)');
  await page.keyboard.press('Enter');
  await page.keyboard.type('det([[1,2],[3,4]])');
  await page.keyboard.press('Enter');
  await page.keyboard.type('sin(');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('x+1');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.type('(');
  await page.waitForTimeout(150);
  const l = await lines(page);
  expect(l[0].text === 'normalcdf(-inf, -2.5, 0, 1)' && l[1].text === 'det([[1,2],[3,4]])' && l[1].result === '-2', JSON.stringify(l.slice(0, 2)));
  expect(l[2].text === '(x+1)', `wrap: ${JSON.stringify(l[2])}`);
});

await check('# lines become headings, not errors', async (page) => {
  await page.keyboard.type('# Problem 3');
  await page.keyboard.press('Enter');
  await page.keyboard.type('zscore(350, 400, 50)');
  await page.waitForTimeout(150);
  const first = page.locator('.rows .row').first();
  expect(await first.evaluate((el) => el.classList.contains('heading-row')), 'no heading-row class');
  expect(!(await first.evaluate((el) => el.classList.contains('has-error'))), 'heading shows an error');
  const l = await lines(page);
  expect(l[1].result === '-1', JSON.stringify(l));
});

await check('Alt+Shift+↓ duplicates the line', async (page) => {
  await page.keyboard.type('nCr(8, 3)');
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await page.waitForTimeout(150);
  const l = await lines(page);
  expect(l.length >= 2 && l[0].text === l[1].text && l[1].result === '56', JSON.stringify(l));
});

await check('Shift+drag zooms into the box', async (page) => {
  await page.keyboard.type('y = x^2');
  await page.waitForTimeout(600);
  const box = await page.locator('.graph-canvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.keyboard.down('Shift');
  await page.mouse.move(cx - 100, cy - 100);
  await page.mouse.down();
  await page.mouse.move(cx + 100, cy + 100, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(400);
  const label = await page.evaluate(() => document.querySelector('.graph-host')?.getAttribute('aria-label') ?? '');
  const m = /x from ([^ ]+) to ([^ ]+)\. /.exec(label);
  const num = (s) => Number(s.replace('−', '-'));
  const span = m ? num(m[2]) - num(m[1]) : NaN;
  expect(span > 0 && span < 10, `x span after zoom: ${span} (${label})`);
});

await check('table Fit line adds y = ax + b', async (page) => {
  await page.click('.list-tools .add-table');
  const data = [['1', '3'], ['2', '5'], ['3', '7'], ['4', '9']];
  await page.fill('.tbl thead th:nth-child(2) input', 'y_1');
  for (let r = 0; r < data.length; r++) for (let c = 0; c < 2; c++) await page.fill(`.tbl input[data-r="${r}"][data-c="${c}"]`, data[r][c]);
  await page.waitForTimeout(200);
  const btn = page.locator('.fix', { hasText: 'Fit line' });
  expect(await btn.isVisible(), 'no Fit line button');
  await btn.click();
  await page.waitForTimeout(200);
  const l = await lines(page);
  expect(l.some((x) => /^y = 2x \+ 1$/.test(x.text)), JSON.stringify(l.map((x) => x.text)));
});

await check('rounding is one slider from Auto to 15 places', async (page) => {
  const places = () => page.evaluate(() => window.slopculator.settings().places);
  const stop = (n) => page.evaluate((v) => { const r = document.querySelector('.round-slider'); r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); }, n);
  expect((await page.textContent('.modebar .round-chip')) === 'Round: Auto', 'the Round chip');
  await page.click('.modebar .round-chip');
  expect(await page.isVisible('.round-pop .bar-round-slider'), 'the Round chip opens its slider');
  await page.keyboard.press('Escape');
  expect(await page.isHidden('.round-pop'), 'Esc closes the Round popover');
  await page.click('.modebar .desk-more');
  expect(await page.isVisible('.mode-menu .round-slider'), 'More should open the modes menu with the slider');
  await page.keyboard.press('Escape');
  expect((await places()) === null, 'starts on Auto');
  expect((await page.textContent('.round-out')) === 'Auto', 'label says Auto');
  await stop(1);
  expect((await places()) === 0, 'stop 1 is 0 places');
  await stop(4);
  expect((await places()) === 3, 'stop 4 is 3 places');
  expect((await page.textContent('.round-out')) === '3 dp', 'label says 3 dp');
  expect((await page.textContent('.modebar .round-chip')) === 'Round: 3 dp', 'the chip says 3 dp');
  const answer = await page.evaluate(() => window.slopculator.evaluate('1/3'));
  expect(JSON.stringify(answer).includes('0.333') && !JSON.stringify(answer.result ?? answer).includes('0.3333'), `1/3 at 3 places: ${JSON.stringify(answer)}`);
  await stop(16);
  expect((await places()) === 15, 'last stop is 15 places');
  await stop(0);
  expect((await places()) === null, 'first stop is Auto again');
  await page.click('.modebar .round-chip');
  await page.focus('.round-pop .round-slider');
  await page.keyboard.press('ArrowRight');
  expect((await places()) === 0, 'arrow keys move the slider');
  expect(await page.evaluate(() => document.activeElement.classList.contains('round-slider')), 'arrow keys keep focus on the slider');
});

await check('a change made right before closing is not lost', async (page) => {
  await page.keyboard.type('12345');
  await page.reload();
  await page.waitForTimeout(150);
  const got = await lines(page);
  expect(got.some((l) => l.text === '12345'), `lines after instant reload: ${JSON.stringify(got)}`);
});

await check('the page never scrolls or overflows at any window size', async (page) => {
  // Screenshots hide scrollbars, so measure. Check layout before the overflow guard could hide it.
  const measure = () => page.evaluate(() => {
    const bad = [];
    const app = document.querySelector('#app').getBoundingClientRect();
    for (const el of document.querySelectorAll('.modebar, .main, .keypad, .pad, .pad-main, .key-foot, .ti-page, .key-help, .help-btn')) {
      if (!el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > innerHeight + 0.5) bad.push(`${el.className} bottom ${r.bottom} > ${innerHeight}`);
      if (r.right > innerWidth + 0.5) bad.push(`${el.className} right ${r.right} > ${innerWidth}`);
    }
    const de = document.documentElement;
    const body = document.body;
    if (de.scrollHeight > innerHeight || body.scrollHeight > innerHeight) bad.push(`page height ${de.scrollHeight}/${body.scrollHeight} > ${innerHeight}`);
    if (de.scrollWidth > innerWidth || body.scrollWidth > innerWidth) bad.push(`page width ${de.scrollWidth}/${body.scrollWidth} > ${innerWidth}`);
    const bar = document.querySelector('.modebar');
    if (bar.scrollWidth > bar.clientWidth) bad.push(`top bar scrolls: ${bar.scrollWidth} > ${bar.clientWidth}`);
    if (app.height > innerHeight + 0.5) bad.push(`app height ${app.height}`);
    return bad;
  });
  const tabs = await page.$$eval('.ti-tab', (t) => t.length);
  for (const [w, h] of [[1920, 1080], [1536, 864], [1440, 900], [1366, 768], [1280, 720], [1181, 800], [1180, 800], [1100, 800], [1000, 800], [900, 800], [861, 800], [860, 800], [600, 800], [400, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(40);
    const bad = await measure();
    expect(bad.length === 0, `${w}x${h}: ${bad.join('; ')}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (let i = 0; i < tabs; i++) {
    await page.locator('.ti-tab').nth(i).click();
    await page.waitForTimeout(20);
    const bad = await measure();
    expect(bad.length === 0, `tab ${i}: ${bad.join('; ')}`);
  }
});

await check('a line keeps its height while typing, with errors and hints', async (page) => {
  const height = () => page.evaluate(() => document.querySelector('.row.active').getBoundingClientRect().height);
  await page.evaluate(() => window.slopculator.setSettings({ lineNames: true }));
  const start = await height();
  const heights = new Set([start]);
  for (const [text, shows] of [['B+C+D+E+F+G+H+I+J+K+L+M+N+O+P+Q+R+S+T+U+V+W+X+Y+Z+B+C+D+E+F+G', true], ['zscore(1, 2', false], ['normcdf(1)', true]]) {
    for (const ch of text) {
      await page.keyboard.type(ch);
      heights.add(await height());
    }
    await page.waitForTimeout(700);
    const paused = await page.evaluate(() => { const r = document.querySelector('.row.active'); return { h: r.getBoundingClientRect().height, error: (r.classList.contains('has-error') || !!r.querySelector('.calm-hint')) && !r.classList.contains('completing') }; });
    expect(paused.error === shows && (shows ? paused.h > start : paused.h === start), `${text} after a pause: ${JSON.stringify(paused)}, was ${start}`);
    for (let i = 0; i < text.length; i++) await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    heights.add(await height());
  }
  expect(heights.size === 1, `heights seen: ${[...heights].join(', ')}`);
});

await check('Tab fills a function argument by argument, then leaves it', async (page) => {
  const value = () => page.inputValue('.row.active .expr');
  await page.keyboard.type('bpd');
  await page.keyboard.press('Tab');
  expect((await value()) === 'binompdf()', `after completing: ${await value()}`);
  await page.keyboard.type('7');
  await page.waitForTimeout(50);
  expect((await page.textContent('.hint-line .sig b')) === 'n', `hint highlight: ${await page.textContent('.hint-line .sig')}`);
  await page.keyboard.press('Tab');
  await page.keyboard.type('0.56');
  await page.keyboard.press('Tab');
  await page.keyboard.type('5');
  await page.keyboard.press('Tab');
  await page.keyboard.type('*2');
  expect((await value()) === 'binompdf(7, 0.56, 5)*2', `typed: ${await value()}`);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => !document.querySelector('.row.active').classList.contains('has-error')), 'the line should evaluate');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !document.activeElement.classList.contains('expr')), 'Tab should leave the line');
});

await check('clicking a suggestion inserts it and includes the sheet\'s own names', async (page) => {
  await page.keyboard.type('total = 5');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  await page.keyboard.type('2*to');
  await page.waitForTimeout(50);
  const shown = await page.$$eval('.row.active .hint-line .cand', (els) => els.map((e) => e.textContent));
  expect(shown[0] === 'total', `suggestions: ${shown}`);
  await page.click('.row.active .hint-line .cand.first');
  expect((await page.inputValue('.row.active .expr')) === '2*total', `line: ${await page.inputValue('.row.active .expr')}`);
  expect(await page.evaluate(() => document.activeElement.classList.contains('expr')), 'focus should stay in the line');
});

await check('a bare comma list offers to wrap itself in braces', async (page) => {
  await page.keyboard.type('44, 24, 13');
  await page.waitForTimeout(750);
  await page.click('.row.active .fix');
  await page.waitForTimeout(100);
  expect((await page.inputValue('.row.active .expr')) === '{44, 24, 13}', `line: ${await page.inputValue('.row.active .expr')}`);
  expect(await page.evaluate(() => !document.querySelector('.row.active').classList.contains('has-error')), 'the list should evaluate');
});

await check('history keeps finished lines through Clear all and a restart', async (page) => {
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem(slopKeys.history) ?? '[]'));
  await page.keyboard.type('1/3');
  await page.keyboard.press('Enter');
  await page.keyboard.type('2+2');
  await page.keyboard.press('Enter');
  await page.keyboard.type('5+');
  await page.keyboard.press('Enter');
  await page.keyboard.type('42');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(50);
  let list = await stored();
  expect(list.map((e) => e.text).join('|') === '2+2|1/3', `recorded: ${list.map((e) => e.text).join('|')}`);
  expect(list[1].result.startsWith('0.333333'), `full precision: ${list[1].result}`);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(50);
  expect((await stored()).length === 2, `after arrows: ${(await stored()).length}`);
  await page.keyboard.press('Control+Alt+Backspace');
  await page.waitForTimeout(50);
  await page.reload();
  await page.waitForTimeout(150);
  list = await stored();
  expect(list.length === 2, `after clearing and reloading: ${list.length}`);
  await page.keyboard.press('Control+Alt+y');
  await page.waitForTimeout(80);
  expect((await page.$$('.history-open')).length === 2, 'the dialog should list both');
  await page.keyboard.type('1/3');
  await page.waitForTimeout(50);
  expect((await page.$$('.history-open')).length === 1, 'search should narrow it to one');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  const line = await page.inputValue('.row.active .expr');
  expect(line === '1/3', `inserted: ${line}`);
  expect(await page.evaluate(() => !document.querySelector('dialog[open]')), 'the dialog should close');
});

await check('damaged history is set aside, not overwritten', async (page) => {
  await page.evaluate(() => localStorage.setItem(slopKeys.history, '{broken'));
  await page.keyboard.type('2+2');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(50);
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('damaged')).map((k) => localStorage.getItem(k)));
  expect(keys.length === 1 && keys[0] === '{broken', `kept: ${keys}`);
  const list = await page.evaluate(() => JSON.parse(localStorage.getItem(slopKeys.history)));
  expect(list[0].text === '2+2', `new history: ${JSON.stringify(list)}`);
});

await check('clicking the error selects where the problem is', async (page) => {
  await page.keyboard.type('2 + qq + 1');
  await page.waitForTimeout(750);
  const err = page.locator('.row.active .err.marked');
  expect(await err.isVisible(), 'the active line shows its error');
  await err.click();
  const picked = await page.evaluate(() => { const i = document.activeElement; return i.value.slice(i.selectionStart, i.selectionEnd); });
  expect(picked === 'qq', `selected in the line: ${picked}`);
});

await check('a warning shows on a valid line, with a fix', async (page) => {
  await page.keyboard.type('-3^2');
  await page.waitForTimeout(750);
  expect((await page.textContent('.row.active .warn-line .warn-text')).includes('power goes first'), 'should explain');
  expect(await page.isVisible('.row.active .warn-line'), 'the warning shows under the line');
  expect((await page.textContent('.row.active .result')).includes('9'), 'the answer stays visible');
  expect(!!(await page.$('.row.active .warn-dot')), 'the line should carry a marker');
  await page.click('.row.active .warn-line .warn-text');
  const picked = await page.evaluate(() => { const i = document.activeElement; return i.value.slice(i.selectionStart, i.selectionEnd); });
  expect(picked === '-3', `selected in the line: ${picked}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  expect(await page.isHidden('.row:first-child .warn-line'), 'a line you left shows only its marker');
  await page.locator('.rows .expr').first().click();
  await page.waitForTimeout(100);
  await page.click('.row.active .warn-line .fix');
  await page.waitForTimeout(100);
  expect((await page.inputValue('.row.active .expr')) === '(-3)^2', `fixed line: ${await page.inputValue('.row.active .expr')}`);
  expect(await page.isHidden('.row.active .warn-line'), 'the warning should go away');
  expect(!(await page.$('.row.active .warn-dot')), 'the marker should go away');
  expect((await page.textContent('.row.active .result .val')).trim() === '9', `answer: ${await page.textContent('.row.active .result')}`);
});

await check('desktop: the Thumb Index\'s two rows over the pad, six columns across the column, every row of keys 42 px or more, AC at the pad\'s corner', async (page) => {
  const g = await page.evaluate(() => {
    const r = (e) => { const x = e.getBoundingClientRect(); return { l: x.left, r: x.right, t: x.top, b: x.bottom, w: x.width, h: x.height }; };
    return {
      rows: [...document.querySelectorAll('.ti-row')].map((row) => [...row.querySelectorAll('.key')].map((k) => ({ ...r(k), label: k.getAttribute('aria-label').split(':')[0] }))),
      pad: [...document.querySelectorAll('.numpad .krow')].map((row) => [...row.querySelectorAll('.key')].map(r)),
      ac: r(document.querySelector('.key.desk-ac')), acText: document.querySelector('.key.desk-ac .kl').textContent.trim(),
      col: r(document.querySelector('.keypad')),
    };
  });
  expect(g.rows.length === 2 && g.rows.every((r) => r.length === 6) && g.pad.length === 4 && g.pad.every((r) => r.length === 6), `rows: ${g.rows.map((r) => r.length)} over ${g.pad.map((r) => r.length)}`);
  expect(g.rows[0].map((k) => k.label).join(' ') === 'x y π e % ans', `row 1: ${g.rows[0].map((k) => k.label)}`);
  expect(g.rows[1].map((k) => k.label).join(' ') === 'Math Stats Chance Matrix HVAC ÷', `row 2: ${g.rows[1].map((k) => k.label)}`);
  const all = [...g.rows, ...g.pad];
  const hs = all.map((r) => r[0].h);
  expect(Math.max(...hs) - Math.min(...hs) < 1 && Math.min(...hs) >= 42, `row heights: ${hs}`);
  for (const row of all) row.forEach((k, i) => expect(Math.abs(k.l - g.pad[0][i].l) < 0.6 && Math.abs(k.w - g.pad[0][i].w) < 0.6, `a key off pad column ${i + 1}: ${JSON.stringify(k)}`));
  expect(g.pad[0][0].w > 64 && g.pad[0][0].l - g.col.l < 20 && g.col.r - g.pad[0][5].r < 20, `the keys don't fill the column: ${JSON.stringify(g.pad[0].map((k) => Math.round(k.w)))}`);
  expect(g.acText === 'AC' && Math.abs(g.ac.l - g.pad[3][0].l) < 0.6 && Math.abs(g.ac.w - g.pad[3][0].w) < 1 && g.ac.t >= g.pad[3][0].b, `AC: ${JSON.stringify(g.ac)}`);
});

await check('desktop at 1366 × 768: the keys stay 42 px tall, the line being typed shows whole with its bar', async (page) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => window.slopculator.setLines(['y = x^2/4 - 3', '12*3', '7+5', 'normalcdf(-1, 1, 0, 1)', 'r = 2', '']));
  await page.waitForTimeout(300);
  await page.locator('.rows .row').last().locator('.expr').click();
  await page.waitForTimeout(200);
  const g = await page.evaluate(() => {
    const rows = document.querySelector('.rows'), rr = rows.getBoundingClientRect();
    const lines = [...rows.querySelectorAll('.row')].map((e) => e.getBoundingClientRect());
    const active = document.querySelector('.row:focus-within');
    return { pad: Math.round(document.querySelector('.pad').getBoundingClientRect().height), key: Math.round(document.querySelector('.numpad .key').getBoundingClientRect().height), lines: lines.length, whole: lines.filter((b) => b.top >= rr.top - 1 && b.bottom <= rr.bottom + 1).length,
      bar: getComputedStyle(active).boxShadow, left: Math.round(active.getBoundingClientRect().left - rr.left), activeWhole: active.getBoundingClientRect().top >= rr.top - 1 && active.getBoundingClientRect().bottom <= rr.bottom + 1 };
  });
  expect(g.pad === 282 && g.key >= 42, `the keys keep 42 px on a short window: ${JSON.stringify(g)}`);
  expect(g.lines === 6 && g.whole >= 5 && g.activeWhole, `${g.whole} of ${g.lines} lines whole: ${JSON.stringify(g)}`);
  expect(/3px 0px 0px 0px inset|inset 3px 0px 0px/.test(g.bar) && g.left === 0, `the active line's bar, edge to edge: ${JSON.stringify(g)}`);
});

await check('desktop: a tab\'s page sits on the keys inside the notebook, one size on every tab and page, never scrolls, no key moves, and the line being typed stays in view', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['12*3', '7+5', '']));
  await page.locator('.rows .row').last().locator('.expr').click();
  await page.waitForTimeout(150);
  const linesAt = () => page.evaluate(() => JSON.stringify({ top: document.querySelector('.rows').scrollTop, pad: document.querySelector('.rows').style.paddingTop, rows: [...document.querySelectorAll('.rows .row')].map((r) => { const b = r.getBoundingClientRect(); return [Math.round(b.top * 2) / 2, Math.round(b.height * 2) / 2]; }) }));
  const linesBefore = await linesAt();
  const keys = () => page.$$eval('.keys .key, .key.desk-ac', (ks) => ks.map((k) => { const r = k.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}`; }).join(' '));
  const before = await keys();
  const measure = () => page.evaluate(() => {
    const pg = document.querySelector('.ti-page'), p = pg.getBoundingClientRect(), k = document.querySelector('.keypad').getBoundingClientRect(), gr = document.querySelector('.graph-pane').getBoundingClientRect();
    const tiles = [...document.querySelectorAll('.ti-tile')];
    const list = document.querySelector('.rows');
    return { size: `${Math.round(p.width)}x${Math.round(p.height)}`, bottom: p.bottom, right: p.right, kTop: k.top, gLeft: gr.left, foot: list.getBoundingClientRect().top + list.clientTop + list.clientHeight, cols: getComputedStyle(document.querySelector('.ti-grid')).gridTemplateColumns.split(' ').length,
      scrolls: pg.scrollHeight > pg.clientHeight + 1, cut: tiles.some((t) => t.getBoundingClientRect().bottom > p.bottom + 0.5),
      face: Math.max(...tiles.map((t) => parseFloat(getComputedStyle(t.querySelector('.ti-face')).fontSize))), name: Math.max(...tiles.map((t) => parseFloat(getComputedStyle(t.querySelector('.ti-name')).fontSize))),
      clipped: tiles.flatMap((t) => [t.querySelector('.ti-face'), t.querySelector('.ti-name')]).filter((k) => k.scrollWidth > k.clientWidth + 1).map((k) => k.textContent),
      ring: getComputedStyle(pg).borderColor };
  });
  const sizes = new Set();
  for (let i = 0; i < 5; i++) {
    await page.locator('.ti-tab').nth(i).click();
    // Past the tab's press, which scales it for a moment.
    await page.waitForTimeout(400);
    const segs = await page.locator('.ti-seg').count();
    for (let j = 0; j < Math.max(1, segs); j++) {
      if (segs) await page.locator('.ti-seg').nth(j).click();
      await page.waitForTimeout(60);
      const g = await measure();
      sizes.add(g.size);
      expect(g.bottom <= g.kTop + 0.5 && g.right <= g.gLeft + 0.5, `tab ${i} page ${j} covers the keys or the graph: ${JSON.stringify(g)}`);
      expect(Math.abs(g.bottom - g.foot) <= 1, `tab ${i} page ${j}: the page's foot isn't the list's: ${JSON.stringify(g)}`);
      const clear = await page.evaluate(() => document.querySelector('.rows .row:last-child').getBoundingClientRect().bottom <= document.querySelector('.ti-page').getBoundingClientRect().top + 1);
      expect(clear, `tab ${i} page ${j}: the line being typed is under the page: ${await linesAt()}`);
      expect(g.cols === 4 && !g.scrolls && !g.cut && !g.clipped.length, `tab ${i} page ${j}: ${JSON.stringify(g)}`);
      expect(g.face >= 15 && g.face <= 17 && g.name >= 11 && g.name <= 12, `tile type, tab ${i} page ${j}: ${JSON.stringify(g)}`);
      expect((await keys()) === before, `tab ${i} page ${j}: a key moved`);
    }
  }
  expect(sizes.size === 1, `the page changed size: ${[...sizes]}`);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(300);
  const wide = await measure();
  expect(wide.cols === 4 && !wide.scrolls && !wide.cut, `at 1920: ${JSON.stringify(wide)}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  await page.locator('.ti-close').click();
  await page.waitForTimeout(200);
  expect(await page.isHidden('.ti-page'), '✕ closes the page');
  expect((await linesAt()) === linesBefore, `the lines did not come back when the page closed: ${linesBefore} → ${await linesAt()}`);
  await page.evaluate(() => [...document.querySelectorAll('.ti-row .key')].find((k) => k.getAttribute('aria-label').startsWith('ans')).click());
  expect((await page.inputValue('.row.active .expr')) === 'ans', `ans typed ${await page.inputValue('.row.active .expr')}`);
});

await check('the number pad stays while tabs open, and the keys type y = 2x + 1', async (page) => {
  const pad = () => page.$$eval('.numpad .key', (ks) => ks.map((k) => { const r = k.getBoundingClientRect(); return `${k.textContent}@${Math.round(r.left)},${Math.round(r.top)}`; }).join(' '));
  const before = await pad();
  for (const name of ['Math', 'Stats', 'HVAC']) {
    await page.locator(`.ti-tab[aria-label="${name}"]`).click();
    await page.waitForTimeout(60);
    expect((await pad()) === before, `${name}: the pad moved or changed`);
  }
  for (const l of ['y', '=', '2', 'x', '+', '1']) {
    await page.evaluate((l) => [...document.querySelectorAll('.keys .key')].find((k) => k.getAttribute('aria-label').split(':')[0] === l).click(), l);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(100);
  expect((await page.inputValue('.row.active .expr')).replace(/\s/g, '') === 'y=2x+1', `typed ${await page.inputValue('.row.active .expr')}`);
  expect(await page.isHidden('.ti-page'), 'the page stayed open under a key');
});

await check('desktop: Ctrl+Alt+1–5 open the tabs on their first tile; arrows walk the tiles, Ctrl+Alt+← → turn the pages, Enter inserts and goes back to the line, Esc closes', async (page) => {
  await page.locator('.rows .expr').first().click();
  // The pointer off the notebook, so the page opening under it doesn't set the hint.
  await page.mouse.move(900, 400);
  const at = () => page.evaluate(() => ({ open: !document.querySelector('.ti-page').hidden, tab: document.querySelector('.ti-tab.lit')?.getAttribute('aria-label') ?? null, page: document.querySelector('.ti-seg[aria-selected=true]')?.textContent ?? null,
    tile: document.activeElement?.classList.contains('ti-tile') ? document.activeElement.querySelector('.ti-name').textContent : null, line: !!document.activeElement?.classList.contains('expr'), hint: document.querySelector('.key-hint').textContent }));
  await page.keyboard.press('Control+Alt+1');
  await page.waitForTimeout(200);
  let s = await at();
  expect(s.open && s.tab === 'Math' && s.page === 'Basic' && s.tile === 'sin', `Ctrl+Alt+1: ${JSON.stringify(s)}`);
  expect(s.hint.includes('sin'), `the hint says what the tile does: ${s.hint}`);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  s = await at();
  expect(s.tile === 'acos', `→ then ↓: ${JSON.stringify(s)}`);
  await page.keyboard.press('Control+Alt+ArrowRight');
  await page.waitForTimeout(150);
  s = await at();
  expect(s.page === 'Trig' && s.tile === 'csc', `Ctrl+Alt+→: ${JSON.stringify(s)}`);
  await page.keyboard.press('Control+Alt+ArrowLeft');
  await page.waitForTimeout(150);
  s = await at();
  expect(s.page === 'Basic' && s.tile === 'sin', `Ctrl+Alt+←: ${JSON.stringify(s)}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  s = await at();
  expect(!s.open && s.line && (await page.inputValue('.row.active .expr')).startsWith('sin('), `Enter: ${JSON.stringify(s)} ${await page.inputValue('.row.active .expr')}`);
  await page.keyboard.press('Control+Alt+5');
  await page.waitForTimeout(200);
  s = await at();
  expect(s.open && s.tab === 'HVAC' && s.page === 'Refrig' && s.tile === 'superheat', `Ctrl+Alt+5: ${JSON.stringify(s)}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  s = await at();
  expect(!s.open && s.line, `Esc: ${JSON.stringify(s)}`);
  await page.keyboard.press('Control+Alt+2');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+Alt+2');
  await page.waitForTimeout(150);
  expect(!(await at()).open, 'Ctrl+Alt+2 twice left the page open');
});

await check('the number pad sits on the right, and can switch sides', async (page) => {
  const firstRow = () => page.$$eval('.numpad .krow:first-child .key', (els) => els.map((e) => e.getAttribute('aria-label').split(':')[0]).join(' '));
  expect((await firstRow()) === '← → 7 8 9 ×', `right: ${await firstRow()}`);
  const box = await page.evaluate(() => document.querySelector('.pad').getBoundingClientRect().height);
  await page.keyboard.press('Control+/');
  await page.keyboard.type('switch number pad');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  expect((await firstRow()) === '× 7 8 9 ← →', `left: ${await firstRow()}`);
  const after = await page.evaluate(() => document.querySelector('.pad').getBoundingClientRect().height);
  expect(after === box, `pad height ${box} became ${after}`);
  await page.waitForTimeout(350);
  await page.reload();
  await page.waitForTimeout(150);
  expect((await firstRow()) === '× 7 8 9 ← →', `after reload: ${await firstRow()}`);
  await page.click('.keys .key:has-text("7")');
  await page.click('.keys .key:has-text("×")');
  await page.click('.keys .key:has-text("6")');
  await page.waitForTimeout(100);
  expect((await page.textContent('.row.active .result .val')).trim() === '42', `7 * 6: ${await page.textContent('.row.active .result')}`);
});

await check('the active line shows its whole error under the expression', async (page) => {
  const width = () => page.evaluate(() => document.querySelector('.row.active .expr').getBoundingClientRect().width);
  const before = await width();
  await page.keyboard.type('nCr(7,5)*0.56)');
  const during = await page.evaluate(() => { const e = document.querySelector('.row.active .err'); return !!e && e.getBoundingClientRect().width > 0; });
  expect(!during, 'no error while typing');
  await page.waitForTimeout(750);
  const row = await page.evaluate(() => {
    const expr = document.querySelector('.row.active .expr').getBoundingClientRect();
    const err = document.querySelector('.row.active .err');
    const box = err?.getBoundingClientRect();
    return { hasError: document.querySelector('.row.active').classList.contains('has-error'), shown: !!box && box.width > 0, below: !!box && box.top >= expr.bottom - 1, cut: !!err && err.scrollWidth > err.clientWidth + 1 };
  });
  expect(row.hasError && row.shown && row.below && !row.cut, `active row: ${JSON.stringify(row)}`);
  const after = await width();
  expect(after >= before, `expression width ${before} became ${after}`);
  const clipped = await page.evaluate(() => {
    const expr = document.querySelector('.row.active .expr');
    return expr.scrollWidth > expr.clientWidth;
  });
  expect(!clipped, 'the expression should fit beside nothing');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  const left = await page.evaluate(() => {
    const row = document.querySelector('.row.has-error:not(.active)');
    const err = row?.querySelector('.err');
    if (!err) return null;
    const box = err.getBoundingClientRect(), expr = row.querySelector('.expr').getBoundingClientRect();
    const cs = getComputedStyle(err);
    return { below: box.top >= expr.bottom - 1, left: Math.abs(box.left - expr.left) < 2, wraps: cs.whiteSpace !== 'nowrap', lines: Math.round(box.height / parseFloat(cs.lineHeight)) };
  });
  expect(left && left.below && left.left && left.wraps && left.lines <= 2, `a line you left should show its error under it: ${JSON.stringify(left)}`);
});

await check('lines you are not editing read as typeset math, and open as their source', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['price = 24.99', 'y = x^2/4 - 3', '2+3', 'normcdf(1', '{x < 0: -x, x}', '']));
  await page.waitForTimeout(200);
  await page.locator('.rows .expr').last().click();
  await page.waitForTimeout(100);
  const read = () => page.evaluate(() => [...document.querySelectorAll('.rows .row')].map((r) => ({
    typeset: r.classList.contains('typeset') && !r.classList.contains('active') && getComputedStyle(r.querySelector('.tex')).display !== 'none',
    frac: !!r.querySelector('.tex .m-frac'), exp: !!r.querySelector('.tex .m-exp'), cases: !!r.querySelector('.tex .m-cases'),
    result: r.querySelector('.result')?.textContent ?? null,
    height: r.getBoundingClientRect().height,
  })));
  const l = await read();
  expect(l[0].typeset && l[1].typeset && l[2].typeset && l[4].typeset, `typeset rows: ${JSON.stringify(l)}`);
  expect(!l[3].typeset, 'a line with an error shows its source');
  expect(l[1].frac && l[1].exp && l[4].cases, `fraction, exponent and cases: ${JSON.stringify(l[1])} ${JSON.stringify(l[4])}`);
  expect(l[0].result === null, `price = 24.99 shows no answer: ${l[0].result}`);
  expect(l[2].result === '5', `answers have no "=": ${l[2].result}`);
  const beside = await page.evaluate(() => {
    const r = document.querySelectorAll('.rows .row')[2];
    const a = r.querySelector('.tex').getBoundingClientRect(), b = r.querySelector('.result').getBoundingClientRect();
    return Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 8 && b.left > a.right;
  });
  expect(beside, 'the answer sits beside its expression');
  const box = await page.locator('.rows .row').nth(2).locator('.tex .m-run').first().boundingBox();
  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
  await page.waitForTimeout(100);
  const open = await page.evaluate(() => {
    const i = document.activeElement;
    return { value: i.value, caret: i.selectionStart, active: i.closest('.row').classList.contains('active'), visible: getComputedStyle(i).opacity === '1' };
  });
  expect(open.value === '2+3' && open.caret === 1 && open.active && open.visible, `opened: ${JSON.stringify(open)}`);
  const after = await read();
  expect(Math.abs(after[2].height - l[2].height) < 1, `a plain line changed height on opening: ${l[2].height} → ${after[2].height}`);
  expect(after[1].typeset && !after[2].typeset, 'only the line being edited shows its source');
  await page.keyboard.press('ArrowDown');
  expect((await page.evaluate(() => document.activeElement.value)) === 'normcdf(1', 'arrow keys move between lines');
  await page.selectOption('select.look', 'retro', { force: true });
  await page.waitForTimeout(200);
  const retro = await read();
  expect(retro[1].typeset && !retro[1].frac && retro[1].exp, `Retro: ${JSON.stringify(retro[1])}`);
});

await check('All + combines lines, leaving empty ones out with a note', async (page) => {
  await page.evaluate(() => window.slopculator.setSettings({ lineNames: true }));
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  await page.click(".combine button[aria-label='Add all lines']");
  await page.waitForTimeout(200);
  const got = await lines(page);
  const last = got[got.length - 1];
  expect(last.text === 'A + C', `text: ${JSON.stringify(got)}`);
  expect(last.value === 15, `value: ${JSON.stringify(last)}`);
  const note = await page.textContent('.row.active .note');
  expect(note === 'Left out empty line B.', `note: ${note}`);
  await page.keyboard.type(' ');
  await page.waitForTimeout(100);
  expect((await page.$$('.row.active .note')).length === 0, 'the note goes once the line is edited');
});

await check('an empty argument shows its signature, not an error, until the line is left', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['']));
  const input = page.locator('.rows .expr').first();
  await input.focus();
  await page.keyboard.type('nCr(7, ');
  await page.waitForTimeout(800);
  expect((await page.textContent('.row.active .hint-line .sig b')) === 'r', 'the hint should name r');
  const shown = () => page.evaluate(() => { const e = document.querySelector('.row.active .err'); return !!e && e.getBoundingClientRect().width > 0; });
  expect(!(await shown()), 'no error while the argument is empty');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(100);
  expect(!(await shown()), 'red while the line is still being typed');
  await page.locator('.sheet-title').focus();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => { const e = document.querySelector('.rows .row .out .err'); return !!e && e.getBoundingClientRect().width > 0; }), 'the error shows once the line is left');
});

await check('Ctrl+Alt+E shows the line\'s exact answer', async (page) => {
  await page.keyboard.type('1/3');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+Alt+e');
  await page.waitForTimeout(150);
  expect((await page.textContent('.row.active .result .val')) === '1/3', `exact answer on the line: ${await page.textContent('.row.active .result')}`);
});

await check('desktop: the modes are in the top bar across the window, in three groups, and Modes holds the rest under it', async (page) => {
  const bar = await page.locator('.modebar').boundingBox(), graph = await page.locator('.graph-pane').boundingBox();
  expect(bar.x < 2 && bar.width > 1430 && graph.y >= bar.y + bar.height - 1, `the bar does not span the window over the graph: ${JSON.stringify(bar)}`);
  for (const t of ['Deg', 'Rad', 'Dec', 'Exact', 'Pop', 'Sample', 'Percent', 'Line letters', 'Complex numbers']) expect(await page.locator('.desk-modes button', { hasText: new RegExp(`^${t.replace('+', '\\+')}$`) }).isVisible(), `${t} is not in the bar`);
  await page.locator('.desk-modes button', { hasText: /^Exact$/ }).click();
  expect((await page.evaluate(() => window.slopculator.settings().exact)) === true, 'Exact did not switch');
  await page.locator('.desk-modes button', { hasText: /^Dec$/ }).click();
  const more = page.locator('.modebar .desk-more');
  await more.click();
  expect(await page.isVisible('.mode-menu') && (await more.getAttribute('aria-expanded')) === 'true', 'More did not open the modes');
  const [p, m] = await page.evaluate(() => [document.querySelector('.desk-more'), document.querySelector('.mode-menu')].map((el) => el.getBoundingClientRect().toJSON()));
  expect(m.top >= p.bottom && m.top - p.bottom < 12, `the menu hangs under More: ${p.bottom}, ${m.top}`);
  const menu = await page.textContent('.mode-menu');
  expect(['Huge answers', '80 + 15% =', 'Rounding'].every((w) => menu.includes(w)), `Modes: ${menu}`);
  expect(await page.isHidden('.mode-menu .mode-row[data-bar="angle"]') && await page.isHidden('.mode-menu .mode-row[data-bar="sd"]'), 'Modes repeats what the bar shows');
  const look = await page.evaluate(() => {
    const r = (q) => document.querySelector(q).getBoundingClientRect();
    const sd = r('.desk-modes .seg:nth-of-type(3)'), pct = [...document.querySelectorAll('.desk-modes .tog')][0].getBoundingClientRect();
    const on = getComputedStyle(document.querySelector('.desk-modes .seg button[aria-pressed=true]')), off = getComputedStyle(document.querySelector('.desk-modes .seg button[aria-pressed=false]'));
    return { gap: pct.left - sd.right, h: [r('.desk-modes .seg').height, pct.height, r('.modebar .menu-btn').height, r('.modebar .head-find').height], on: [on.backgroundColor, on.fontWeight], off: [off.backgroundColor, off.fontWeight] };
  });
  expect(look.gap >= 12 && look.gap <= 16 && look.h.every((x) => x >= 30 && x <= 32) && look.on[0] !== look.off[0] && look.on[1] !== look.off[1], `the bar: ${JSON.stringify(look)}`);
  await page.keyboard.press('Escape');
  expect(await page.isHidden('.mode-menu'), 'Escape closes it');
  await page.locator('.sheet-title').focus();
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => document.activeElement.textContent === 'Deg'), 'an arrow from the title lands on Deg');
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => ({ fits: document.querySelector('.modebar').scrollWidth <= document.querySelector('.modebar').clientWidth + 1, h: document.querySelector('.modebar').getBoundingClientRect().height, folded: [...document.querySelectorAll('.desk-modes > .bar-mode[hidden]')].map((e) => e.dataset.fold).sort() }));
  expect(fit.fits && fit.h < 60 && fit.folded.length > 0 && fit.folded.every((f, i) => Number(f) === i + 1), `folding: ${JSON.stringify(fit)}`);
});

await check('Ctrl+Alt+C copies the answer on the line', async (page) => {
  await page.keyboard.type('6*7');
  await page.keyboard.press('Enter');
  await page.keyboard.type('2+2');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+Alt+c');
  await page.waitForTimeout(150);
  expect((await page.evaluate(() => navigator.clipboard.readText())) === '4', 'copied the active line');
  expect((await page.textContent('.toast')).includes('Copied 4'), `toast: ${await page.textContent('.toast')}`);
  expect(await page.$('.row.active .result.copied'), 'the result flashes');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  await page.locator('.rows .expr').first().click();
  await page.keyboard.press('Control+Alt+c');
  await page.waitForTimeout(150);
  expect((await page.evaluate(() => navigator.clipboard.readText())) === '42', 'copied line 1');
  await page.locator('.rows .expr').last().click();
  await page.keyboard.press('Control+Alt+c');
  await page.waitForTimeout(150);
  expect((await page.evaluate(() => navigator.clipboard.readText())) === '4', 'an empty line copies the last answer');
});

const openMatrixGrid = async (page) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('new matrix');
  await page.waitForTimeout(150);
  await page.locator('.pal-item', { hasText: 'New matrix…' }).first().click();
  await page.waitForSelector('dialog.mx[open]');
};
const activeLine = (page) => page.inputValue('.row.active .expr');

await check('Enter in the matrix grid inserts the matrix', async (page) => {
  await openMatrixGrid(page);
  await page.keyboard.type('1');
  for (const n of ['2', '3', '4']) {
    await page.keyboard.press('Tab');
    await page.keyboard.type(n);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  expect(!(await page.$('dialog.mx')), 'the dialog should close');
  expect((await activeLine(page)) === 'A = [[1, 2], [3, 4]]', `line: ${await activeLine(page)}`);
});

await check('Cancel and Esc leave the matrix out', async (page) => {
  await openMatrixGrid(page);
  await page.keyboard.type('5');
  await page.click('dialog.mx button:has-text("Cancel")');
  await page.waitForTimeout(50);
  expect(!(await page.$('dialog.mx')), 'Cancel should close the dialog');
  expect((await activeLine(page)) === '', `after Cancel: ${await activeLine(page)}`);
  await openMatrixGrid(page);
  await page.keyboard.type('5');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  expect(!(await page.$('dialog.mx')), 'Esc should close the dialog');
  expect((await activeLine(page)) === '', `after Esc: ${await activeLine(page)}`);
});

await check('A second grid matrix gets a free name, and a taken name is refused', async (page) => {
  await page.keyboard.type('A = [[1, 2], [3, 4]]');
  await page.keyboard.press('Enter');
  await openMatrixGrid(page);
  expect((await page.inputValue('.mx-name')) === 'B', 'the name should start on B');
  await page.fill('.mx-name', 'A');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(60);
  expect(!!(await page.$('dialog.mx[open]')), 'a taken name should keep the dialog open');
  await page.fill('.mx-name', 'B');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  const errs = await page.locator('.rows .err').count();
  expect(errs === 0, 'errors on the sheet: ' + errs);
});

await check('The arrows walk the matrix grid', async (page) => {
  await openMatrixGrid(page);
  const at = () => page.evaluate(() => document.activeElement.getAttribute('aria-label'));
  await page.keyboard.press('ArrowRight');
  expect((await at()) === 'Row 1, column 2', 'right: ' + (await at()));
  await page.keyboard.press('ArrowDown');
  expect((await at()) === 'Row 2, column 2', 'down: ' + (await at()));
  await page.keyboard.type('12');
  await page.keyboard.press('ArrowLeft');
  expect((await at()) === 'Row 2, column 2', 'left stays while the caret can move: ' + (await at()));
});

await check('Filling a matrix on the line: Enter walks the empty cells, then commits', async (page) => {
  await page.fill('.row.active .expr', '[[, ], [, ]]');
  await page.evaluate(() => document.querySelector('.row.active .expr').setSelectionRange(2, 2));
  for (const n of ['1', '2', '3']) {
    await page.keyboard.type(n);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(30);
    expect((await page.locator('.rows .row').count()) === 1, 'Enter after ' + n + ' should stay on the line');
  }
  await page.keyboard.type('4');
  expect((await activeLine(page)) === '[[1, 2], [3, 4]]', 'line: ' + (await activeLine(page)));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(60);
  expect((await page.locator('.rows .row').count()) === 2, 'the filled matrix should commit');
});

await check('A wide matrix answer stays inside its line', async (page) => {
  await page.keyboard.type('B = [[1, 0, 2], [0, 1, 3], [4, 5, 6]]');
  await page.keyboard.press('Enter');
  await page.keyboard.type('inv(B)');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const fit = await page.evaluate(() => {
    const w = document.querySelectorAll('.result .mat-wrap');
    const last = w[w.length - 1];
    const r = last.getBoundingClientRect(), list = document.querySelector('.rows').getBoundingClientRect();
    const box = last.querySelector('.mat-scroll');
    return { right: r.right, edge: list.right, scrolls: box.scrollWidth > box.clientWidth + 1 };
  });
  expect(fit.right <= fit.edge + 0.5, 'matrix runs past the list: ' + JSON.stringify(fit));
  expect(!fit.scrolls, 'a 3 × 3 inverse should fit without scrolling: ' + JSON.stringify(fit));
});

await check('Clicking a typeset matrix edits its line', async (page) => {
  await page.keyboard.type('A = [[1, 2], [3, 4]]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  const box = await page.locator('.rows .row').first().locator('.tex .mat-wrap').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(100);
  expect((await activeLine(page)) === 'A = [[1, 2], [3, 4]]', 'the click should land on line 1');
  expect(await page.evaluate(() => document.activeElement.classList.contains('expr')), 'the line should have focus');
  await page.locator('.rows .row').last().locator('.expr').focus();
  await page.waitForTimeout(80);
  const cell = await page.locator('.rows .row').first().locator('.tex .mat td').nth(2).boundingBox();
  await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2);
  await page.waitForTimeout(100);
  const caret = await page.evaluate(() => document.activeElement.selectionStart);
  expect(caret === 14 || caret === 15, 'the caret should land at the 3, got ' + caret);
});

await check('opening or importing a sheet keeps the keypad up with its two rows, and an old file\'s bank is no trouble', async (page) => {
  await page.keyboard.press('Control+Alt+s');
  await page.waitForSelector('dialog.sheet-dialog[open]');
  await page.keyboard.type('Mine');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+Alt+Shift+n');
  await page.waitForTimeout(150);
  for (let n = 0; n < 2; n++) { await page.reload(); await page.waitForTimeout(250); }
  const keys = () => page.evaluate(() => ({ rows: document.querySelectorAll('.ti-row').length, pad: document.querySelectorAll('.numpad .krow').length, up: !!document.querySelector('.keys')?.offsetParent }));
  expect(JSON.stringify(await keys()) === '{"rows":2,"pad":4,"up":true}', `after reloads: ${JSON.stringify(await keys())}`);
  await page.click('.menu-btn');
  await page.locator('.menu button', { hasText: 'Open "Mine"' }).click();
  await page.waitForTimeout(300);
  expect(JSON.stringify(await keys()) === '{"rows":2,"pad":4,"up":true}', `after opening: ${JSON.stringify(await keys())}`);
  await page.click('.menu-btn');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.menu button', { hasText: 'Import' }).click()]);
  await chooser.setFiles({ name: 'calc.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ rows: [{ id: 'a', kind: 'expr', text: '1+1' }], ui: { bank: 'Calc', panel: 0 } })) });
  await page.waitForTimeout(400);
  expect(JSON.stringify(await keys()) === '{"rows":2,"pad":4,"up":true}', `after importing: ${JSON.stringify(await keys())}`);
  expect((await lines(page))[0].text === '1+1', 'the file did not open');
});

await check('Modern is the default, and Retro switches and persists', async (page) => {
  const look = () => page.evaluate(() => document.documentElement.dataset.look);
  const font = () => page.evaluate(() => getComputedStyle(document.querySelector('.modebar .desk-modes .seg button')).fontFamily);
  expect((await look()) === 'modern', 'starts Modern');
  expect((await font()).includes('Geist'), await font());
  await page.click('.appear-btn');
  await page.selectOption('select.look', 'retro');
  await page.waitForTimeout(400);
  expect((await look()) === 'retro', 'switched');
  expect((await font()).includes('Plex Mono'), await font());
  await page.reload();
  await page.waitForTimeout(200);
  expect((await look()) === 'retro', 'kept after a reload');
});

await check('zoom buttons glide, and land where a jump would', async (page) => {
  const span = async () => {
    const m = /x from (-?\d+(?:\.\d+)?) to (-?\d+(?:\.\d+)?)/.exec(await page.getAttribute('[aria-roledescription="graph"]', 'aria-label'));
    return [Number(m[1]), Number(m[2])];
  };
  await page.keyboard.type('y = x');
  await page.waitForTimeout(500);
  const [a, b] = await span();
  await freezeClock(page);
  await page.click('.graph-tools button[title="Zoom in"]');
  await page.clock.runFor(40);
  const mid = await page.evaluate(() => document.querySelector('[aria-roledescription="graph"]').getAttribute('aria-label'));
  await page.clock.runFor(500);
  await page.clock.resume();
  const [c, d] = await span();
  expect(Math.abs((d - c) - (b - a) / 1.4) < 0.01, `one zoom: ${a}..${b} to ${c}..${d}`);
  expect(mid.includes(`x from ${a}`), 'the label waits for the glide to finish');
  for (let k = 0; k < 3; k++) await page.click('.graph-tools button[title="Zoom out"]');
  await page.waitForTimeout(600);
  const [e, f] = await span();
  expect(Math.abs((f - e) - (d - c) * 1.4 ** 3) < 0.01, `three zooms: ${c}..${d} to ${e}..${f}`);
}, false, { clock: true });

await check('copying flashes what was copied', async (page) => {
  await page.keyboard.type('2+2');
  await page.waitForTimeout(100);
  await Promise.all([page.waitForSelector('.row .result.copied', { state: 'attached', timeout: 5000 }), page.click('.row .result')]);
});

await check('Enter on a broken line shakes it, and the new line slides in', async (page) => {
  await page.keyboard.type('foo+');
  await page.waitForTimeout(100);
  await Promise.all([
    page.waitForSelector('.rows .row:nth-child(1).shake', { state: 'attached', timeout: 5000 }),
    page.waitForSelector('.rows .row:nth-child(2).enter', { state: 'attached', timeout: 5000 }),
    page.keyboard.press('Enter'),
  ]);
  await page.keyboard.type('1+1');
  // The next line sliding in says this Enter has been handled.
  await Promise.all([page.waitForSelector('.rows .row:nth-child(3).enter', { state: 'attached', timeout: 5000 }), page.keyboard.press('Enter')]);
  expect(!(await page.locator('.rows .row').nth(1).evaluate((el) => el.classList.contains('shake'))), 'a working line does not shake');
});

// The three follow-ups from #15. The fixes are in the script, not the stylesheets, but the two looks build their
// keypads differently enough to run the keypad one in both. Selecting an error and the graph's PNG run in one.
const setLook = (page, look) => page.selectOption('select.look', look, { force: true });
for (const look of ['modern', 'retro']) {
  await check(`${look}: Ctrl+Z takes back a keypad insert`, async (page) => {
    await setLook(page, look);
    await page.keyboard.type('2+');
    await page.locator('.keys .key', { hasText: /^7$/ }).first().click();
    await page.waitForTimeout(50);
    expect((await page.inputValue('.rows .expr')) === '2+7', 'the key typed 7');
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(50);
    expect((await page.inputValue('.rows .expr')) === '2+', `after Ctrl+Z: ${await page.inputValue('.rows .expr')}`);
    await page.locator('.keys .key[aria-label^="⌫"]').first().click();
    await page.waitForTimeout(50);
    expect((await page.inputValue('.rows .expr')) === '2', 'backspace removed +');
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(50);
    expect((await page.inputValue('.rows .expr')) === '2+', `after the second Ctrl+Z: ${await page.inputValue('.rows .expr')}`);
  });

  if (look === 'modern') await check(`${look}: clicking an error across the whole line selects the line`, async (page) => {
    await setLook(page, look);
    // "foo" would offer floor, and a name being completed isn't an error yet.
    await page.keyboard.type('qqq');
    const mark = page.locator('.row.active .err.marked');
    await mark.waitFor();
    expect((await mark.textContent()).includes('qqq'), `error: ${await mark.textContent()}`);
    await mark.click();
    await page.waitForTimeout(100);
    const sel = await page.evaluate(() => { const i = document.querySelector('.rows .expr'); return [i.selectionStart, i.selectionEnd, document.activeElement === i]; });
    expect(sel[0] === 0 && sel[1] === 3 && sel[2], `selection ${sel.join(',')}`);
  });

  if (look === 'modern') await check(`${look}: a PNG of a graph pane that has never been shown is not blank`, async (page) => {
    await setLook(page, look);
    await page.keyboard.press('Control+Alt+Shift+G');
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.graph-pane')).display === 'none'), 'the pane is hidden after the reload');
    await page.keyboard.type('y = x^2');
    await page.waitForTimeout(300);
    const png = await page.evaluate(async () => {
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = window.slopculator.graph.png(); });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const colors = new Set();
      for (let i = 0; i < d.length; i += 4) colors.add((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]);
      return { w: img.width, h: img.height, colors: colors.size };
    });
    expect(png.w >= 720 && png.h >= 480 && png.colors > 20, `api png ${png.w}x${png.h}, ${png.colors} colors`);
    await page.evaluate(() => document.querySelector('.row.active .expr')?.focus());
    await page.keyboard.press('Control+/');
    await page.keyboard.type('Save the graph as PNG');
    // Only the export belongs inside the download deadline, not opening Find and typing its command.
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 3000 }),
      page.keyboard.press('Enter'),
    ]);
    const size = readFileSync(await download.path()).length;
    expect(size > 5000, `downloaded PNG is ${size} bytes`);
    await page.keyboard.press('Control+Alt+Shift+G');
    await page.waitForTimeout(300);
    const box = await page.locator('.graph-canvas').boundingBox();
    expect(box && box.width > 100, 'the graph shows after the export');
  });
}

await check('Motion: Appearance sets it, and the choice survives a reload', async (page) => {
  expect((await page.getAttribute('html', 'data-motion')) === 'full', 'starts on Full');
  await page.click('.appear-btn');
  for (const m of ['reduced', 'off']) {
    await page.selectOption('select.motion', m);
    expect((await page.getAttribute('html', 'data-motion')) === m, `data-motion is ${m}`);
  }
  const off = await page.evaluate(() => getComputedStyle(document.querySelector('.key')).transitionDuration);
  expect(off.split(',').every((d) => parseFloat(d) < 0.01), `transitions finish at once: ${off}`);
  await page.waitForTimeout(700);
  await page.reload();
  expect((await page.getAttribute('html', 'data-motion')) === 'off', 'Off survives a reload');
});

await check('Color: a swatch is a signal and never repaints the page, and High contrast raises it to 7:1', async (page) => {
  const token = (k) => page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), k);
  const accent = () => token('--accent');
  await page.click('.appear-btn');
  await page.evaluate(() => window.slopculator.setSettings({ theme: 'paper' }));
  const own = await accent();
  const page0 = await token('--bg');
  const fill = await page.evaluate(() => getComputedStyle(document.querySelector('.swatch[aria-label="Teal color"]')).backgroundColor);
  expect(fill === 'rgb(15, 118, 110)', `the swatch shows its color: ${fill}`);
  await page.click('.swatch[aria-label="Teal color"]');
  expect((await accent()) === '#0f766e', `teal accent: ${await accent()}`);
  expect((await token('--bg')) === page0 && (await token('--key-bed')) === '#e3e4e9', `teal repainted the page: ${await token('--bg')}`);
  expect((await page.getAttribute('.swatch[aria-label="Teal color"]', 'aria-checked')) === 'true', 'the swatch is checked');
  // High contrast on Light: the swatch raised to 7:1 on white, no forced yellow.
  const contrastSwitch = page.locator('.appear-switch', { hasText: 'High contrast' });
  await contrastSwitch.click();
  expect((await contrastSwitch.getAttribute('aria-checked')) === 'true', 'the High contrast switch still said off right after turning it on');
  await page.locator('.mode-seg button', { hasText: 'Light' }).click();
  expect((await page.evaluate(() => document.documentElement.dataset.theme)) === 'contrastLight', 'High contrast on Light');
  expect((await accent()) === '#0c5b55', `High contrast raises teal to 7:1: ${await accent()}`);
  await contrastSwitch.click();
  expect((await contrastSwitch.getAttribute('aria-checked')) === 'false', 'the High contrast switch still said on right after turning it off');
  await page.evaluate(() => window.slopculator.setSettings({ theme: 'paper' }));
  await page.click('.swatch[aria-label="Default color"]');
  expect((await accent()) === own, `Default restores the accent: ${await accent()}`);
});

for (const look of ['modern', 'retro']) {
  await check(`${look}: the modes sit in the top bar`, async (page) => {
    await setLook(page, look);
    await page.waitForTimeout(200);
    const bar = await page.locator('.modebar').boundingBox();
    const pill = await page.locator('.modebar .desk-modes .seg').first().boundingBox();
    expect(pill.y >= bar.y && pill.y + pill.height <= bar.y + bar.height, `pill ${JSON.stringify(pill)} outside the bar ${JSON.stringify(bar)}`);
    const tools = await page.locator('.list-tools').boundingBox();
    expect(tools.y - (bar.y + bar.height) < 16, `gap under the top bar: ${tools.y - (bar.y + bar.height)}`);
    await page.screenshot({ path: `.shots/e2e-${look}-no-display.png` });
  });
}

await check('clearing shows Undo, with what was cleared where there is room for it, and Undo works', async (page) => {
  await page.locator('.row input').first().fill('6*7');
  await page.click('.clear-all');
  // Under the keys the strip has room for the words beside Undo.
  const label = page.locator('.toast.show.in-foot button');
  expect((await label.textContent()) === 'Undo', 'an Undo button');
  expect((await page.locator('.toast.show span').textContent()) === 'Cleared every line' && (await page.locator('.toast.show span').getAttribute('class')) !== 'sr-only', 'the strip says what was cleared');
  await label.click();
  expect((await page.locator('.row input').first().inputValue()) === '6*7', 'Undo brings the line back');
  // With the keys hidden it is the small pill over the toolbar, which says just Undo.
  await page.keyboard.press('Control+Alt+Shift+K');
  await page.waitForFunction(() => document.querySelector('.keypad').hidden);
  await page.click('.clear-all');
  const pill = page.locator('.toast.show.undo-only button');
  expect((await pill.textContent()) === 'Undo', 'an Undo pill');
  expect((await page.locator('.toast.show span').getAttribute('class')) === 'sr-only', 'the pill keeps its message for screen readers');
  await pill.click();
  expect((await page.locator('.row input').first().inputValue()) === '6*7', 'Undo from the pill brings the line back');
});

await check('an empty sheet hides Combine and Clear all, and the toolbar keeps a tab stop', async (page) => {
  const shown = () => page.evaluate(() => [!!document.querySelector('.combine')?.offsetParent, !!document.querySelector('.clear-all')?.offsetParent]);
  expect(JSON.stringify(await shown()) === '[false,false]', `shown on an empty sheet: ${await shown()}`);
  await page.keyboard.type('6*7');
  await page.waitForTimeout(150);
  expect(JSON.stringify(await shown()) === '[true,true]', `hidden with a line: ${await shown()}`);
  await page.focus('.clear-all');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  expect(JSON.stringify(await shown()) === '[false,false]', `shown after Clear all: ${await shown()}`);
  const stops = await page.evaluate(() => [...document.querySelectorAll('.list-tools button')].filter((b) => b.offsetParent && b.tabIndex === 0).length);
  expect(stops === 1, `visible toolbar tab stops: ${stops}`);
});

await check('phone: the top bar is one row with a Modes button, and the sheet holds every mode', async (page) => {
  expect(await page.isVisible('.keypad .numpad .key') && await page.isHidden('.keys-toggle'), 'a phone keeps its keypad and has no Keys button');
  for (const look of ['modern', 'retro']) {
    await setLook(page, look);
    await page.waitForTimeout(150);
    const bar = await page.locator('.modebar').boundingBox();
    // 36 px controls with 8 px above and 6 below; a second row would be 80 or more.
    expect(bar.height <= 50, `${look}: the top bar is one row: ${bar.height}`);
    const pills = await page.evaluate(() => [...document.querySelectorAll('.modebar .modes .pill:not(.more)')].filter((p) => p.offsetParent).length);
    expect(pills === 0, `${look}: ${pills} mode pills in a phone's top bar`);
    const mid = (b) => b.y + b.height / 2;
    const [more, file, find] = await Promise.all(['.modebar .pill.more', '.menu-btn', '.head-find'].map((q) => page.locator(q).boundingBox()));
    expect(file.y >= 8 && find.y >= 8, `${look}: Find and File clear the top edge: ${file.y}, ${find.y}`);
    expect(Math.abs(mid(more) - mid(file)) < 2 && Math.abs(mid(find) - mid(file)) < 2, `${look}: Modes, Find and File share a centerline: ${mid(more)}, ${mid(file)}, ${mid(find)}`);
    expect(await page.isHidden('.help-btn') && (await page.getAttribute('.modebar .pill.more', 'aria-label')) === 'Modes', `${look}: ? in the bar, or the Modes button misnamed`);
    const hits = await page.evaluate(() => [...document.querySelectorAll('.modebar .pill.more, .head-pill > button, .head-pill .menu-btn')].filter((b) => b.offsetParent).map((b) => {
      const r = b.getBoundingClientRect(), a = getComputedStyle(b, '::after');
      const grow = (v) => (a.content !== 'none' && a.position === 'absolute' ? -parseFloat(v) || 0 : 0);
      return { name: b.getAttribute('aria-label') || b.textContent.trim(), w: r.width + grow(a.left) + grow(a.right), h: r.height + grow(a.top) + grow(a.bottom) };
    }));
    expect(hits.length >= 3 && hits.every((x) => x.w >= 43.5 && x.h >= 43.5), `${look}: a header action under 44 px: ${JSON.stringify(hits)}`);
    expect(!(await page.$('.head-pill .head-kbd, .head-pill [aria-label*="keyboard"]')), `${look}: a second keyboard button in the header`);
    if (look === 'modern') {
      const m = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.modebar .pill.more')); return { w: s.width, h: s.height, r: s.borderRadius, shadow: s.boxShadow, bg: s.backgroundColor }; });
      expect(m.w === '34px' && m.h === '34px' && m.r === '50%' && m.shadow === 'none', `modern: Modes is a 34 px round well with no stroke: ${JSON.stringify(m)}`);
    }
  }
  await setLook(page, 'modern');
  await page.locator('.rows .row .expr').first().tap();
  await page.keyboard.type('sin(30)');
  await page.waitForTimeout(100);
  await page.locator('.modebar .modes .pill.more').tap();
  await page.waitForTimeout(450);
  expect(await page.isVisible('.mode-sheet'), 'the sheet opens');
  expect(await page.isHidden('.mode-menu'), 'no popover on a phone');
  const box = await page.locator('.mode-sheet').boundingBox();
  const bar = await page.locator('.modebar').boundingBox();
  expect(box.y >= bar.y + bar.height - 1, 'the sheet leaves the top bar in view');
  const groups = await page.locator('.mode-sheet .choice').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(JSON.stringify(groups) === '["Angles","Answers","Huge answers","Standard deviation","Adding a percent","Working"]', `choices: ${groups}`);
  const switches = await page.locator('.mode-sheet .ms-switch .name').allTextContents();
  expect(JSON.stringify(switches) === '["Percent probabilities","Line letters","Complex numbers"]', `switches: ${switches}`);
  expect(await page.isVisible('.mode-sheet .ms-round'), 'rounding is in the sheet');
  await page.locator('.mode-sheet .choice').nth(0).locator('button').nth(1).tap();
  await page.waitForTimeout(100);
  const r = await lines(page);
  expect(Math.abs(Number(r[0].value) - Math.sin(30)) < 1e-9, `recomputed in radians: ${JSON.stringify(r[0])}`);
  await page.locator('.mode-sheet .choice').nth(0).locator('button').nth(0).tap();
  await page.locator('.mode-sheet .ms-switch').first().tap();
  expect(await page.evaluate(() => window.slopculator.settings().percent), 'percent turns on from the sheet');
  await page.locator('.mode-sheet .ms-switch').nth(1).tap();
  await page.waitForTimeout(100);
  expect((await page.locator('.mode-sheet .ms-switch').nth(1).getAttribute('aria-checked')) === 'true', 'line letters turn on from the sheet');
  expect((await page.textContent('.row .idx')) === 'A', `letters show on the line: ${await page.textContent('.row .idx')}`);
  await page.locator('.mode-sheet .choice').nth(1).locator('button').nth(1).tap();
  expect((await page.locator('.modebar .modes .menu-pill').nth(1).textContent()) === 'Exact', 'exact from the sheet');
  await page.locator('.ms-done').tap();
  await page.waitForTimeout(450);
  expect(await page.isHidden('.mode-sheet'), 'Done closes the sheet');
  await page.screenshot({ path: '.shots/e2e-phone-modes.png' });
}, true);

await check('phone: the Modes sheet keeps keyboard focus and closes on Escape', async (page) => {
  await page.locator('.modebar .modes .pill.more').click();
  await page.waitForTimeout(450);
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press(i < 15 ? 'Tab' : 'Shift+Tab');
    expect(await page.evaluate(() => document.querySelector('.mode-sheet').contains(document.activeElement)), `Tab ${i + 1} left the sheet`);
  }
  expect(await page.evaluate(() => document.querySelector('.main, .app, body > div:not(.mode-sheet):not(.mode-scrim)').inert), 'the page behind is inert');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
  expect(await page.isHidden('.mode-sheet'), 'Escape closes the sheet');
  expect(await page.evaluate(() => [...document.body.children].every((el) => !el.inert)), 'nothing stays inert after closing');
}, true);

await check('phone on its side: the top bar stays one row, and the Modes sheet covers the keypad, not the lines', async (page) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(200);
  await page.keyboard.type('123456789*987654321');
  await page.waitForTimeout(300);
  const bar = await page.locator('.modebar').boundingBox();
  expect(bar.height <= 50, `the top bar stays one row: ${bar.height}`);
  await page.locator('.modebar .modes .pill.more').tap();
  await page.waitForTimeout(450);
  const [sheet, tape] = await page.evaluate(() => ['.mode-sheet', '.tape'].map((q) => document.querySelector(q).getBoundingClientRect().toJSON()));
  expect(sheet.left >= tape.right - 1, `the sheet starts at ${sheet.left}, the lines end at ${tape.right}`);
}, true);

const tapKey = async (page, label) => {
  const i = await page.evaluate((l) => [...document.querySelectorAll('.keypad .key')].findIndex((k) => k.offsetParent && (k.querySelector('.kl')?.textContent === l || k.getAttribute('aria-label') === l)), label);
  if (i < 0) throw new Error(`no key ${label}`);
  await page.locator('.keypad .key').nth(i).tap();
  await page.waitForTimeout(60);
};
const tapKeys = async (page, text) => { for (const ch of text) await tapKey(page, ch); };
const tapTab = async (page, name) => { await page.locator(`.ti-tab[aria-label="${name}"]`).tap(); await page.waitForTimeout(250); };
const tapTile = async (page, name) => { await page.locator(`.ti-tile:has(.ti-name:text-is("${name}"))`).first().tap(); await page.waitForTimeout(250); };
const lineNow = (page) => page.evaluate(() => {
  const row = document.querySelector('.row.active'), inp = row?.querySelector('.expr');
  return { text: inp?.value, caret: inp?.selectionStart, out: row?.querySelector('.out')?.textContent ?? '', calm: row?.classList.contains('calm'), red: row?.classList.contains('has-error'), slots: row?.querySelector('.slots:not([hidden])')?.textContent ?? null, hint: row?.querySelector('.hint-line:not([hidden])')?.textContent ?? null };
});
const pageOpen = (page) => page.evaluate(() => !document.querySelector('.ti-page').hidden);

await check('phone: the Thumb Index replaces the bank strip, its two rows on the pad\'s columns, and a tab opens its page over the notebook, never the keys', async (page) => {
  for (const look of ['modern', 'retro']) {
    await setLook(page, look);
    await page.waitForTimeout(150);
    const g = await page.evaluate(() => {
      const r = (e) => e.getBoundingClientRect();
      const rows = [...document.querySelectorAll('.ti-row')].map((row) => [...row.querySelectorAll('.key')].map((k) => ({ label: k.querySelector('.kl').textContent, box: r(k).toJSON() })));
      const pad = [...document.querySelector('.numpad .krow').querySelectorAll('.key')].map((k) => r(k).toJSON());
      return { rows, pad };
    });
    expect(g.rows[0].map((k) => k.label).join(' ') === 'x y π e % ans', `${look}: row 1 ${g.rows[0].map((k) => k.label)}`);
    expect(g.rows[1].map((k) => k.label).join(' ') === 'Math Stats Chance Matrix HVAC ÷', `${look}: row 2 ${g.rows[1].map((k) => k.label)}`);
    for (const row of g.rows) expect(row.every((k, i) => Math.abs(k.box.left - g.pad[i].left) < 1 && Math.abs(k.box.width - g.pad[i].width) < 1 && k.box.height >= 43), `${look}: a row off the pad's grid: ${JSON.stringify(row.map((k) => [Math.round(k.box.left), Math.round(k.box.width), Math.round(k.box.height)]))}`);
    const padAt = () => page.$$eval('.numpad .key, .ti-row .key', (ks) => ks.map((k) => { const b = k.getBoundingClientRect(); return `${Math.round(b.left)},${Math.round(b.top)}`; }).join(' '));
    const before = await padAt();
    await page.evaluate(() => window.slopculator.setLines(['12*3', '']));
    await page.locator('.rows .row').last().locator('.expr').tap();
    await page.waitForTimeout(150);
    const linesAt = () => page.evaluate(() => JSON.stringify({ top: document.querySelector('.rows').scrollTop, pad: document.querySelector('.rows').style.paddingTop, rows: [...document.querySelectorAll('.rows .row')].map((r) => { const b = r.getBoundingClientRect(); return [Math.round(b.top * 2) / 2, Math.round(b.height * 2) / 2]; }) }));
    const linesBefore = await linesAt();
    await tapTab(page, 'Math');
    expect(await pageOpen(page), `${look}: Math opened nothing`);
    await page.waitForTimeout(250);
    expect((await linesAt()) === linesBefore, `${look}: the lines moved when the page opened: ${linesBefore} → ${await linesAt()}`);
    const o = await page.evaluate(() => {
      const p = document.querySelector('.ti-page').getBoundingClientRect(), list = document.querySelector('.rows'), row = document.querySelector('.row.active').getBoundingClientRect();
      const keys = { top: list.getBoundingClientRect().top + list.clientTop + list.clientHeight };
      const tiles = [...document.querySelectorAll('.ti-tile')].map((t) => t.getBoundingClientRect());
      return { bottom: p.bottom, keys: keys.top, rowTop: row.top, rowBottom: row.bottom, segs: [...document.querySelectorAll('.ti-seg')].map((s) => s.textContent), tiles: tiles.length, cols: new Set(tiles.map((t) => Math.round(t.left))).size, h: Math.min(...tiles.map((t) => t.height)), lit: document.querySelector('.ti-tab.lit')?.getAttribute('aria-label'), outline: getComputedStyle(document.querySelector('.ti-page')).borderTopColor };
    });
    expect(o.segs.join() === 'Basic,Trig,Integer,∫ d/dx,Graph,Units $' && o.tiles <= 20 && o.cols === 4 && o.h >= 38, `${look}: the page ${JSON.stringify(o)}`);
    expect(o.lit === 'Math', `${look}: the lit tab is ${o.lit}`);
    expect(Math.abs(o.bottom - o.keys) <= 1, `${look}: the page's foot: ${JSON.stringify(o)}`);
    expect((await padAt()) === before, `${look}: the keys moved when the page opened`);
    // Switching and closing tabs is script; the sizes above are what the looks change.
    if (look === 'modern') {
      await page.locator('.ti-seg', { hasText: 'Trig' }).tap();
      expect((await page.locator('.ti-tile .ti-name').first().textContent()) === 'csc', `${look}: Trig's first tile`);
      await tapTab(page, 'Math');
      expect(!(await pageOpen(page)), `${look}: the lit tab left the page open`);
      await tapTab(page, 'Stats');
      await tapTab(page, 'Chance');
      expect((await page.textContent('.ti-title')).startsWith('Chance'), `${look}: one tab to another`);
      await page.locator('.ti-close').tap();
      await page.waitForTimeout(150);
      expect(!(await pageOpen(page)), `${look}: ✕ left the page open`);
      expect((await linesAt()) === linesBefore, `${look}: the lines moved when the page closed`);
      await tapTab(page, 'HVAC');
      await page.locator('.nav-view', { hasText: /graph/i }).tap();
      await page.waitForTimeout(250);
      await page.locator('.nav-view', { hasText: /calculate/i }).tap();
      await page.waitForTimeout(250);
      expect(!(await pageOpen(page)), `${look}: the page outlived the Graph view`);
    }
    await page.evaluate(() => window.slopculator.setLines(['']));
  }
}, true);

await check('phone: a tile inserts what its key did and closes the page; binompdf stays calm with grey slots until its inputs are in', async (page) => {
  for (const look of ['modern']) {
    await setLook(page, look);
    await page.evaluate(() => window.slopculator.setLines(['']));
    await page.locator('.rows .row .expr').first().tap();
    await tapTab(page, 'Chance');
    await tapTile(page, 'binompdf');
    expect(!(await pageOpen(page)), `${look}: the tile left the page open`);
    let l = await lineNow(page);
    expect(l.text === 'binompdf()' && l.caret === 9, `${look}: the tile put in ${JSON.stringify(l)}`);
    expect(l.slots === 'binompdf(n, p, k)' && /Next/.test(l.hint), `${look}: grey slots ${JSON.stringify(l)}`);
    await tapKeys(page, '10,0.3');
    await page.waitForTimeout(200);
    l = await lineNow(page);
    expect(l.calm && !l.red && !/\d/.test(l.out) && l.slots === 'binompdf(10,0.3, k)', `${look}: not calm with k missing: ${JSON.stringify(l)}`);
    await tapKeys(page, ',4');
    await page.waitForTimeout(250);
    l = await lineNow(page);
    expect(!l.calm && l.out.startsWith('0.2001') && l.slots === null, `${look}: binompdf(10, 0.3, 4): ${JSON.stringify(l)}`);
    await tapKey(page, 'enter');
    await tapTab(page, 'Stats');
    await tapTile(page, 'invNorm');
    await tapKeys(page, '0.95');
    await page.waitForTimeout(250);
    l = await lineNow(page);
    expect(l.text === 'invNorm(0.95)' && l.out.startsWith('1.64485'), `${look}: invNorm: ${JSON.stringify(l)}`);
  }
}, true);

await check('phone: the Refrig chips fill in the fluid, and tapping the end of an unfinished call goes inside it', async (page) => {
  await page.locator('.rows .row .expr').first().tap();
  await tapTab(page, 'HVAC');
  expect((await page.getAttribute('.ti-chip[aria-checked=true]', 'aria-label')) === 'R-410A', 'R-410A is not the first fluid');
  await page.locator('.ti-chip[aria-label="R-134a"]').tap();
  await page.waitForTimeout(100);
  expect((await page.getAttribute('.ti-chip[aria-checked=true]', 'aria-label')) === 'R-134a', 'the chip did not take');
  await tapTile(page, 'superheat');
  let l = await lineNow(page);
  expect(l.text === 'superheat("R134a", )' && l.calm && l.slots.includes('p, t, [alt]'), `superheat: ${JSON.stringify(l)}`);
  await tapKeys(page, '40,55');
  await page.waitForTimeout(250);
  l = await lineNow(page);
  expect(/^\d+\.\d/.test(l.out) && !l.calm, `superheat with 134a: ${JSON.stringify(l)}`);
  await page.evaluate(() => window.slopculator.setLines(['poissoncdf(2)', '']));
  await page.waitForTimeout(200);
  const box = await page.locator('.rows .row').first().locator('.expr').boundingBox();
  await page.touchscreen.tap(box.x + box.width - 4, box.y + box.height / 2);
  await page.waitForTimeout(250);
  l = await lineNow(page);
  expect(l.text === 'poissoncdf(2)' && l.caret === 12, `the caret after a tap at the end: ${JSON.stringify(l)}`);
  await tapKeys(page, ',3');
  await page.waitForTimeout(200);
  expect((await lineNow(page)).text === 'poissoncdf(2,3)', `typed on: ${(await lineNow(page)).text}`);
}, true);

await check('phone: det offers a 2 × 2 or 3 × 3, the comma and Next step through its cells, and det of [[1, 2], [3, 4]] is −2', async (page) => {
  await page.locator('.rows .row .expr').first().tap();
  await tapTab(page, 'Matrix');
  await tapTile(page, 'det');
  let l = await lineNow(page);
  expect(l.text === 'det()' && l.calm && !l.red && /2 × 2/.test(l.hint) && /3 × 3/.test(l.hint), `det(): ${JSON.stringify(l)}`);
  await page.locator('.hint-line .grid-chip', { hasText: '2 × 2' }).tap();
  await page.waitForTimeout(150);
  l = await lineNow(page);
  expect(l.text === 'det([[, ], [, ]])' && l.slots === 'det([[a, b], [c, d]])' && /Row 1, column 1 of 2 × 2/.test(l.hint), `the grid: ${JSON.stringify(l)}`);
  await tapKeys(page, '1,2,3');
  l = await lineNow(page);
  expect(l.text === 'det([[1, 2], [3, ]])' && /Row 2, column 1/.test(l.hint) && l.calm, `the comma steps cells: ${JSON.stringify(l)}`);
  await page.locator('.hint-line .next-slot').tap();
  await page.waitForTimeout(100);
  await tapKey(page, '4');
  await page.waitForTimeout(250);
  l = await lineNow(page);
  expect(l.text === 'det([[1, 2], [3, 4]])' && l.out === '−2', `det: ${JSON.stringify(l)}`);
}, true);

await check('phone: a digit closes the page and still types; so does any key', async (page) => {
  await page.locator('.rows .row .expr').first().tap();
  await tapTab(page, 'Math');
  await tapKey(page, '7');
  expect(!(await pageOpen(page)) && (await lineNow(page)).text === '7', `a digit: ${await pageOpen(page)} ${(await lineNow(page)).text}`);
  await tapTab(page, 'Stats');
  await tapKey(page, '×');
  expect(!(await pageOpen(page)) && (await lineNow(page)).text === '7*', `× : ${(await lineNow(page)).text}`);
  await tapTab(page, 'HVAC');
  await tapKey(page, 'π');
  expect(!(await pageOpen(page)) && (await lineNow(page)).text === '7*π', `π: ${(await lineNow(page)).text}`);
}, true);

await check('phone: Clear all is in File, its Undo pill says so for 10 s, and Undo brings every line back', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['6*7', '2+2', '']));
  await page.waitForTimeout(200);
  await page.locator('.menu-btn').tap();
  await freezeClock(page);
  await page.locator('.menu [role=menuitem]', { hasText: 'Clear all' }).tap();
  await page.clock.runFor(200);
  expect((await lines(page)).every((r) => !r.text), 'Clear all left lines');
  expect(/Cleared every line/.test(await page.textContent('.toast.show')), `the pill: ${await page.textContent('.toast')}`);
  await page.clock.runFor(9500);
  expect(await page.isVisible('.toast.show button:has-text("Undo")'), 'the pill went before 10 s');
  await page.clock.resume();
  await page.locator('.toast.show button', { hasText: 'Undo' }).tap();
  await page.waitForTimeout(200);
  const l = (await lines(page)).map((r) => r.text);
  expect(l.includes('6*7') && l.includes('2+2'), `Undo brought back ${l}`);
}, true, { clock: true });

await check('phone: the tabs\' colour notches stand 3:1 off their keys, and a lit tab\'s word 4.5:1, in every look and theme', async (page) => {
  const bad = await page.evaluate(async () => {
    const out = [];
    const sel = (c, v) => { const s = document.querySelector(`select.${c}`); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); };
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (x, y) => { const [a, b] = [lum(rgb(x)), lum(rgb(y))]; return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    for (const look of ['modern', 'retro']) for (const theme of ['paper', 'ink', 'oled', 'contrast', 'contrastLight']) {
      sel('look', look);
      window.slopculator.setSettings({ theme: theme === 'contrastLight' ? 'contrast' : theme });
      if (theme.startsWith('contrast')) [...document.querySelectorAll('.mode-seg button')].find((b) => b.textContent === (theme === 'contrast' ? 'Dark' : 'Light')).click();
      await new Promise((r) => setTimeout(r, 120));
      for (const tab of document.querySelectorAll('.ti-tab')) {
        const kc = getComputedStyle(tab), notch = getComputedStyle(tab, '::before').backgroundColor;
        const caps = kc.backgroundImage !== 'none' ? kc.backgroundImage.match(/rgba?\([^)]+\)/g) : [kc.backgroundColor];
        const worst = Math.min(...caps.map((c) => ratio(notch, c)));
        if (worst < 3) out.push(`${look}/${theme} ${tab.getAttribute('aria-label')}: notch ${notch} at ${worst.toFixed(2)}:1`);
        tab.style.transition = 'none';
        tab.classList.add('lit');
        const lit = getComputedStyle(tab), word = getComputedStyle(tab.querySelector('.kl')).color;
        const r = ratio(word, lit.backgroundColor);
        if (r < 4.5) out.push(`${look}/${theme} ${tab.getAttribute('aria-label')} lit: ${word} on ${lit.backgroundColor} at ${r.toFixed(2)}:1`);
        tab.classList.remove('lit');
        tab.style.transition = '';
      }
    }
    return out;
  });
  expect(!bad.length, bad.join('; '));
}, true);

await check('phone: Find opens focused and says where each function lives in the Thumb Index; choosing one lights its tab', async (page) => {
  await page.locator('.head-find').tap();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.activeElement?.classList.contains('pal-input')), 'Find did not open focused');
  await page.keyboard.type('loan');
  await page.waitForTimeout(200);
  const first = await page.evaluate(() => { const i = document.querySelector('.pal-item'); return { label: i.querySelector('.pal-label').textContent, home: i.querySelector('.pal-keys')?.textContent, shown: !!i.querySelector('.pal-keys')?.offsetParent }; });
  expect(first.label === 'pmt' && first.home === 'Math › Units $' && first.shown, `loan: ${JSON.stringify(first)}`);
  await page.keyboard.press('Escape');
  await page.locator('.head-find').tap();
  await page.waitForTimeout(250);
  await page.keyboard.type('dew point');
  await page.waitForTimeout(200);
  expect((await page.locator('.pal-item .pal-keys').first().textContent()) === 'HVAC › Psych', `dew point: ${await page.locator('.pal-item .pal-keys').first().textContent()}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => document.querySelector('.ti-tab[aria-label="HVAC"]').classList.contains('found')), 'the HVAC tab did not light');
}, true);

await check('phone, one-handed: 48 and 56 px keys up to the seam, operators down the right edge, enter the one filled key', async (page) => {
  for (const look of ['modern', 'retro']) {
    await setLook(page, look);
    await page.waitForTimeout(200);
    const g = await page.evaluate(() => {
      const r = (e) => { const x = e.getBoundingClientRect(); return { l: x.left, r: x.right, t: x.top, b: x.bottom, h: x.height, w: x.width }; };
      const kp = document.querySelector('.keypad');
      const pad = [...document.querySelectorAll('.numpad .krow')].map((row) => [...row.querySelectorAll('.key')].map((k) => ({ ...r(k), label: k.getAttribute('aria-label').split(':')[0] })));
      const index = [...document.querySelectorAll('.ti-row .key')].map(r);
      const bg = (q) => getComputedStyle(document.querySelector(q)).backgroundColor + getComputedStyle(document.querySelector(q)).backgroundImage;
      return {
        keypadTop: kp.getBoundingClientRect().top + parseFloat(getComputedStyle(kp).borderTopWidth), firstTop: Math.min(...index.map((k) => k.t)),
        index: index.map((k) => k.h), pad, div: r(document.querySelector('.ti-div')),
        enterBg: bg('.numpad .key.hero'), digitBg: bg('.numpad .key.num'),
        filled: [...document.querySelectorAll('.keys .key')].filter((k) => k.offsetParent && k.classList.contains('hero')).map((k) => k.textContent.trim()),
      };
    });
    const lip = look === 'retro' ? 2 : 0;
    expect(g.index.length === 12 && g.index.every((h) => Math.abs(h - (48 - lip)) < 1), `${look}: Thumb Index rows ${g.index}`);
    expect(g.pad.every((row) => row.every((k) => Math.abs(k.h - (56 - lip)) < 1)), `${look}: pad rows ${g.pad.map((r) => r[0].h)}`);
    expect(g.firstTop - g.keypadTop <= (look === 'retro' ? 16 : 9), `${look}: ${Math.round(g.firstTop - g.keypadTop)} px from the seam to the keys`);
    expect(g.pad.map((r) => r.map((k) => k.label).join(' ')).join(' / ') === '← → 7 8 9 × / xʸ √ 4 5 6 − / ( ) 1 2 3 + / , = 0 . ⌫ enter', `${look}: pad ${g.pad.map((r) => r.map((k) => k.label).join(' ')).join(' / ')}`);
    const col = [g.div, ...g.pad.map((r) => r[5])];
    expect(col.every((k) => Math.abs(k.r - g.pad[0][5].r) < 0.6) && col.every((k, i) => i === 0 || k.t > col[i - 1].t), `${look}: the right column`);
    expect(g.filled.join() === 'enter' && g.enterBg !== g.digitBg, `${look}: filled keys ${g.filled}`);
  }
}, true);

await check('phone, one-handed: the left-hand pad mirrors every group, enter in the bottom-left corner, ÷ over × at the left edge', async (page) => {
  await page.keyboard.press('Control+/');
  await page.keyboard.type('switch number pad');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const g = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.numpad .krow')].map((row) => [...row.querySelectorAll('.key')].map((k) => k.getAttribute('aria-label').split(':')[0]));
    const index = [...document.querySelectorAll('.ti-row')].map((row) => [...row.querySelectorAll('.key')].map((k) => k.querySelector('.kl').textContent));
    const keys = document.querySelector('.keys').getBoundingClientRect();
    return { rows, index, div: document.querySelector('.ti-div').getBoundingClientRect().left - keys.left };
  });
  expect(g.rows.map((r) => r.join(' ')).join(' / ') === '× 7 8 9 ← → / − 4 5 6 xʸ √ / + 1 2 3 ( ) / enter ⌫ 0 . = ,', `rows ${JSON.stringify(g.rows)}`);
  expect(g.index.map((r) => r.join(' ')).join(' / ') === 'x y π e % ans / ÷ Math Stats Chance Matrix HVAC', `the Thumb Index rows: ${JSON.stringify(g.index)}`);
  expect(Math.abs(g.div) < 1, `÷ is ${g.div} px in from the left edge`);
}, true);

await check('phone, one-handed: the caret keys repeat when held and scrub when slid', async (page) => {
  await page.keyboard.type('1234567890');
  await page.waitForTimeout(100);
  const caret = () => page.evaluate(() => document.querySelector('.row.active .expr').selectionStart);
  expect((await caret()) === 10, `starts at ${await caret()}`);
  const box = async (label) => page.locator(`.numpad .key[aria-label^="${label}"]`).first().boundingBox();
  const left = await box('←');
  await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2);
  await freezeClock(page);
  await page.mouse.down();
  await page.clock.runFor(600);
  await page.mouse.up();
  await page.clock.resume();
  const held = await caret();
  expect(held <= 8 && held >= 3, `holding ← left the caret at ${held}`);
  const right = await box('→');
  const x0 = right.x + right.width / 2, y0 = right.y + right.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x0 - i * 6, y0);
  await page.mouse.up();
  const slid = await caret();
  expect(slid === Math.max(0, held - 5), `sliding from ${held} left the caret at ${slid}`);
  expect((await page.inputValue('.row.active .expr')) === '1234567890', 'the line changed');
}, true, { clock: true });

await check('phone, one-handed: pressing → then sliding left only goes left, and lifting mid-repeat stops it', async (page) => {
  await page.keyboard.type('1234567890');
  const caret = () => page.evaluate(() => document.querySelector('.row.active .expr').selectionStart);
  await page.evaluate(() => document.querySelector('.row.active .expr').setSelectionRange(5, 5));
  const box = async (label) => page.locator(`.numpad .key[aria-label^="${label}"]`).first().boundingBox();
  const right = await box('→');
  const x0 = right.x + right.width / 2, y0 = right.y + right.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x0 - i * 6, y0);
  await page.mouse.up();
  expect((await caret()) === 2, `press → and slide left 36 px from 5 left the caret at ${await caret()}`);
  await page.mouse.move(x0, y0);
  await freezeClock(page);
  await page.mouse.down();
  await page.clock.runFor(520);
  await page.mouse.up();
  const stopped = await caret();
  await page.clock.runFor(300);
  await page.clock.resume();
  expect((await caret()) === stopped && stopped > 3, `the repeat ran on after lifting: ${stopped} then ${await caret()}`);
}, true, { clock: true });

const labelProblems = (page) => page.evaluate(() => {
  const out = [];
  for (const k of document.querySelectorAll('.keys .key')) {
    const kl = k.querySelector('.kl'), ks = k.querySelector('.ks');
    if (!kl || !k.offsetParent) continue;
    const label = kl.dataset.label ?? kl.textContent;
    const two = kl.classList.contains('two');
    const size = parseFloat(getComputedStyle(kl).fontSize);
    const icon = !!kl.querySelector('svg');
    const widest = two ? Math.max(...[...kl.children].map((c) => c.scrollWidth)) : kl.scrollWidth;
    if (getComputedStyle(kl).textOverflow === 'ellipsis' || widest > kl.clientWidth + 1) out.push(`${label} cut`);
    if (!icon && size < 12) out.push(`${label} at ${size}px`);
    if ([...label].length >= 7 && ks) out.push(`${label} has a caption`);
    if (two && (kl.children.length !== 2 || size < 12 || size > 13.01)) out.push(`${label} on two lines at ${size}px`);
    if (!two && !icon && kl.getBoundingClientRect().height > size * 1.6) out.push(`${label} wraps`);
    if (ks && !ks.hidden && (parseFloat(getComputedStyle(ks).fontSize) < 10 || ks.scrollWidth > ks.clientWidth + 1)) out.push(`${label}'s caption ${getComputedStyle(ks).fontSize}`);
  }
  return out;
});
const tileProblems = async (page, least = 30) => {
  const out = [];
  // With Motion off nothing is mid-animation, so each page can be measured as soon as it shows.
  await page.selectOption('select.motion', 'off', { force: true });
  for (const name of ['Math', 'Stats', 'Chance', 'Matrix', 'HVAC']) {
    await page.locator(`.ti-tab[aria-label="${name}"]`).tap();
    await page.locator('.ti-page').waitFor();
    const n = await page.locator('.ti-seg').count();
    for (let i = 0; i < Math.max(1, n); i++) {
      if (n) { await page.locator('.ti-seg').nth(i).tap(); await page.locator('.ti-seg[aria-selected=true]').nth(0).filter({ hasText: await page.locator('.ti-seg').nth(i).textContent() }).waitFor(); }
      out.push(...await page.evaluate(([tab, least]) => [...document.querySelectorAll('.ti-tile')].flatMap((t) => {
        const face = t.querySelector('.ti-face'), nm = t.querySelector('.ti-name'), where = `${tab}/${document.querySelector('.ti-seg[aria-selected=true]')?.textContent ?? tab} ${nm.textContent}`;
        const bad = [];
        if (face.scrollWidth > face.clientWidth + 1 || parseFloat(getComputedStyle(face).fontSize) < 10) bad.push(`${where}: face ${face.textContent} cut or small`);
        if (nm.offsetParent && nm.scrollWidth > nm.clientWidth + 1) bad.push(`${where}: name cut`);
        if (t.getBoundingClientRect().height < least) bad.push(`${where}: ${t.getBoundingClientRect().height}px tall`);
        return bad;
      }), [name, least]));
    }
    await page.locator('.ti-close').tap();
    await page.locator('.ti-page').waitFor({ state: 'hidden' });
  }
  return out;
};

// The 375 px checks below run the same sweep in both looks on a smaller phone; this is the regular size, in one.
await check('phone: no key label under 12 px or cut, captions 10 px or more, and every tile on every page whole', async (page) => {
  for (const look of ['modern']) {
    await setLook(page, look);
    await page.waitForTimeout(150);
    const bad = await labelProblems(page);
    expect(!bad.length, `${look}: ${bad.join(', ')}`);
    const tiles = await tileProblems(page);
    expect(!tiles.length, `${look}: ${tiles.join(', ')}`);
  }
}, true);

for (const look of ['modern', 'retro']) {
  await check(`375 px phone, ${look}: ⌫ says hold: clear (the caret keys need no caption), every label 12 px or more, every tile whole and the keys never covered`, async (page) => {
    await setLook(page, look);
    await page.waitForTimeout(200);
    for (const label of ['←', '→']) expect(!(await page.$(`.numpad .key[aria-label^="${label}"] .ks`)), `${look} ${label} still has a caption`);
    const ks = page.locator('.numpad .key[aria-label^="⌫"] .ks');
    const shown = await ks.evaluate((e) => !e.hidden && e.offsetParent !== null && e.scrollWidth <= e.clientWidth + 1 && parseFloat(getComputedStyle(e).fontSize) >= 11 ? e.textContent : `hidden or cut at ${getComputedStyle(e).fontSize}`);
    expect(shown === 'hold: clear', `${look} ⌫: ${shown}`);
    const arrow = await page.locator('.numpad .key[aria-label^="←"] .kicon').boundingBox();
    expect(arrow && arrow.width >= 18, `the arrow is ${arrow?.width} px`);
    const bad = await labelProblems(page);
    expect(!bad.length, `${look}: ${bad.join(', ')}`);
    const tiles = await tileProblems(page, 24);
    expect(!tiles.length, `${look}: ${tiles.join(', ')}`);
    await tapTab(page, 'HVAC');
    const o = await page.evaluate(() => [document.querySelector('.ti-page').getBoundingClientRect().bottom, document.querySelector('.keypad').getBoundingClientRect().top]);
    expect(o[0] <= o[1] + 0.5, `${look}: the page covers the keys: ${o}`);
  }, { width: 375, height: 667 });
}

await check('phone: ⌫ says hold: clear, turns red as the hold nears, clears the line at 800 ms, and Undo brings it back', async (page) => {
  await page.keyboard.type('12345');
  await page.evaluate(() => document.querySelector('.row.active .expr').setSelectionRange(3, 3));
  const back = page.locator('.numpad .key', { has: page.locator('.ks', { hasText: 'hold: clear' }) });
  expect((await back.count()) === 1 && await back.locator('.ks').isVisible(), 'no visible hold: clear caption');
  expect(parseFloat(await back.locator('.ks').evaluate((e) => getComputedStyle(e).fontSize)) >= 10, 'caption under 10 px');
  const b = await back.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await freezeClock(page);
  await page.mouse.down();
  await page.clock.runFor(400);
  const armed = await back.evaluate((e) => e.classList.contains('arming'));
  await page.clock.runFor(250);
  const still = await page.inputValue('.row.active .expr');
  await page.clock.runFor(300);
  await page.mouse.up();
  await page.clock.resume();
  await page.waitForTimeout(100);
  expect(armed, 'not armed 400 ms into the hold');
  expect(still === '12345', `cleared before 800 ms: ${still}`);
  expect((await page.inputValue('.row.active .expr')) === '', `the hold left ${await page.inputValue('.row.active .expr')}`);
  expect(await page.isVisible('.toast.show button:has-text("Undo")') && /Cleared the line/.test(await page.textContent('.toast')), `toast: ${await page.textContent('.toast')}`);
  await page.locator('.toast button', { hasText: 'Undo' }).tap();
  await page.waitForTimeout(150);
  expect((await page.inputValue('.row.active .expr')) === '12345', `Undo left ${await page.inputValue('.row.active .expr')}`);
  expect((await page.evaluate(() => document.querySelector('.row.active .expr').selectionStart)) === 3, 'Undo put the caret back');
  await page.evaluate(() => { const e = document.querySelector('.row.active .expr'); e.setSelectionRange(e.value.length, e.value.length); });
  await back.click();
  expect((await page.inputValue('.row.active .expr')) === '1234', `a tap left ${await page.inputValue('.row.active .expr')}`);
}, true, { clock: true });

// Long answers are styled in base.css alone, so one look covers them.
for (const look of ['modern']) {
  await check(`phone ${look}: Huge answers is a setting; Every digit puts a huge answer under its line in a capped box that scrolls, and the row never overlaps`, async (page) => {
    await setLook(page, look);
    await page.evaluate(() => window.slopculator.setLines(['price = 24.99', '9120*99^999', '2^60', '']));
    await page.waitForTimeout(400);
    const vals = () => page.$$eval('.rows .row .result .val', (els) => els.map((e) => e.textContent.replace(/\u2009/g, '')));
    let v = await vals();
    expect(v.includes('3.97698764 × 10¹⁹⁹⁷') && v.includes('1.152921505 × 10¹⁸'), `short by default: ${v}`);
    await page.evaluate(() => [...document.querySelectorAll('.mode-sheet [role=radio]')].find((x) => x.textContent.includes('Every digit')).click());
    await page.waitForTimeout(400);
    v = await vals();
    expect(v.some((t) => t.length === 1998) && v.includes('1152921504606846976'), `every digit: ${v.map((t) => t.length)}`);
    const shown = await page.$$eval('.rows .row .result .val', (els) => els.map((e) => e.textContent));
    expect(shown.includes('1\u2009152\u2009921\u2009504\u2009606\u2009846\u2009976'), `grouped in threes: ${shown.map((t) => t.slice(0, 30))}`);
    expect((await page.textContent('.out.long-answer .long-cue:not([hidden])')) === 'Scroll this answer · 1,998 digits', 'no scroll cue under the box that overflows');
    const g = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.rows .row')].find((r) => (r.querySelector('.val')?.textContent.length ?? 0) > 1000);
      const r = row.getBoundingClientRect(), src = row.querySelector('.src').getBoundingClientRect(), val = row.querySelector('.val'), b = val.getBoundingClientRect();
      const prev = row.previousElementSibling.getBoundingClientRect();
      return { rowTop: r.top, rowBottom: r.bottom, srcTop: src.top, srcBottom: src.bottom, valTop: b.top, valBottom: b.bottom, valH: b.height, scrollH: val.scrollHeight, overflow: getComputedStyle(val).overflowY, more: val.classList.contains('more'), prevBottom: prev.bottom };
    });
    expect(g.valH <= 121 && g.valH >= 100 && g.scrollH > g.valH * 5 && g.overflow === 'auto' && g.more, `the box: ${JSON.stringify(g)}`);
    expect(g.srcTop >= g.rowTop && g.valTop >= g.srcBottom - 1 && g.valBottom <= g.rowBottom && g.rowTop >= g.prevBottom - 1, `the row overlaps: ${JSON.stringify(g)}`);
    await page.evaluate(() => { const val = [...document.querySelectorAll('.rows .val')].find((e) => e.textContent.length > 1000); val.scrollTop = val.scrollHeight; val.dispatchEvent(new Event('scroll')); });
    await page.waitForTimeout(100);
    expect(!(await page.evaluate(() => [...document.querySelectorAll('.rows .val')].find((e) => e.textContent.length > 1000).classList.contains('more'))), 'the fade stays at the end');
    await page.waitForTimeout(400);
    await page.reload();
    await page.waitForTimeout(400);
    expect((await vals()).some((t) => t.length === 1998), 'Every digit after a reload');
  }, true);
}

await check('phone: a touch in the gap beside a caret key still moves the caret', async (page) => {
  await page.keyboard.type('123');
  const k = await page.locator('.numpad .key[aria-label^="←"]').boundingBox();
  await page.mouse.click(k.x + k.width + 2, k.y + k.height / 2);
  await page.waitForTimeout(100);
  expect((await page.evaluate(() => document.querySelector('.row.active .expr').selectionStart)) === 2, 'the gap beside ← took no touch');
}, true);

await check('phone: typing a name never moves the keys', async (page) => {
  const keys = () => page.$$eval('.keys .key', (ks) => ks.map((k) => { const r = k.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)}`; }).join(' '));
  await page.evaluate(() => { window.slopculator.setLines(['price = 24.99', '']); });
  await page.waitForTimeout(200);
  await page.locator('.rows .row').nth(1).locator('.expr').click();
  const before = await keys();
  await page.keyboard.type('pri');
  await page.waitForTimeout(300);
  expect((await keys()) === before, 'the keys moved while a name was being typed');
}, true);

const paneShown = (page) => page.evaluate(() => getComputedStyle(document.querySelector('.graph-pane')).display !== 'none');
await check('the graph is up beside the notebook even on an empty sheet, and stays when the curve goes', async (page) => {
  expect(await paneShown(page), 'no graph pane on an empty sheet');
  const left = () => page.evaluate(() => document.querySelector('.left').getBoundingClientRect().toJSON());
  const split = await left();
  const windowWidth = await page.evaluate(() => innerWidth);
  expect(split.left < 2 && split.width >= 420 && split.width <= windowWidth * 0.35, `the notebook is not the slim column: ${JSON.stringify(split)}`);
  const canvas = await page.locator('.graph-canvas').boundingBox();
  expect(canvas && canvas.width > 700, `the plot fills the rest: ${JSON.stringify(canvas)}`);
  await page.keyboard.type('y = x');
  await page.waitForTimeout(500);
  await page.keyboard.press('ControlOrMeta+Shift+Backspace');
  await page.waitForTimeout(400);
  expect(await paneShown(page), 'the graph left with the curve');
});

await check('Hide graph in File wins over a plottable line, and Show graph keeps it on an empty sheet', async (page) => {
  await page.keyboard.type('y = x^2');
  await page.waitForTimeout(500);
  await page.click('.menu-btn');
  await page.locator('.menu [role=menuitem]', { hasText: 'Hide graph' }).click();
  await page.waitForTimeout(300);
  expect(!(await paneShown(page)), 'Hide graph left it up');
  await page.reload();
  await page.waitForTimeout(400);
  expect(!(await paneShown(page)), 'the choice did not survive a reload');
  await page.click('.menu-btn');
  await page.locator('.menu [role=menuitem]', { hasText: 'Show graph' }).click();
  await page.waitForTimeout(300);
  expect(await paneShown(page), 'Show graph did not show it');
  await page.keyboard.press('Control+Alt+Backspace');
  await page.waitForTimeout(400);
  expect(await paneShown(page), 'a chosen graph left with the last curve');
});

await check('desktop: the keypad is up at the start, under the notebook; the Keypad button in the top bar hides it and remembers', async (page) => {
  expect(await page.isVisible('.keypad .numpad .key'), 'the keypad is folded at the start');
  const toggle = page.locator('.modebar .bar-tog', { hasText: 'Keypad' });
  expect(await toggle.isVisible(), 'no Keypad button in the top bar');
  expect(await page.isHidden('.list-tools .keys-toggle'), 'the toolbar still has Keys');
  expect((await toggle.getAttribute('aria-pressed')) === 'true', 'Keypad does not say it is up');
  const pad = await page.locator('.keypad').boundingBox(), left = await page.locator('.left').boundingBox();
  expect(pad.y + pad.height <= 900.5 && pad.x >= left.x - 1 && pad.x + pad.width <= left.x + left.width + 1, `the keypad is not at the foot of the notebook: ${JSON.stringify(pad)}`);
  await toggle.click();
  await page.waitForTimeout(400);
  expect(await page.isHidden('.keypad'), 'Keypad did not hide it');
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForTimeout(300);
  expect(await page.isHidden('.keypad'), 'the hidden keypad was forgotten');
  await page.locator('.modebar .bar-tog', { hasText: 'Keypad' }).click();
  await page.waitForTimeout(400);
  expect(await page.isVisible('.keypad .numpad .key'), 'Keypad did not bring it back');
  // An old save made the phone's keypad hidden on a wide window; the desktop's own pref ignores it.
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem(slopKeys.document)); d.ui.keypad = false; delete d.ui.deskKeypad; localStorage.setItem(slopKeys.document, JSON.stringify(d)); });
  await page.reload();
  await page.waitForTimeout(300);
  expect(await page.isVisible('.keypad .numpad .key'), 'an old save hid the desktop keypad');
});

await check('desktop: the hint row under the keys is blank at rest and says what the key or tile you point at does, on up to two lines', async (page) => {
  const hint = () => page.textContent('.key-hint');
  expect(await page.isVisible('.key-hint') && (await hint()) === '', `the hint at rest: ${await hint()}`);
  const pad = await page.locator('.pad').boundingBox(), row = await page.locator('.key-hint').boundingBox();
  expect(row.y >= pad.y + pad.height - 1 && row.height >= 32, `the hint row is not two lines under the keys: ${JSON.stringify(row)}`);
  await page.locator('.numpad .key', { hasText: /^7$/ }).first().hover();
  await page.waitForTimeout(150);
  expect((await hint()) === '', `a digit types itself, so it has no hint: ${await hint()}`);
  await page.locator('.numpad .key[data-action="back"]').first().hover();
  await page.waitForTimeout(100);
  expect((await hint()).length > 4, `pointing at ⌫: ${await hint()}`);
  await page.locator('.ti-tab[aria-label="Stats"]').click();
  await page.locator('.ti-tile:has(.ti-name:text-is("zscore"))').hover();
  await page.waitForTimeout(100);
  const said = await page.evaluate(() => { const h = document.querySelector('.key-hint'), t = h.querySelector('.kh-text'); return { text: h.textContent, name: h.querySelector('.kh-name')?.textContent, clipped: !!t && t.scrollHeight > t.clientHeight + 1 && t.textContent.length < 120 }; });
  expect(/^zscore\(/.test(said.name ?? '') && said.text.length > said.name.length + 8 && !said.clipped, `pointing at z-score: ${JSON.stringify(said)}`);
  expect(await page.isHidden('.key-help'), 'the floating tip shows on a desktop too');
  await page.mouse.move(900, 400);
  await page.waitForTimeout(300);
  expect((await hint()) === '', 'the hint stayed after the pointer left');
});

await check('File keeps files; look, mode, color and motion are in Appearance', async (page) => {
  await page.click('.menu-btn');
  const file = await page.locator('.menu-wrap:not(.appear-wrap) > .menu').textContent();
  for (const word of ['New sheet', 'Open', 'Save', 'Duplicate', 'Rename', 'History', 'Export', 'Import', 'PNG', 'SVG']) expect(file.includes(word), `File lost ${word}`);
  for (const word of ['Look', 'Theme', 'Color', 'Motion']) expect(!file.includes(word), `File still has ${word}`);
  expect((await page.locator('.menu-wrap:not(.appear-wrap) > .menu :is(select, .swatch)').count()) === 0, 'File still has pickers');
  await page.click('.appear-btn');
  expect(await page.isHidden('.menu-wrap:not(.appear-wrap) > .menu'), 'File stayed open under Appearance');
  expect(await page.isVisible('.appear-menu'), 'Appearance did not open');
  for (const q of ['.appear-sample', 'select.look', '.mode-seg', '.swatch', '.appear-switch', 'select.motion']) expect(await page.locator(`.appear-menu ${q}`).first().isVisible(), `Appearance has no ${q}`);
  await page.keyboard.press('Escape');
  expect(await page.isHidden('.appear-menu'), 'Escape left Appearance open');
  expect(await page.evaluate(() => document.activeElement.classList.contains('appear-btn')), 'focus did not go back to the button');
});

await check('phone: Appearance is in the Modes sheet', async (page) => {
  expect(await page.isHidden('.appear-btn'), 'a sliders button for Appearance in a phone top bar');
  await page.locator('.modebar .modes .pill.more').tap();
  await page.waitForTimeout(450);
  for (const q of ['.appear-sample', 'select.look', '.mode-seg', '.swatch', '.appear-switch', 'select.motion']) expect(await page.locator(`.mode-sheet ${q}`).first().isVisible(), `the sheet has no ${q}`);
  await page.selectOption('.mode-sheet select.look', 'retro');
  expect((await page.evaluate(() => document.documentElement.dataset.look)) === 'retro', 'Look from the sheet');
}, true);

await check('phone: the Graph view has a chip per plotted line, and a tap edits that line', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['y = x', '2+2', 'y = x^2 - 3', 'x^2 + y^2 = 9']));
  await page.waitForTimeout(300);
  await page.locator('.rows .row').nth(3).locator('.expr').tap();
  await page.locator('.nav-view', { hasText: 'Graph' }).tap();
  await page.waitForTimeout(300);
  const chips = await page.locator('.graph-chips .gchip').evaluateAll((els) => els.map((e) => ({ name: e.querySelector('.gc-name').textContent, text: e.querySelector('.gc-text').textContent, active: e.classList.contains('active'), border: getComputedStyle(e).boxShadow })));
  expect(chips.length === 3, `chips: ${JSON.stringify(chips)}`);
  expect(chips.map((c) => c.name).join() === '1,3,4' && chips[1].text === 'y = x² − 3', `chip names: ${JSON.stringify(chips)}`);
  expect(chips[2].active && !chips[0].active && chips[2].border.includes('1.5px'), `the line you're on: ${JSON.stringify(chips)}`);
  const [c, t] = await page.evaluate(() => ['.graph-chips', '.graph-tools'].map((q) => document.querySelector(q).getBoundingClientRect().toJSON()));
  expect(c.bottom <= t.top + 1, 'the chips sit over the tools');
  await page.locator('.graph-chips .gchip').nth(1).tap();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => !document.querySelector('.main').classList.contains('view-graph')), 'still on Graph after a tap');
  expect(await page.evaluate(() => document.querySelectorAll('.rows .row')[2].classList.contains('active')), 'the tapped line is not active');
  await page.screenshot({ path: '.shots/e2e-phone-chips.png' });
}, true);

const MANY = ['price = 24.99', 'tax = price * 0.0825', 'price + tax', 'y = x^2/4 - 3', 'f(x) = 2x + 1', 'normalcdf(-1, 1, 0, 1)', '[[1,2],[3,4]] * 2', 'sqrt(7^2 - 4*2*3)', '1/7', 'mean({3, 5, 8, 13})', '2^10', '[[1,0],[0,1]]', '3/4 + 1/8', '100 * 1.05^10', ''];
const edgeState = (page) => page.evaluate(() => {
  const l = document.querySelector('.rows');
  const lt = l.getBoundingClientRect().top;
  const pad = (r) => parseFloat(getComputedStyle(r).scrollMarginTop) || 0;
  const off = Math.min(...[...l.children].map((r) => Math.abs(r.getBoundingClientRect().top - pad(r) - lt)));
  const a = l.querySelector('.row.active')?.getBoundingClientRect(), lb = l.getBoundingClientRect();
  return { off, top: l.scrollTop, max: l.scrollHeight - l.clientHeight, active: a && { inTop: a.top - lb.top, inBottom: lb.bottom - a.bottom } };
});
// Resting on lines is script, the same in both looks; one look per form factor.
for (const [phone, look] of [[false, 'retro'], [true, 'modern']]) {
  await check(`${phone ? 'phone' : 'desktop'} ${look}: the list rests on whole lines, and moving to a line keeps it clear of both edges`, async (page) => {
    await setLook(page, look);
    await page.evaluate((L) => window.slopculator.setLines(L), MANY);
    await page.waitForTimeout(300);
    const snap = await page.evaluate(() => [getComputedStyle(document.querySelector('.rows')).scrollSnapType, getComputedStyle(document.querySelector('.rows .row')).scrollSnapAlign]);
    expect(snap[0].includes('y') && snap[1].includes('start'), `snapping: ${snap}`);
    await page.locator('.rows .row').first().locator('.expr').click();
    for (let i = 0; i < MANY.length - 1; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(60);
      const s = await edgeState(page);
      expect(s.active && s.active.inTop >= 0 && (s.active.inBottom >= 30 || s.top >= s.max - 1), `${look} line ${i + 2} down: ${JSON.stringify(s)}`);
      expect(s.off <= 1.5 || s.top >= s.max - 1 || s.top < 1, `${look} line ${i + 2}: the top edge cuts a line ${JSON.stringify(s)}`);
    }
    let s = await edgeState(page);
    expect(s.off <= 1.5, `${look}: at the end the top edge cuts a line by ${s.off}`);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(60);
      s = await edgeState(page);
      expect(s.active.inTop >= 20 || s.top < 1, `${look} up: the line you're on is at the edge ${JSON.stringify(s)}`);
      expect(s.off <= 1.5 || s.top < 1, `${look} up: the top edge cuts a line ${JSON.stringify(s)}`);
    }
    const shade = await page.evaluate(() => {
      const t = document.querySelector('.tape');
      const edge = t.classList.contains('covered') ? getComputedStyle(document.querySelector('.edge-cover.bottom'), '::before') : getComputedStyle(t, '::after');
      return [getComputedStyle(document.querySelector('.tape.scrolled > .list-tools'))?.boxShadow, edge.backgroundImage, edge.height];
    });
    expect(/0px 8px 16px -8px/.test(shade[0]), `${look}: the toolbar's shadow: ${shade[0]}`);
    expect(shade[1].includes('gradient') && parseFloat(shade[2]) >= 16, `${look}: the keypad edge's shadow: ${shade[1]} ${shade[2]}`);
  }, phone);
}

// Canvas text doesn't follow the look (graph.ts), so one look covers it.
for (const look of ['modern']) {
  await check(`desktop ${look}: each curve is named on the plot, in the clear, with its math`, async (page) => {
    await setLook(page, look);
    await page.evaluate(() => { window.slopculator.setSettings({ lineNames: true }); window.slopculator.setLines(['y = x^2/4 - 3', 'f(x) = 2x + 1', '']); });
    await page.waitForTimeout(900);
    const [names, plot] = await page.evaluate(() => [window.slopculator.graph.names(), document.querySelector('.graph-host canvas').getBoundingClientRect().toJSON()]);
    expect(names.length === 2, `names: ${JSON.stringify(names)}`);
    expect(names[0].text === 'A  y = x²/4 − 3' && names[1].text === 'B  f(x) = 2x + 1', `name text: ${JSON.stringify(names)}`);
    const [a, b] = names.map((n) => n.box);
    expect(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1], `the names overlap: ${JSON.stringify(names)}`);
    for (const [l, t, r, bt] of [a, b]) expect(l >= 24 && t >= 24 && r <= plot.width - 24 && bt <= plot.height - 24, `a name near the edge: ${JSON.stringify(names)} in ${plot.width}x${plot.height}`);
    const v = await page.evaluate(() => window.slopculator.graph.view());
    const [l, t, r, bt] = a;
    const mx = v.xmin + ((l + r) / 2 / plot.width) * (v.xmax - v.xmin), my = v.ymax - ((t + bt) / 2 / plot.height) * (v.ymax - v.ymin);
    expect(my < mx * mx / 4 - 3, `the parabola's name sits inside its bowl: ${JSON.stringify(names)} at (${mx.toFixed(2)}, ${my.toFixed(2)})`);
  });
}
await check('phone: the plot draws no curve names; the chips name the lines', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['y = x^2/4 - 3', 'f(x) = 2x + 1', '']));
  await page.waitForTimeout(300);
  await page.locator('.nav-view', { hasText: 'Graph' }).tap();
  await page.waitForTimeout(700);
  const names = await page.evaluate(() => window.slopculator.graph.names());
  expect(names.length === 0, `phone names: ${JSON.stringify(names)}`);
  expect((await page.locator('.graph-chips .gchip').count()) === 2, 'the chips are there');
}, true);

await check('modern: the line being edited keeps the typeset face, so it does not jump', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['price + tax', '']));
  await page.waitForTimeout(300);
  const tex = await page.evaluate(() => { const t = getComputedStyle(document.querySelector('.rows .row .tex')); return [t.fontFamily, t.fontSize]; });
  await page.locator('.rows .row').first().locator('.expr').click();
  const e = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.rows .row .expr')); return [c.fontFamily, c.fontSize, c.letterSpacing, c.fontVariantNumeric]; });
  expect(e[0] === tex[0] && e[1] === tex[1], `editing ${e} vs typeset ${tex}`);
  expect((e[2] === 'normal' || e[2] === '0px') && e[3].includes('tabular-nums'), `editing spacing and figures: ${e}`);
});
await check('desktop: AC at the pad\'s corner shows its legend in every look and theme', async (page) => {
  const bad = await page.evaluate(async () => {
    const out = [];
    const sel = (c, v) => { const s = document.querySelector(`select.${c}`); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); };
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    for (const look of ['modern', 'retro']) for (const theme of ['paper', 'ink', 'oled', 'contrast', 'contrastLight']) {
      sel('look', look);
      window.slopculator.setSettings({ theme: theme === 'contrastLight' ? 'contrast' : theme });
      if (theme.startsWith('contrast')) [...document.querySelectorAll('.mode-seg button')].find((b) => b.textContent === (theme === 'contrast' ? 'Dark' : 'Light')).click();
      await new Promise((r) => setTimeout(r, 120));
      const k = document.querySelector('.key.clear-all.desk-ac');
      const l = k.querySelector('.kl'), kc = getComputedStyle(k), lc = getComputedStyle(l);
      // The cap fades between themes, and a reading from partway through is neither theme's contrast.
      await Promise.all([k, l].flatMap((e) => e.getAnimations()).filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => {})));
      const capColor = kc.backgroundImage !== 'none' ? kc.backgroundImage.match(/rgba?\([^)]+\)/g).pop() : kc.backgroundColor;
      const [a, b] = [lum(rgb(lc.color)), lum(rgb(capColor))];
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (parseFloat(lc.fontSize) < 9 || l.clientWidth < 8 || ratio < 3 || lc.opacity !== '1') out.push(`${look}/${theme}: ${lc.color} on ${capColor} (${ratio.toFixed(1)}:1), ${lc.fontSize}, ${l.clientWidth}px`);
    }
    return out;
  });
  expect(!bad.length, bad.join('; '));
});

/**
 * Turns the wheel over the list and waits for it to come to rest (its data-scroll back to rest), instead of a fixed
 * time. A turn that moves nothing never leaves rest, so after a short wait for movement that counts as at rest too.
 */
async function wheelToRest(page, dy) {
  await page.evaluate(() => {
    const l = document.querySelector('.rows');
    window.__moved = false;
    window.__moveWatch?.disconnect();
    window.__moveWatch = new MutationObserver(() => { if (l.dataset.scroll !== 'rest') window.__moved = true; });
    window.__moveWatch.observe(l, { attributes: true, attributeFilter: ['data-scroll'] });
  });
  await page.mouse.wheel(0, dy);
  await page.waitForFunction(() => window.__moved, null, { timeout: 500 }).catch(() => {});
  await page.waitForFunction(() => (document.querySelector('.rows').dataset.scroll ?? 'rest') === 'rest');
}
const coverState = (page) => page.evaluate(() => {
  const l = document.querySelector('.rows');
  const top = l.getBoundingClientRect().top + l.clientTop, bottom = top + l.clientHeight;
  const band = (c) => { const e = document.querySelector(`.edge-cover.${c}`); if (!e.classList.contains('on')) return null; const r = e.getBoundingClientRect(); return [r.top, r.bottom]; };
  const t = band('top'), b = band('bottom');
  const units = [...l.children].flatMap((el) => (el.classList.contains('starter') ? [...el.querySelectorAll('.starter-head, .starter-card')] : [el]));
  const cutTop = [], cutBottom = [];
  for (const u of units) {
    const r = u.getBoundingClientRect();
    if (r.height < 1) continue;
    let lo = Math.max(r.top, top), hi = Math.min(r.bottom, bottom);
    if (t) lo = Math.max(lo, t[1]);
    if (b) hi = Math.min(hi, b[0]);
    if (hi - lo > 0.5 && hi - lo < r.height - 0.5) (r.top < top - 0.5 ? cutTop : cutBottom).push(Math.round(hi - lo));
  }
  const pad = (r) => (r.parentElement === l ? parseFloat(getComputedStyle(r).scrollMarginTop) || 0 : 0);
  const off = Math.min(...units.filter((u) => u.offsetHeight).map((u) => Math.abs(u.getBoundingClientRect().top - pad(u) - top)));
  return { top: t ? t[1] - t[0] : 0, bottom: b ? b[1] - b[0] : 0, cutTop, cutBottom, off, y: l.scrollTop, max: l.scrollHeight - l.clientHeight };
});

// Settling is script, the same in both looks; one look per form factor.
for (const [look, phone] of [['modern', true], ['retro', false]]) {
  await check(`${phone ? 'phone' : 'desktop'} ${look}: a scroll settles on a line at the top edge, and only a sliver at the bottom is covered`, async (page) => {
    await setLook(page, look);
    await page.evaluate(() => window.slopculator.setLines(['price = 24.99', 'tax = price * 0.0825', 'price + tax', 'y = x^2/4 - 3', 'f(x) = 2x + 1', 'normalcdf(-1, 1, 0, 1)', '[[1,2],[3,4]] * 2', 'sqrt(7^2 - 4*2*3)', 'mean({3, 5, 8, 13})', '2^10', 'nCr(7, 3)', 'sin(30)', '1/7 + 3/4', '100 * 1.05^10', '[[1,0],[0,1]]', 'normcdf(1', '2 + 2', 'sqrt(2)', 'e^2', '']));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.evaluate(() => { document.querySelector('.rows').scrollTop = 0; });
    await page.waitForTimeout(300);
    const box = await page.locator('.rows').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    let settled = 0, edged = 0;
    for (const dy of [70, 38, 95, 52, -130, 44, -66, 81, -110, 58, 47, 33]) {
      await wheelToRest(page, dy);
      const s = await coverState(page);
      const at = `after a ${dy}px turn, at ${s.y}px: ${JSON.stringify(s)}`;
      expect(s.top <= 24.5 && s.bottom <= 24.5, `a band is taller than 24 px ${at}`);
      if (s.y > 1 && s.y < s.max - 1) {
        expect(s.off <= 1.5 && !s.cutTop.length, `the top edge cuts a line ${at}`);
        settled++;
      }
      expect(s.cutBottom.every((px) => px >= 24), `a sliver shows at the bottom ${at}`);
      if (s.cutBottom.length || s.bottom) edged++;
    }
    expect(settled > 4, `the list rested mid-sheet only ${settled} times`);
    expect(edged > 0, 'no resting place left a line cut at the bottom edge');
    // The bands lift while the list moves: a wheel turn is a scroll in progress. A headless wheel can land in one
    // frame, so the events are checked, not frames. With their fade off, a band's opacity is whether it's up.
    await page.addStyleTag({ content: '.edge-cover { transition: none !important; }' });
    await page.evaluate(() => {
      const l = document.querySelector('.rows');
      window.__moves = [];
      l.onscroll = () => window.__moves.push([...document.querySelectorAll('.edge-cover')].some((c) => getComputedStyle(c).opacity !== '0'));
    });
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(100);
    const moves = await page.evaluate(() => window.__moves);
    expect(moves.length && moves.every((on) => !on), `a band stayed up while the list moved: ${JSON.stringify(moves)}`);
  }, phone);
}
for (const look of ['modern', 'retro']) {
  await check(`phone ${look}: the empty sheet's starter cards end on a card or one showing more than a sliver`, async (page) => {
    await setLook(page, look);
    await page.waitForTimeout(500);
    const s = await coverState(page);
    expect(s.top <= 24.5 && s.bottom <= 24.5 && s.cutBottom.every((px) => px >= 24) && !s.cutTop.length, `starter cards: ${JSON.stringify(s)}`);
  }, true);
}

await check('a slider: a whole number steps by 1 from 0 to twice it, any other value runs ±max(2|v|, 10) with a step that lands on it', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['price = 24.99', 'n = 10', 'k = 3', '']));
  await page.waitForTimeout(300);
  const got = await page.evaluate(() => [...document.querySelectorAll('.slider-row')].map((row) => {
    const v = (q) => row.querySelector(q).value;
    return { lo: v('.lim.lo'), hi: v('.lim.hi'), step: v('.lim.step'), value: row.querySelector('.slider').value, font: getComputedStyle(row.querySelector('.lim.hi')).fontFamily, nums: getComputedStyle(row.querySelector('.lim.hi')).fontVariantNumeric };
  }));
  expect(got[0].lo === '-50' && got[0].hi === '50' && got[0].step === '0.01' && got[0].value === '24.99', JSON.stringify(got[0]));
  expect(got[1].lo === '0' && got[1].hi === '20' && got[1].step === '1' && got[1].value === '10', `n = 10: ${JSON.stringify(got[1])}`);
  expect(got[2].lo === '0' && got[2].hi === '10' && got[2].step === '1', `k = 3: ${JSON.stringify(got[2])}`);
  expect(got[0].font.includes('Geist Sans') && !got[0].font.includes('Mono') && got[0].nums.includes('tabular-nums'), JSON.stringify(got[0]));
});

await check('Fit is an action that never looks selected; 1:1 sleeps with no tile once the axes are equal', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['y = x^2']));
  await page.waitForTimeout(600);
  const tool = (title) => page.locator(`.graph-tools button[title^="${title}"]`);
  await tool('Fit').click();
  await tool('Square axes').click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const look = (title) => page.evaluate((t) => { const b = document.querySelector(`.graph-tools button[title^="${t}"]`); const c = getComputedStyle(b); return { pressed: b.getAttribute('aria-pressed'), disabled: b.disabled, bg: c.backgroundColor + c.backgroundImage, color: c.color }; }, title);
  const fit = await look('Fit'), home = await look('Reset view'), square = await look('Square axes');
  expect(fit.pressed === null && fit.bg === home.bg && fit.color === home.color, `Fit: ${JSON.stringify(fit)}, Home: ${JSON.stringify(home)}`);
  expect(square.pressed === 'true' && square.disabled && square.bg === home.bg, `1:1: ${JSON.stringify(square)}`);
});

for (const look of ['modern', 'retro']) {
  await check(`${look}: a parser error reads in plain words, with the parser's message kept in its title`, async (page) => {
    await setLook(page, look);
    await page.evaluate(() => window.slopculator.setLines(['normcdf(1', '2 +', '1 + 2)', '']));
    await page.waitForTimeout(400);
    const errs = await page.$$eval('.row .err', (es) => es.map((e) => [e.textContent, e.title.split('\n')[0], e.getBoundingClientRect().height]));
    expect(errs.length === 3, JSON.stringify(errs));
    expect(errs[0][0] === 'normcdf( is missing a )' && errs[0][1] === 'Expected ")" to close normcdf(, got end of input', JSON.stringify(errs[0]));
    expect(errs[1][0] === 'Unfinished: add what comes next' && errs[2][0] === 'Extra )', JSON.stringify(errs));
    expect(errs.every((e) => e[2] < 30), `an error wraps: ${JSON.stringify(errs)}`);
    await page.locator('.row .err').first().click();
    await page.waitForTimeout(150);
    const sel = await page.evaluate(() => { const a = document.activeElement; return a?.tagName === 'TEXTAREA' || a?.tagName === 'INPUT' ? [a.selectionStart, a.selectionEnd] : null; });
    expect(sel, `clicking the message didn't open the line: ${JSON.stringify(sel)}`);
  });
}

await check('phone: the Modes sheet opened again while it closes stays open, and Escape still closes it', async (page) => {
  const more = '.modebar .modes .pill.more';
  await page.click(more);
  await page.waitForTimeout(450);
  // Both in one task, so the second press always lands inside the close. The scrim fades over the button, so the press
  // goes to the button itself.
  await page.evaluate((m) => { document.querySelector('.ms-done').click(); document.querySelector(m).click(); }, more);
  await page.waitForTimeout(600);
  const s = await page.evaluate(() => {
    const sheet = document.querySelector('.mode-sheet');
    return { hidden: sheet.hidden, open: sheet.classList.contains('open'), inert: document.getElementById('app').inert, focus: sheet.contains(document.activeElement) };
  });
  expect(!s.hidden && s.open && s.inert && s.focus, `the reopened sheet: ${JSON.stringify(s)}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
  expect(await page.isHidden('.mode-sheet'), 'Escape closes the reopened sheet');
  expect(await page.evaluate(() => [...document.body.children].every((el) => !el.inert)), 'nothing stays inert after closing');
}, true);

await check('an edit keeps the Undo: after Clear all and a new line, the toast\'s Undo brings the lines back and keeps the new one', async (page) => {
  await page.locator('.row input').first().fill('6*7');
  await page.click('.clear-all');
  expect(await page.isVisible('.toast.show button'), 'Clear all offers Undo');
  await page.keyboard.type('1+2');
  await page.waitForTimeout(100);
  await page.click('.toast.show button');
  await page.waitForTimeout(150);
  const l = await lines(page);
  expect(l.map((x) => x.text).join() === '6*7,1+2', `the toast's Undo after an edit: ${JSON.stringify(l)}`);
  await page.evaluate(() => window.slopculator.setLines(['1+2']));
  await page.locator('.row input').first().click();
  await page.keyboard.press('ControlOrMeta+Shift+Backspace');
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+Alt+z');
  await page.waitForTimeout(150);
  const l2 = await lines(page);
  expect(l2.length === 1 && l2[0].text === '1+2', `undoing the delete of the only line: ${JSON.stringify(l2)}`);
});

await check('phone: once the Undo toast is gone, a tap where it was reaches what is under it', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['6*7', '']));
  await freezeClock(page);
  await page.evaluate(() => window.slopculator.clear());
  const box = await page.locator('.toast.show button').boundingBox();
  await page.clock.runFor(10_400);
  await page.clock.resume();
  await page.waitForSelector('.toast:not(.show)', { state: 'attached', timeout: 5000 });
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const under = await page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    return { inToast: !!el?.closest('.toast'), el: el?.className, focusable: document.querySelector('.toast button')?.tabIndex };
  }, [x, y]);
  expect(!under.inToast, `the hidden toast still takes the tap: ${JSON.stringify(under)}`);
  expect(await page.evaluate(() => document.querySelector('.toast').inert), 'the hidden toast can still be reached by Tab');
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(200);
  const l = await lines(page);
  expect(!l.some((r) => r.text === '6*7'), `the tap undid the clear: ${JSON.stringify(l)}`);
}, true, { clock: true });

await check('opening a sheet or a file keeps this device\'s settings, and Undo brings back the lines it replaced', async (page) => {
  const storedUI = () => page.evaluate(() => JSON.parse(localStorage.getItem(slopKeys.document)).ui);
  await page.evaluate(() => window.slopculator.setLines(['1+1']));
  await page.click('.appear-btn');
  await page.selectOption('select.motion', 'off');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Alt+s');
  await page.waitForSelector('dialog.sheet-dialog[open]');
  await page.keyboard.type('Saved');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+Alt+Shift+n');
  await page.waitForTimeout(150);
  await page.click('.appear-btn');
  await page.selectOption('select.motion', 'reduced');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.slopculator.setLines(['2+2', 'unsaved']));
  await page.click('.menu-btn');
  await page.locator('.menu button', { hasText: 'Open "Saved"' }).click();
  await page.waitForTimeout(400);
  expect((await lines(page)).map((r) => r.text).join() === '1+1', `opened: ${JSON.stringify(await lines(page))}`);
  expect((await page.getAttribute('html', 'data-motion')) === 'reduced' && (await storedUI()).motion === 'reduced', `the sheet changed this device's motion: ${JSON.stringify(await storedUI())}`);
  await page.click('.toast.show button');
  await page.waitForTimeout(200);
  expect((await lines(page)).map((r) => r.text).join() === '2+2,unsaved', `Undo after opening: ${JSON.stringify(await lines(page))}`);
  await page.click('.menu-btn');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.menu button', { hasText: 'Import' }).click()]);
  await chooser.setFiles({ name: 'calc.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ rows: [{ id: 'a', kind: 'expr', text: '3+3' }], ui: { motion: 'off', padLeft: true, sysKeyboard: true } })) });
  await page.waitForTimeout(500);
  const ui = await storedUI();
  expect((await lines(page))[0].text === '3+3', 'the file loaded');
  expect(ui.motion === 'reduced' && !ui.padLeft && !ui.sysKeyboard, `the file changed this device's settings: ${JSON.stringify(ui)}`);
});

await check('list: a wheel that moves nothing leaves the next scroll by code unsettled', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(Array.from({ length: 30 }, (_, k) => `${k} + 1`)));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.querySelector('.rows').scrollTop = 0; });
  await page.waitForTimeout(900);
  const box = await page.locator('.rows').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(400);
  // The browser's own snapping would move it too; with it off, only settling could.
  await page.evaluate(() => { const l = document.querySelector('.rows'); l.style.scrollSnapType = 'none'; l.scrollTop = 160; });
  await page.waitForTimeout(900);
  const y = await page.evaluate(() => document.querySelector('.rows').scrollTop);
  expect(y === 160, `a scroll by code was settled to ${y}`);
});

await check('phone list: a finger on a line that goes away mid-touch still lifts', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(Array.from({ length: 12 }, (_, k) => `${k} + 1`)));
  await page.waitForTimeout(400);
  const cdp = await page.context().newCDPSession(page);
  const r = await page.locator('.rows .row').nth(1).boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }] });
  await page.evaluate(() => window.slopculator.setLines(Array.from({ length: 40 }, (_, k) => `${k} * 2`)));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
  // A list still waiting for that finger never settles, so a later scroll stays cut mid-line. Snapping would hide that.
  await page.evaluate(() => { const l = document.querySelector('.rows'); l.scrollTop = 0; l.style.scrollSnapType = 'none'; });
  await page.waitForTimeout(300);
  const box = await page.locator('.rows').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 70);
  await page.waitForTimeout(1200);
  const s = await coverState(page);
  expect(s.y > 1 && s.off <= 1.5, `the list didn't settle after the finger lifted: ${JSON.stringify(s)}`);
}, true);

await check('Reduced motion: a scroll still settles on a line, and snapping comes back only after the jump', async (page) => {
  await page.click('.appear-btn');
  await page.selectOption('select.motion', 'reduced');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.slopculator.setLines(['price = 24.99', 'tax = price * 0.0825', 'price + tax', 'y = x^2/4 - 3', 'f(x) = 2x + 1', 'normalcdf(-1, 1, 0, 1)', '[[1,2],[3,4]] * 2', 'sqrt(7^2 - 4*2*3)', 'mean({3, 5, 8, 13})', '2^10', 'nCr(7, 3)', 'sin(30)', '1/7 + 3/4', '100 * 1.05^10', '[[1,0],[0,1]]', '2 + 2', 'sqrt(2)', 'e^2', '']));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const l = document.querySelector('.rows');
    l.scrollTop = 0;
    // The browser's own snapping lands most scrolls on a line before settling has to; without it, settling does it all.
    l.style.scrollSnapType = 'none';
    // Each batch of class changes: was the list still settling after it? Added and removed in one task never shows.
    window.__settling = 0;
    new MutationObserver(() => { if (l.classList.contains('settling')) window.__settling++; }).observe(l, { attributes: true, attributeFilter: ['class'] });
  });
  await page.waitForTimeout(300);
  const box = await page.locator('.rows').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  let settled = 0;
  for (const dy of [70, 38, 95, 52, 44]) {
    await wheelToRest(page, dy);
    const s = await coverState(page);
    if (s.y > 1 && s.y < s.max - 1) {
      expect(s.off <= 1.5, `the top edge cuts a line after a ${dy}px turn: ${JSON.stringify(s)}`);
      settled++;
    }
  }
  expect(settled > 2, `the list rested mid-sheet only ${settled} times`);
  expect(await page.evaluate(() => window.__settling > 0 && !document.querySelector('.rows').classList.contains('settling')), 'snapping came back in the same task as the jump');
});

await check('one popover at a time, a line menu acts on its line where it is now, and Ctrl+Alt waits for a dialog', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['1+1', '2+2', '3+3']));
  await page.waitForTimeout(300);
  await page.click('.menu-btn');
  await page.locator('.modebar .desk-more').click();
  expect(await page.isVisible('.mode-menu') && (await page.getAttribute('.menu-btn', 'aria-expanded')) === 'false', 'the modes menu and File are both open');
  await page.locator('.rows .row').nth(2).locator('.gutter').click({ button: 'right' });
  expect(await page.isVisible('.line-menu') && await page.isHidden('.mode-menu'), 'the line menu and the modes menu are both open');
  await page.click('.appear-btn');
  expect(await page.isVisible('.appear-menu') && !(await page.$('.line-menu')), 'Appearance and the line menu are both open');
  await page.keyboard.press('Escape');
  await page.locator('.rows .row').nth(2).locator('.gutter').click({ button: 'right' });
  await page.evaluate(() => { const mac = /Mac/.test(navigator.platform); document.querySelector('.rows .expr').dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', ctrlKey: !mac, metaKey: mac, shiftKey: true, bubbles: true })); });
  await page.waitForTimeout(100);
  await page.locator('.line-menu button', { hasText: 'Move up' }).click();
  await page.waitForTimeout(150);
  expect((await lines(page)).map((r) => r.text).join() === '3+3,2+2', `Move up after line 1 went: ${JSON.stringify(await lines(page))}`);
  await page.locator('.rows .row').nth(0).locator('.gutter').click({ button: 'right' });
  await page.waitForTimeout(50);
  await page.evaluate(() => document.querySelector('.rows').dispatchEvent(new Event('scroll')));
  expect(!(await page.$('.line-menu')), 'the line menu stayed open through a scroll');
  const deg = await page.evaluate(() => window.slopculator.settings().deg);
  await page.keyboard.press('Control+Alt+s');
  await page.waitForSelector('dialog.sheet-dialog[open]');
  await page.keyboard.press('Control+Alt+d');
  expect((await page.evaluate(() => window.slopculator.settings().deg)) === deg, 'Ctrl+Alt+D ran behind the dialog');
  await page.keyboard.press('Escape');
});

await check('the system\'s reduce motion acts as Reduced: quick fades stay, and a copy flash leaves no class behind', async (page) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  expect((await page.getAttribute('html', 'data-motion')) === 'reduced', `data-motion: ${await page.getAttribute('html', 'data-motion')}`);
  const fade = await page.evaluate(() => getComputedStyle(document.querySelector('.toast')).transitionDuration);
  expect(fade.split(',').some((d) => parseFloat(d) >= 0.05), `the toast's fade was cut to nothing: ${fade}`);
  await page.keyboard.type('6*7');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+Alt+c');
  await page.waitForTimeout(1200);
  expect(!(await page.$('.copied, .shake, .row.enter')), 'an animation class stayed on with no animation to end it');
});

await check('the keypad turned around mid-fold goes back from where it is', async (page) => {
  const got = await page.evaluate(async () => {
    const k = document.querySelector('#keypad');
    const press = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true }));
    const full = k.getBoundingClientRect().height;
    press();
    while (!(k.getBoundingClientRect().height > 0 && k.getBoundingClientRect().height < full - 1)) await new Promise(requestAnimationFrame);
    const mid = k.getBoundingClientRect().height;
    press();
    return { full, mid, after: k.getBoundingClientRect().height };
  });
  expect(got.mid > 0 && got.mid < got.full && Math.abs(got.after - got.mid) < got.full * 0.15, `heights: ${JSON.stringify(got)}`);
});

await check('a change saves as the tab goes to the background, without waiting', async (page) => {
  const saved = await page.evaluate(() => {
    window.slopculator.addLine('12*3');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    return JSON.parse(localStorage.getItem(slopKeys.document) ?? '{"rows":[]}').rows.map((r) => r.text);
  });
  expect(saved.includes('12*3'), `saved: ${JSON.stringify(saved)}`);
});


await check('UX 2: choosing a function from search lights the tab that holds it', async (page) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('inverse normal');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const g = await page.evaluate(() => ({ found: document.querySelector('.ti-tab.found')?.getAttribute('aria-label'), line: window.slopculator.lines()[0].text }));
  expect(g.line.startsWith('invNorm(') && g.found === 'Stats', JSON.stringify(g));
});

await check('UX 3: deletes, clears and new sheets undo in order long after the toast, and redo', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['1', '2', '3', '']));
  await page.waitForTimeout(150);
  const del = (n) => page.evaluate((n) => document.querySelectorAll('.rows .row')[n].querySelector('.del').click(), n);
  await del(1);
  await page.mouse.move(5, 5);
  await del(0);
  await page.evaluate(() => window.slopculator.addLine(''));
  await page.locator('.rows .row').last().locator('.expr').click();
  await page.waitForTimeout(100);
  const texts = () => page.evaluate(() => window.slopculator.lines().map((l) => l.text).filter(Boolean));
  expect(JSON.stringify(await texts()) === '["3"]', `after two deletes: ${await texts()}`);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(100);
  expect(JSON.stringify(await texts()) === '["1","3"]', `one undo: ${await texts()}`);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(100);
  expect(JSON.stringify(await texts()) === '["1","2","3"]', `two undos: ${await texts()}`);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(100);
  expect(JSON.stringify(await texts()) === '["1","3"]', `redo: ${await texts()}`);
  await freezeClock(page);
  await page.keyboard.press('Control+Alt+Backspace');
  await page.clock.runFor(100);
  expect((await texts()).length === 0, 'cleared');
  await page.clock.runFor(10100);
  await page.clock.resume();
  await page.waitForSelector('.toast:not(.show)', { state: 'attached', timeout: 5000 });
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(100);
  expect(JSON.stringify(await texts()) === '["1","3"]', `undo the clear after its toast: ${await texts()}`);
  const menu = await page.evaluate(() => { document.querySelector('.menu-btn').click(); const t = [...document.querySelectorAll('.menu [role=menuitem]')].map((b) => b.textContent); document.body.click(); return t; });
  expect(menu.some((t) => t.startsWith('Undo: Deleted line')) && menu.some((t) => t.startsWith('Redo: Cleared every line')), `File's Undo and Redo: ${menu.slice(0, 3)}`);
}, false, { clock: true });

await check('UX 4: a named sheet keeps its edits, Open sees a save at once, Duplicate and Rename', async (page) => {
  page.on('dialog', (d) => d.accept());
  await page.keyboard.type('12*3');
  await page.keyboard.press('Control+Alt+s');
  await page.locator('dialog input').fill('Doc A');
  await page.locator('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await page.keyboard.press('Control+Alt+o');
  expect(await page.locator('dialog .sheet-name', { hasText: 'Doc A' }).count() === 1, 'Open right after Save is missing the sheet');
  await page.keyboard.press('Escape');
  await page.locator('.rows .row').last().locator('.expr').click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('7+5');
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+Alt+Shift+n');
  await page.waitForTimeout(150);
  const blank = await page.evaluate(() => window.slopculator.lines().map((l) => l.text).filter(Boolean));
  expect(blank.length === 0, `New sheet: ${blank}`);
  expect((await page.textContent('.toast')).includes('"Doc A" is saved'), `New sheet toast: ${await page.textContent('.toast')}`);
  await page.keyboard.press('Control+Alt+o');
  await page.locator('dialog .sheet-open', { hasText: 'Doc A' }).click();
  await page.waitForTimeout(150);
  const back = await page.evaluate(() => window.slopculator.lines().map((l) => l.text).filter(Boolean));
  expect(JSON.stringify(back) === '["12*3","7+5"]', `edits kept in Doc A: ${back}`);
  const fileItem = (name) => page.evaluate((name) => { document.querySelector('.menu-btn').click(); [...document.querySelectorAll('.menu [role=menuitem]')].find((b) => b.textContent.startsWith(name)).click(); }, name);
  await fileItem('Duplicate');
  await page.waitForTimeout(100);
  expect((await page.textContent('.sheet-title')) === 'Doc A copy', `duplicate: ${await page.textContent('.sheet-title')}`);
  await fileItem('Rename');
  await page.locator('dialog input').fill('Doc B');
  await page.locator('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
  await page.waitForTimeout(100);
  const names = await page.evaluate(() => JSON.parse(localStorage.getItem(slopKeys.sessions)).map((x) => x.name));
  expect((await page.textContent('.sheet-title')) === 'Doc B' && names.includes('Doc B') && names.includes('Doc A') && !names.includes('Doc A copy'), `rename: ${names}`);
  let asked = '';
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => { asked = d.message(); d.accept(); });
  await fileItem('Rename');
  await page.locator('dialog input').fill('Doc A');
  await page.locator('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
  await page.waitForTimeout(100);
  expect(/already called "Doc A"/.test(asked), `replace asked: ${asked}`);
});

await check('UX 5: every curve is marked, a pointer snaps to a mark, and the keyboard reads the marks', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['y = x^2 - 1.5', 'y = x', 'a = 2', '']));
  await page.locator('.rows .row').last().locator('.expr').click();
  await page.waitForTimeout(800);
  const near = await page.evaluate(() => window.slopculator.graphReadout(Math.sqrt(1.5), 0, 5, -3));
  expect(near === 'zero (1.2247, 0)', `near the root: ${near}`);
  const cross = await page.evaluate(() => window.slopculator.graphReadout((1 + Math.sqrt(7)) / 2, (1 + Math.sqrt(7)) / 2, 4, 4));
  expect(/^intersection \(1\.8229, 1\.8229\)$/.test(cross ?? ''), `the crossing: ${cross}`);
  await page.locator('.graph-host').focus();
  await page.keyboard.press(']');
  await page.waitForTimeout(80);
  const said = await page.textContent('.sr-only[role=status]');
  expect(/^(zero|min|max|y-int|intersection) \(/.test(said ?? ''), `] reads a mark: ${said}`);
  const slider = await page.getAttribute('.slider-row input[type=range]', 'aria-label');
  expect(slider === 'a', `the slider's name: ${slider}`);
});

await check('UX 6: units in words convert as typed, and a line starting with × offers ans', async (page) => {
  await page.keyboard.type('5 mi to km');
  await page.waitForTimeout(300);
  let l = await lines(page);
  expect(Math.abs(Number(l[0].result) - 8.04672) < 1e-6 && !(await page.locator('.rows .row').first().locator('.fix').count()), JSON.stringify(l[0]));
  await page.evaluate(() => window.slopculator.setLines(['3 m + 2 s', '5', '*100']));
  await page.waitForTimeout(300);
  const said = await page.locator('.rows .row').first().locator('.err').textContent();
  expect(/Length and time can't be added/.test(said) && !(await page.locator('.rows .row').first().locator('.fix').count()), `3 m + 2 s: ${said}`);
  const ans = page.locator('.rows .row').nth(2).locator('.fix');
  expect((await ans.textContent()) === 'Use ans × 100', `ans fix: ${await ans.textContent()}`);
  await ans.click();
  await page.waitForTimeout(150);
  l = await lines(page);
  expect(l[2].text === 'ans*100' && l[2].result === '500', JSON.stringify(l[2]));
  await page.evaluate(() => window.slopculator.setLines(['5 mi', 'binomial(10, 0.5, 3)']));
  await page.waitForTimeout(300);
  const fixes = await page.$$eval('.rows .fix', (els) => els.map((e) => e.textContent));
  expect(!fixes.some((f) => /min|binomvar/.test(f)), `unrelated name fixes: ${fixes}`);
});

await check('UX 7: a tab shortcut from the keys puts focus on its first tile, Tab wraps from the graph, History has the line, one × per click', async (page) => {
  await page.locator('.numpad .key').first().focus();
  await page.keyboard.press('Control+Alt+2');
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => document.activeElement?.classList.contains('ti-tile')), 'focus fell out of the keys');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  await page.locator('.graph-host').focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.modebar')), `Tab from the graph went to ${await page.evaluate(() => document.activeElement?.tagName)}`);
  await page.evaluate(() => window.slopculator.setLines(['']));
  await page.locator('.rows .row .expr').first().click();
  await page.keyboard.type('41+1');
  await page.keyboard.press('Control+Alt+y');
  await page.waitForTimeout(150);
  expect((await page.textContent('dialog')).includes('41+1'), 'History is missing the line being typed');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.slopculator.setLines(['1', '2', '3']));
  await page.waitForTimeout(150);
  const x = page.locator('.rows .row').first().locator('.del');
  await page.locator('.rows .row').first().hover();
  const b = await x.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { clickCount: 1 });
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { clickCount: 2 });
  await page.waitForTimeout(100);
  const left = await page.evaluate(() => window.slopculator.lines().map((l) => l.text));
  expect(JSON.stringify(left) === '["2","3"]', `a double-click on × deleted: ${left}`);
  // With the keys showing, the message takes the strip under them: clear of the toolbar, the lines, the keys and the graph.
  const place = () => page.evaluate(() => { const r = document.querySelector('.toast').getBoundingClientRect(), c = document.querySelector('.left').getBoundingClientRect(), tape = document.querySelector('.tape').getBoundingClientRect(), first = document.querySelector('.rows .row').getBoundingClientRect(), keys = document.querySelector('.keypad').getBoundingClientRect(), pad = document.querySelector('.pad').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cl: c.left, cr: c.right, tapeTop: tape.top, firstTop: first.top, keysTop: keys.top, padBottom: pad.bottom, keysBottom: keys.bottom, text: document.querySelector('.toast').innerText }; });
  const t = await place();
  expect(t.l >= t.cl && t.r <= t.cr && t.t >= t.padBottom && t.b <= t.keysBottom + 1, `toast under the keys: ${JSON.stringify(t)}`);
  expect(/Undo/.test(t.text) && t.text.replace('Undo', '').trim().length > 0, `the strip has room for what was done as well as Undo: ${t.text}`);
  // With the keys hidden there is no strip, so it hangs from the top of the column, never over a line.
  await page.keyboard.press('Control+Alt+Shift+K');
  await page.waitForFunction(() => document.querySelector('.keypad').hidden);
  await page.evaluate(() => window.slopculator.setLines(['2', '3']));
  const top = await place();
  expect(top.l >= top.cl && top.r <= top.cr && top.t >= top.tapeTop && top.b <= top.firstTop + 4, `toast with the keys hidden: ${JSON.stringify(top)}`);
});

await check('UX 7 phone: the keypad ) steps over the one a function put in, the toast sits above the keys, no shortcuts in the line menu', async (page) => {
  await page.locator('.rows .row .expr').first().tap();
  const tapKey = (label) => page.evaluate((label) => [...document.querySelectorAll('.keypad .key')].find((k) => k.querySelector('.kl')?.textContent.replace(/\s/g, '') === label && k.offsetParent).click(), label);
  await page.evaluate(() => document.querySelector('.keypad .key[aria-label^="sqrt"], .keypad .key[aria-label^="√"]').click());
  await tapKey('9');
  await tapKey(')');
  await page.waitForTimeout(100);
  const text = (await lines(page))[0].text;
  expect(text === '√(9)' || text === 'sqrt(9)', `after ): ${text}`);
  await page.evaluate(() => window.slopculator.setLines(['1', '2']));
  await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelectorAll('.rows .row')[0].querySelector('.del').click());
  await page.waitForTimeout(250);
  const g = await page.evaluate(() => ({ toast: document.querySelector('.toast').getBoundingClientRect().bottom, keys: document.querySelector('.keypad').getBoundingClientRect().top }));
  expect(g.toast <= g.keys - 7, `toast over the keys: ${JSON.stringify(g)}`);
  await page.evaluate(() => { const gt = document.querySelector('.rows .row .gutter'); gt.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 200 })); });
  await page.waitForTimeout(100);
  const hints = await page.$$eval('.line-menu .hint', (els) => els.map((e) => e.textContent));
  expect(hints.length === 0, `shortcut glyphs on the phone's line menu: ${hints}`);
}, true);


await check('R3 desktop: worded chips and Appearance, one quiet graph-tools group, a full-width slider, xʸ in the key face', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['y = x^2/4 - 3', 'r = 2', '']));
  await page.waitForTimeout(300);
  const g = await page.evaluate(() => {
    const bar = [...document.querySelectorAll('.desk-modes .tog')].map((b) => b.textContent.trim());
    const appear = document.querySelector('#app > .modebar .appear-btn');
    const tools = getComputedStyle(document.querySelector('.graph-tools'));
    const groups = [...document.querySelectorAll('.gt-group')].map((x) => getComputedStyle(x).backdropFilter);
    const row = document.querySelector('.slider-row'), track = row.querySelector('input[type=range]').getBoundingClientRect();
    const lo = row.querySelector('.lim.lo').getBoundingClientRect(), hi = row.querySelector('.lim.hi').getBoundingClientRect();
    const xy = [...document.querySelectorAll('.key')].find((k) => k.getAttribute('aria-label')?.startsWith('xʸ'));
    const square = document.querySelector('.graph-tools [aria-pressed]');
    return { bar, appear: appear.textContent.trim(), toolsBg: tools.backgroundColor, groups, track: track.width, gaps: [track.left - lo.right, hi.left - track.right], sup: !!xy?.querySelector('.ksup'), pressed: square ? getComputedStyle(square).color : '' };
  });
  expect(['Percent', 'Line letters', 'Complex numbers'].every((w) => g.bar.includes(w)), `the chips: ${g.bar}`);
  expect(g.appear === 'Appearance', `Appearance's word: ${g.appear}`);
  expect(g.groups.every((b) => b === 'none') && g.toolsBg !== 'rgba(0, 0, 0, 0)', `graph tools: ${JSON.stringify(g)}`);
  expect(g.track >= 120 && g.gaps.every((x) => x >= 0 && x <= 12), `the slider track and its bounds: ${JSON.stringify(g)}`);
  expect(g.sup, 'xʸ is not a superscript in the key face');
});

await check('R3 keys: one caption rule, no "above" or "move", ⌫ keeps its caption on a phone, and AC is off its keys', async (page) => {
  const g = await page.evaluate(() => {
    const cap = (label) => [...document.querySelectorAll('.keypad .key')].find((k) => k.getAttribute('aria-label')?.startsWith(label) && k.offsetParent)?.querySelector('.ks');
    const ks = [...document.querySelectorAll('.keypad .key .ks')].filter((e) => e.offsetParent);
    return { ans: !!cap('ans'), left: !!cap('←'), back: cap('⌫')?.textContent, ac: cap('AC')?.textContent, sizes: [...new Set(ks.map((e) => getComputedStyle(e).fontSize))], one: ks.every((e) => e.scrollHeight <= 14) };
  });
  expect(!g.ans && !g.left, `redundant captions: ${JSON.stringify(g)}`);
  expect(g.back === 'hold: clear' && g.ac === undefined, `⌫ and AC captions: ${JSON.stringify(g)}`);
  expect(g.sizes.length === 1 && g.one, `caption sizes: ${JSON.stringify(g)}`);
}, true);

await check('R3 phone: a short sheet fits unscrolled, no × column, a wrapped expression keeps its answer beside it', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['12*3', 'normalcdf(-1, 1, 0, 1)', '7+5', '']));
  await page.waitForTimeout(400);
  await page.locator('.rows .row').last().locator('.expr').tap();
  await page.waitForTimeout(400);
  const g = await page.evaluate(() => {
    const list = document.querySelector('.rows'), rows = [...list.querySelectorAll('.row')];
    const r1 = rows[0].getBoundingClientRect(), lr = list.getBoundingClientRect();
    const long = rows[1], src = long.querySelector('.src').getBoundingClientRect(), res = long.querySelector('.result').getBoundingClientRect();
    return { top: list.scrollTop, pad: list.style.getPropertyValue('--end-pad'), first: r1.top >= lr.top - 1, del: rows.some((r) => r.querySelector('.del')?.offsetParent), beside: (res.left >= src.right - 1 && res.top < src.bottom) || res.top >= long.querySelector('.tex').getBoundingClientRect().bottom - 2, size: getComputedStyle(long.querySelector('.result')).fontSize };
  });
  expect(g.top === 0 && g.first && (g.pad === '' || parseFloat(g.pad) === 0), `a short sheet: ${JSON.stringify(g)}`);
  expect(!g.del, 'a × column on the phone');
  expect(g.beside && g.size === '17px', `the long line's answer: ${JSON.stringify(g)}`);
}, true);


await check('UX2 1-2: a move is an undo step that never eats text, and typing comes back in bursts', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['1+1', 'sqrt(144)', '']));
  await page.waitForTimeout(200);
  await page.locator('.rows .row').nth(1).locator('.expr').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForTimeout(150);
  const texts = () => page.evaluate(() => window.slopculator.lines().map((l) => l.text).filter(Boolean));
  expect(JSON.stringify(await texts()) === '["sqrt(144)","1+1"]', `moved: ${await texts()}`);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(150);
  expect(JSON.stringify(await texts()) === '["1+1","sqrt(144)"]', `undo the move: ${await texts()}`);
  await page.locator('.rows .row').last().locator('.expr').click();
  await page.keyboard.type('12', { delay: 30 });
  await page.keyboard.type('+34', { delay: 30 });
  await page.waitForTimeout(100);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(100);
  const after1 = (await texts())[2];
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(100);
  const after2 = (await texts())[2];
  expect(after1 === '12+' && after2 === undefined, `bursts: ${after1} then ${after2}`);
  await page.evaluate(() => [...document.querySelectorAll('.numpad .key')].find((k) => k.textContent.trim() === '7').click());
  await page.waitForTimeout(100);
  expect((await texts())[2] === '7', 'the keypad 7');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(100);
  expect((await texts())[2] === undefined, `undo the keypad 7: ${await texts()}`);
});

await check('UX2 3-4: percentile means the normal percentile first, and Stats › Normal says which is which', async (page) => {
  await page.keyboard.press('Control+/');
  await page.keyboard.type('percentile');
  await page.waitForTimeout(100);
  const got = await page.$$eval('.pal-item', (els) => els.map((e) => [e.querySelector('.pal-label').textContent, e.querySelector('.pal-detail').textContent]));
  await page.keyboard.press('Escape');
  expect(got[0][0] === 'invNorm' && got[1][0] === 'zcrit' && got.some(([n]) => n === 'percentile'), `order: ${got.map((g) => g[0])}`);
  expect(got.find(([n]) => n === 'percentile')[1].startsWith('Data percentile (list)') && got[0][1].startsWith('Normal percentile (z)'), `descriptions: ${JSON.stringify(got.slice(0, 3))}`);
  expect(got.every(([n]) => !/btu|duct|psych|interest|compound/i.test(n)), `noise: ${got.map((g) => g[0])}`);
  await page.locator('.ti-tab[aria-label="Stats"]').click();
  await page.waitForTimeout(200);
  const names = () => page.$$eval('.ti-tile .ti-name', (ns) => ns.map((n) => n.textContent));
  const faces = await names();
  expect(faces.includes('invNorm') && !faces.some((f) => /^centile/.test(f)), `Normal tiles: ${JSON.stringify(faces)}`);
  await page.locator('.ti-seg', { hasText: 'Inference' }).click();
  await page.waitForTimeout(150);
  expect((await names()).includes('zcrit'), `Inference tiles: ${JSON.stringify(await names())}`);
  await page.locator('.ti-seg', { hasText: 'Normal' }).click();
  await page.locator('.ti-tile:has(.ti-name:text-is("invNorm"))').hover();
  await page.waitForTimeout(150);
  const said = await page.textContent('.key-hint');
  expect(/percentile/i.test(said), `invNorm's hint: ${said}`);
  await page.locator('.ti-close').click();
  await page.evaluate(() => window.slopculator.setLines(['percentile(0.95)']));
  await page.waitForTimeout(200);
  expect((await page.locator('.rows .row .fix').first().textContent()) === 'Use invNorm(0.95)', 'no invNorm fix for percentile(0.95)');
});

await check('UX2 5-6: the phone File menu is short, and Reorder lines moves lines, undoably', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['1', '2', '3']));
  await page.waitForTimeout(200);
  await page.locator('.menu-btn').tap();
  await page.waitForTimeout(150);
  const items = await page.$$eval('.menu [role=menuitem]', (els) => els.map((e) => e.textContent.trim()));
  expect(['New sheet', 'Open…', 'Duplicate', 'Rename…', 'Copy as text', 'History…', 'Reorder lines', 'Clear all'].every((w) => items.includes(w)), `menu: ${items}`);
  expect(!items.some((t) => /palette|shortcuts|key sounds|Number pad|Hide keypad|Hide graph/i.test(t)), `extras on a phone: ${items}`);
  await page.locator('.menu [role=menuitem]', { hasText: 'Reorder lines' }).tap();
  await page.waitForTimeout(150);
  expect(await page.isVisible('.reorder-done') && (await page.locator('.row > .reorder').count()) === 3, 'reorder mode');
  await page.locator('.rows .row').nth(2).locator('.reorder-btn[aria-label="Move up"]').tap();
  await page.waitForTimeout(150);
  const texts = () => page.evaluate(() => window.slopculator.lines().map((l) => l.text));
  expect(JSON.stringify(await texts()) === '["1","3","2"]', `moved: ${await texts()}`);
  await page.locator('.reorder-done').tap();
  await page.locator('.menu-btn').tap();
  await page.waitForTimeout(150);
  await page.locator('.menu [role=menuitem]', { hasText: /^Undo: Moved line/ }).tap();
  await page.waitForTimeout(150);
  expect(JSON.stringify(await texts()) === '["1","2","3"]', `undo the move: ${await texts()}`);
}, true);

await check('UX2 7: an unfinished line being typed is calm, and shows its error once left', async (page) => {
  await page.keyboard.type('normalcdf(');
  await page.waitForTimeout(800);
  const typing = await page.evaluate(() => { const r = document.querySelector('.rows .row'); return { err: r.classList.contains('has-error'), red: !!r.querySelector('.out .err'), sig: r.querySelector('.hint-line')?.textContent ?? '' }; });
  expect(!typing.err && !typing.red && /normalcdf/.test(typing.sig), `while typing a call: ${JSON.stringify(typing)}`);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('2*');
  await page.waitForTimeout(800);
  const op = await page.evaluate(() => { const r = document.querySelector('.rows .row'); return { err: r.classList.contains('has-error'), hint: r.querySelector('.out .calm-hint')?.textContent }; });
  expect(!op.err && op.hint === 'Unfinished: add what comes next', `while typing 2*: ${JSON.stringify(op)}`);
  const hintState = () => page.evaluate(() => { const r = document.querySelector('.rows .row'); const hint = r.querySelector('.out .calm-hint'); return { h: Math.round(r.getBoundingClientRect().height), shown: !!hint && getComputedStyle(hint).display !== 'none' }; });
  const before = await hintState();
  // (Brackets close as they're typed, so 2*(3 would be 2*(3), finished.)
  await page.keyboard.type('-');
  const during = await hintState();
  await page.keyboard.type('(');
  const during2 = await hintState();
  expect(before.shown && during.shown && during2.shown && before.h === during.h && during.h === during2.h, `the hint holds while typing on: ${JSON.stringify([before, during, during2])}`);
  await page.locator('.graph-host').click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.querySelector('.rows .row').classList.contains('has-error')), 'the error after leaving the line');
});

await check('UX2 8: tax is named, Tab on mi offers no min, keys on a finished line go to a new line, convert examples', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['total = 5', 'due = total * tax']));
  await page.waitForTimeout(300);
  const said = await page.locator('.rows .row').nth(1).locator('.err').textContent();
  expect(/tax isn't defined/.test(said) && !/depend on x|max/.test(said), `tax: ${said}`);
  await page.evaluate(() => window.slopculator.setLines(['']));
  await page.locator('.rows .row .expr').first().click();
  await page.keyboard.type('5 mi');
  await page.waitForTimeout(200);
  expect(!(await page.isVisible('.row.active .hint-line .cand')) || !(await page.textContent('.row.active .hint-line')).includes('min'), 'Tab offers min for mi');
  await page.evaluate(() => window.slopculator.setLines(['10 ft * 3', 'y = x']));
  await page.waitForTimeout(300);
  const ft = await page.locator('.rows .row').first().locator('.err').textContent();
  expect(!ft.includes('"ft", "ft"') && ft.includes('"ft", "m"'), `ft example: ${ft}`);
  await page.locator('.graph-host').focus();
  await page.locator('.ti-tab[aria-label="Math"]').click();
  await page.waitForTimeout(150);
  await page.locator('.ti-tile:has(.ti-face:text-is("x²"))').click();
  await page.waitForTimeout(150);
  const l = await lines(page);
  expect(l[1].text === 'y = x' && l.length === 3, `keys on a finished line: ${JSON.stringify(l.map((x) => x.text))}`);
});

const SIX = ['y = x^2/4 - 3', '12*3', '7+5', 'normalcdf(-1, 1, 0, 1)', 'r = 2', ''];
for (const look of ['modern', 'retro']) {
  await check(`R4 phone ${look}: the six-line example shows line 1 to 6, a 40 px toolbar, the step on the slider's line`, async (page) => {
    await setLook(page, look);
    await page.evaluate((L) => window.slopculator.setLines(L), SIX);
    // The Undo toast sits over the last line for 10 s; take it down so the tap isn't held until it fades.
    await page.evaluate(() => { const t = document.querySelector('.toast'); t.classList.remove('show'); t.inert = true; });
    await page.waitForTimeout(300);
    await page.locator('.rows .row').last().locator('.expr').tap();
    await page.waitForTimeout(500);
    const g = await page.evaluate(() => {
      const list = document.querySelector('.rows'), lr = list.getBoundingClientRect();
      const rows = [...list.querySelectorAll(':scope > .row')].map((r) => r.getBoundingClientRect());
      const slider = document.querySelector('.slider-row'), track = slider.querySelector('input[type=range]').getBoundingClientRect(), step = slider.querySelector('.lim.step').getBoundingClientRect();
      return { top: list.scrollTop, first: rows[0].top - lr.top, visible: rows.slice(0, 5).every((r) => r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1), tools: document.querySelector('.list-tools').getBoundingClientRect().height, stepLine: Math.abs((step.top + step.bottom) / 2 - (track.top + track.bottom) / 2) };
    });
    expect(g.top === 0 && g.first >= -1, `line 1 is scrolled away: ${JSON.stringify(g)}`);
    expect(g.visible, `lines 1–5 aren't all in view: ${JSON.stringify(g)}`);
    expect(Math.round(g.tools) === 40, `the toolbar is ${g.tools}px`);
    expect(g.stepLine < 6, `step isn't on the slider's line: ${JSON.stringify(g)}`);
    if (look === 'modern') {
      const words = await page.evaluate(() => [...document.querySelectorAll('.list-tools button')].filter((b) => b.offsetParent).map((b) => b.textContent.trim()).filter(Boolean));
      expect(['Line', 'Table', 'Normal curve'].every((w) => words.some((t) => t.includes(w))), `toolbar words: ${words}`);
    }
  }, true);

  await check(`R4 desktop ${look}: toggles off are ghosts and on take the accent like Keypad; Modes has ▾; Round is a chip`, async (page) => {
    await setLook(page, look);
    await page.waitForTimeout(300);
    const state = () => page.evaluate(() => {
      const pct = [...document.querySelectorAll('.desk-modes .tog')].find((b) => b.textContent.trim() === 'Percent');
      const cs = getComputedStyle(pct);
      const led = getComputedStyle(pct, '::before');
      return { pressed: pct.getAttribute('aria-pressed'), bg: cs.backgroundColor, ink: cs.color, led: `${led.backgroundColor} ${led.boxShadow}`, keypad: getComputedStyle(document.querySelector('#app > .modebar .bar-tog[aria-pressed="true"]')).backgroundColor };
    });
    const off = await state();
    if (look === 'modern') expect(off.pressed !== 'true' && off.bg === 'rgba(0, 0, 0, 0)', `Percent off isn't a ghost: ${JSON.stringify(off)}`);
    await page.evaluate(() => [...document.querySelectorAll('.desk-modes .tog')].find((b) => b.textContent.trim() === 'Percent').click());
    await page.waitForTimeout(150);
    const on = await state();
    expect(on.pressed === 'true' && (look === 'modern' ? on.bg !== off.bg : on.led !== off.led), `Percent on looks the same as off: ${JSON.stringify({ off, on })}`);
    if (look === 'modern') expect(on.bg === on.keypad, `Percent on isn't Keypad's accent: ${JSON.stringify(on)}`);
    expect(await page.isVisible('#app > .modebar .desk-more .menu-chev'), 'Modes has no ▾');
    if (look === 'modern') {
      expect((await page.textContent('.modebar .round-chip')) === 'Round: Auto', 'the Round chip text');
      await page.click('.modebar .round-chip');
      const pop = await page.evaluate(() => { const p = document.querySelector('.round-pop').getBoundingClientRect(), c = document.querySelector('.round-chip').getBoundingClientRect(); return { below: p.top - c.bottom, w: p.width, visible: p.height > 0 }; });
      expect(pop.visible && pop.below >= 0 && pop.below < 12, `the Round popover: ${JSON.stringify(pop)}`);
      await page.mouse.click(700, 500);
      expect(await page.isHidden('.round-pop'), 'a click away closes the Round popover');
    }
  });

}

// Only the narrowest desktop width can overflow.
for (const width of [1366]) {
  await check(`R4 desktop ${width}: switching look refolds the bar, so ? stays in the window`, async (page) => {
    await page.setViewportSize({ width, height: 900 });
    for (const look of ['retro', 'modern', 'retro']) {
      await setLook(page, look);
      await page.waitForTimeout(500);
      const g = await page.evaluate(() => { const b = document.querySelector('#app > .modebar'); return { over: b.scrollWidth - b.clientWidth, help: document.querySelector('#app > .modebar .help-btn').getBoundingClientRect().right }; });
      expect(g.over <= 1 && g.help <= width, `${look}: the bar overflows: ${JSON.stringify(g)}`);
    }
  });
}

const texts = async (page) => (await lines(page)).map((l) => l.text);
await check('UX3 1: an empty palette offers functions first, so Enter inserts and never clears the sheet', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['12*3', '7+5', '']));
  await page.locator('.rows .row').last().locator('.expr').click();
  await page.keyboard.press('Control+/');
  await page.waitForTimeout(100);
  const first = await page.$$eval('.pal-item', (els) => els.slice(0, 12).map((e) => [e.querySelector('.pal-tag').textContent, e.querySelector('.pal-label').textContent]));
  expect(first[0][0] === 'f(x)' && first.every(([, l]) => !/^Clear|^New sheet/.test(l)), `empty palette: ${JSON.stringify(first)}`);
  const detail = await page.$$eval('.pal-item', (els) => els.find((e) => e.querySelector('.pal-label').textContent === 'Clear every line')?.querySelector('.pal-detail').textContent);
  expect(!/few seconds/.test(detail ?? ''), `stale Clear description: ${detail}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const t = await texts(page);
  expect(t[0] === '12*3' && t[1] === '7+5', `Enter on an empty palette changed the sheet: ${JSON.stringify(t)}`);
});

await check('UX3 1: a slider drag is one undo step; Ctrl/⌘Z after it never eats typing on another line', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['a = 1', '78', '']));
  await page.waitForTimeout(300);
  const box = await page.locator('.slider-row input[type=range]').first().boundingBox();
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(box.x + 4 + k * 12, box.y + box.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const dragged = (await texts(page))[0];
  expect(dragged !== 'a = 1', `the drag didn't move a: ${dragged}`);
  await page.locator('.rows .row').nth(1).locator('.expr').click();
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(200);
  const t = await texts(page);
  expect(t[0] === 'a = 1' && t[1] === '78', `undo after a drag: ${JSON.stringify(t)}`);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(200);
  expect((await texts(page))[0] === dragged, 'redo puts the drag back');
});

await check('UX3 1: a Fix during a keyboard slider\'s wait is undone before the slider', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['a = 1', 'normcdf(1)']));
  await page.waitForTimeout(300);
  await page.focus('.slider-row input[type=range]');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(50);
  const slid = (await texts(page))[0];
  expect(slid !== 'a = 1', `the key didn't move a: ${slid}`);
  await page.evaluate(() => document.querySelectorAll('.rows .row')[1].querySelector('.fix').click());
  await page.waitForTimeout(100);
  expect((await texts(page))[1] === 'normalcdf(1)', 'the Fix changed the line');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(200);
  const t = await texts(page);
  expect(t[0] === slid && t[1] === 'normcdf(1)', `undo took the wrong step first: ${JSON.stringify(t)}`);
});

await check('UX3 1: during a keyboard slider\'s wait the toast\'s Undo can\'t skip over the slider', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['a = 1', '7']));
  await page.waitForTimeout(300);
  await page.locator('.rows .row').nth(1).locator('.expr').click();
  await page.keyboard.press('ControlOrMeta+Shift+Backspace');
  await page.waitForTimeout(100);
  expect((await texts(page)).length === 1 && await page.isVisible('.toast.show button'), 'the delete offers Undo');
  await page.focus('.slider-row input[type=range]');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(50);
  const slid = (await texts(page))[0];
  expect(slid !== 'a = 1', `the key didn't move a: ${slid}`);
  await page.evaluate(() => document.querySelector('.toast.show button').click());
  await page.waitForTimeout(100);
  const t = await texts(page);
  expect(t.length === 1 && t[0] === slid, `the toast undid an older step: ${JSON.stringify(t)}`);
});

await check('UX3 1: Rename hands focus back to the line, and Clear all with a slider throws nothing', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['a = 2', 'y = a x', '(a, a)', '']));
  await page.locator('.rows .row').last().locator('.expr').click();
  await page.keyboard.press('Control+Alt+s');
  await page.waitForTimeout(200);
  await page.keyboard.type('Unit 3');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  for (const how of ['Enter', 'Escape']) {
    await page.evaluate(() => [...document.querySelectorAll('.menu button')].find((b) => b.textContent.startsWith('Rename')).click());
    await page.waitForTimeout(200);
    if (how === 'Enter') { await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('Unit 4'); }
    await page.keyboard.press(how);
    await page.waitForTimeout(350);
    const focus = await page.evaluate(() => document.activeElement?.classList.contains('expr'));
    expect(focus, `after Rename (${how}) focus is on ${await page.evaluate(() => document.activeElement?.className)}`);
  }
  await page.keyboard.press('Control+Alt+Backspace');
  await page.waitForTimeout(300);
  expect((await texts(page)).every((t) => !t), 'Clear all cleared');
});

// definitionInsert is unit-tested and the tile handler is shared, so the desktop covers the phone.
for (const phone of [false]) {
  await check(`UX3 1: ${phone ? 'phone' : 'desktop'} Math › Graph's a = types plain a on a line with =, the definition on a fresh line`, async (page) => {
    await page.evaluate(() => window.slopculator.setLines(['y = ']));
    await page.locator('.rows .row .expr').first().click();
    await page.evaluate(() => { const i = document.querySelector('.rows .row .expr'); i.setSelectionRange(4, 4); });
    const hit = (l) => (phone ? l.tap() : l.click());
    const press = async () => {
      await hit(page.locator('.ti-tab[aria-label="Math"]'));
      await page.waitForTimeout(250);
      await hit(page.locator('.ti-seg', { hasText: 'Graph' }));
      await page.waitForTimeout(100);
      await hit(page.locator('.ti-tile:has(.ti-face:text-is("a ="))'));
    };
    await press();
    await page.waitForTimeout(100);
    expect((await texts(page))[0] === 'y = a', `y = then a =: ${(await texts(page))[0]}`);
    await page.evaluate(() => window.slopculator.setLines(['']));
    await page.locator('.rows .row .expr').first().click();
    await press();
    await page.waitForTimeout(100);
    expect((await texts(page))[0] === 'a = ', `a = on a fresh line: ${(await texts(page))[0]}`);
  }, phone);
}

await check('UX3 2-3: "per" and "z for" match tightly, and a second search starts a new line after an answer', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['5', 'ans*100']));
  await page.locator('.rows .row').nth(1).locator('.expr').click();
  await page.keyboard.press('End');
  const search = async (q) => {
    await page.keyboard.press('Control+/');
    await page.keyboard.type(q);
    await page.waitForTimeout(100);
    return page.$$eval('.pal-item', (els) => els.map((e) => e.querySelector('.pal-label').textContent));
  };
  const per = await search('per');
  await page.keyboard.press('Escape');
  expect(per.length < 12 && !per.includes('oapercent'), `per: ${per}`);
  const zfor = await search('z for');
  const zfns = await page.$$eval('.pal-item', (els) => els.filter((e) => e.querySelector('.pal-tag').textContent === 'f(x)').map((e) => e.querySelector('.pal-label').textContent));
  expect(zfns.join() === 'invNorm,zcrit' && zfor[0] === 'invNorm', `z for: ${zfor}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const t = await texts(page);
  expect(t[1] === 'ans*100' && t[2]?.startsWith('invNorm('), `search into a finished line: ${JSON.stringify(t)}`);
  const tip = await search('tip');
  await page.keyboard.press('Escape');
  expect(!tip.some((n) => /^Round/.test(n)), `tip: ${tip}`);
});

await check('UX3 5: Tab from a line with a fix goes to the fix; Ctrl/⌘+Enter applies the only one', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['5', 'sqroot(16)']));
  await page.locator('.rows .row').nth(1).locator('.expr').click();
  await page.keyboard.press('End');
  await page.waitForTimeout(1300);
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.classList.contains('fix') ? document.activeElement.textContent : document.activeElement?.className);
  expect(/sqrt|Use/.test(focused ?? ''), `Tab went to ${focused}`);
  const title = await page.evaluate(() => document.activeElement?.title);
  expect(/Enter|↩/.test(title ?? ''), `the fix's title: ${title}`);
  await page.locator('.rows .row').nth(1).locator('.expr').click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.waitForTimeout(200);
  expect((await texts(page))[1] === 'sqrt(16)', `Ctrl+Enter: ${(await texts(page))[1]}`);
});

await check('A heading line draws no grey slots, and a call on an ordinary line does', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['binompdf(', '# binompdf(']));
  const slotsOf = async (n) => {
    await page.locator('.rows .row').nth(n).locator('.expr').click();
    await page.keyboard.press('End');
    await page.waitForTimeout(100);
    return page.evaluate((k) => document.querySelectorAll('.rows .row')[k].querySelector('.slots:not([hidden])')?.textContent ?? null, n);
  };
  const line = await slotsOf(0);
  expect(line === 'binompdf(n, p, k', `the ordinary line: ${line}`);
  const heading = await slotsOf(1);
  expect(heading === null, `the heading: ${heading}`);
});

await check('The line menu\'s Copy result copies what Ctrl+Alt+C copies: a shaded curve\'s probability, nothing from an unshaded one', async (page) => {
  await page.click('.starter-card');
  await page.waitForTimeout(400);
  const k = await page.evaluate(() => [...document.querySelectorAll('.rows .row')].findIndex((r) => r.querySelector('.dist-prob:not([hidden])')));
  expect(k >= 0, 'no shaded curve');
  const copyItem = async () => {
    await page.locator('.rows .row').nth(k).locator('.gutter').click({ button: 'right' });
    return page.locator('.line-menu button', { hasText: 'Copy result' });
  };
  await (await copyItem()).click();
  await page.waitForTimeout(100);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const probability = (await lines(page)).find((x) => x.probability)?.probability;
  expect(Math.abs(Number(copied) - probability) < 1e-6, `copied ${copied}, the probability is ${probability}`);
  await page.locator('.rows .row').nth(k).locator('.cdf').click();
  await page.waitForTimeout(150);
  const item = await copyItem();
  expect(await item.isDisabled(), 'an unshaded curve still offers Copy result');
  await page.keyboard.press('Escape');
});

await check('Every digit: only a run of digits is a long answer, not scientific notation or a matrix', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['2^1000*sqrt(2)', '[[2^70, 1], [1, 1]]', '2^1000', '']));
  await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll('.mode-sheet [role=radio]')].find((x) => x.textContent.includes('Every digit')).click());
  await page.waitForTimeout(400);
  const long = await page.$$eval('.rows .row .out', (els) => els.slice(0, 3).map((e) => e.classList.contains('long-answer')));
  expect(long[0] === false && long[1] === false && long[2] === true, `long answers: ${long}`);
  const cue = await page.$$eval('.rows .row', (els) => !!els[0].querySelector('.long-cue') || !!els[0].querySelector('.val[role=region]'));
  expect(!cue, 'scientific notation got the scrolling box');
}, true);

// The 375 px phone checks sweep every tile; the desktop's tile in one look is left.
for (const [where, phone] of [['desktop', false]]) for (const look of ['modern']) {
  await check(`Final 1: ${where} ${look}: the inverse-normal tile reads invNorm whole, its label normal percentile`, async (page) => {
    await setLook(page, look);
    if (phone) await tapTab(page, 'Stats');
    else { await page.locator('.ti-tab[aria-label="Stats"]').click(); await page.waitForTimeout(250); }
    const t = await page.evaluate(() => { const tile = [...document.querySelectorAll('.ti-tile')].find((x) => x.querySelector('.ti-name').textContent === 'invNorm'); const n = tile.querySelector('.ti-name'); return { face: tile.querySelector('.ti-face').textContent, fits: n.scrollWidth <= n.clientWidth + 1, size: parseFloat(getComputedStyle(n).fontSize), label: tile.getAttribute('aria-label') }; });
    expect(t.face === 'area → z' && t.fits && t.size >= (phone ? 9 : 11), `the tile: ${JSON.stringify(t)}`);
    expect(/normal percentile/.test(t.label), `its label: ${t.label}`);
  }, phone);
}

await check('UX3 8: the phone File menu shares the sheet as text where it can', async (page) => {
  await page.evaluate(() => { navigator.share = (d) => { window.__shared = d; return Promise.resolve(); }; window.slopculator.setLines(['12*3', '']); });
  await page.evaluate(() => document.querySelector('.menu-btn').click());
  await page.waitForTimeout(200);
  await page.evaluate(() => [...document.querySelectorAll('.menu button')].find((b) => b.textContent.startsWith('Share'))?.click());
  await page.waitForTimeout(200);
  const shared = await page.evaluate(() => window.__shared);
  expect(shared && /12\*3/.test(shared.text) && !/\n2\. ?$/.test(shared.text), `shared: ${JSON.stringify(shared)}`);
}, true);

// Copy as text is in test/parity-shared.test.ts.
await check('UX3 9: ⌃⌥S says Saved; Open list takes arrows', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['12*3', '7+5', '']));
  await page.locator('.rows .row .expr').first().click();
  await page.keyboard.press('Control+Alt+s');
  await page.waitForTimeout(150);
  await page.keyboard.type('One');
  await page.keyboard.press('Enter');
  // The first save's own "Saved" toast goes before the second is read.
  await page.waitForSelector('.toast:not(.show)', { state: 'attached' });
  await page.evaluate(() => { document.querySelector('.toast').textContent = ''; });
  await page.keyboard.press('Control+Alt+s');
  await page.waitForTimeout(150);
  expect(/Saved/.test(await page.textContent('.toast')), 'Ctrl+Alt+S on a named sheet says Saved');
  await page.evaluate(() => window.slopculator.setLines(['1']));
  await page.keyboard.press('Control+Alt+Shift+n');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+Alt+s');
  await page.waitForTimeout(150);
  await page.keyboard.type('Two');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+Alt+o');
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => document.activeElement.querySelector('.sheet-name')?.textContent);
  await page.keyboard.press('ArrowDown');
  const after = await page.evaluate(() => document.activeElement.querySelector('.sheet-name')?.textContent);
  expect(before && after && before !== after, `Open list arrows: ${before} → ${after}`);
  await page.keyboard.press('Escape');
});

for (const look of ['modern', 'retro']) {
  await check(`R5 phone ${look}: a line that fits the row stays on one line, its answer beside it or right-aligned under it`, async (page) => {
    await setLook(page, look);
    await page.evaluate(() => window.slopculator.setLines(['12*3', 'normalcdf(-1, 1, 0, 1)', 'normalcdf(-1.96, 1.96, 100, 15) + normalcdf(2, 3, 0, 1)', '']));
    await page.locator('.rows .row').last().locator('.expr').tap();
    await page.waitForTimeout(400);
    const g = await page.evaluate(() => [1, 2].map((i) => {
      const r = document.querySelectorAll('.rows .row')[i], tex = r.querySelector('.tex'), t = tex.getBoundingClientRect(), out = r.querySelector('.out .result').getBoundingClientRect(), line = r.querySelector('.line').getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(tex).lineHeight);
      return { lines: Math.round(t.height / lh), beside: out.top < t.bottom - 4 && out.left > t.right, under: out.top >= t.bottom - 2 && Math.abs(out.right - line.right) < 3, text: tex.textContent };
    }));
    expect(g[0].lines === 1 && (g[0].beside || g[0].under), `${look}: normalcdf(−1, 1, 0, 1): ${JSON.stringify(g[0])}`);
    expect(g[1].under, `${look}: a line longer than the row puts its answer under it: ${JSON.stringify(g[1])}`);
  }, true);
}

await check('R5 phone: Find is its own 34 px round well (44 px to a thumb), File its own word pill', async (page) => {
  const g = await page.evaluate(() => {
    const f = document.querySelector('.head-find'), m = document.querySelector('.head-pill .menu-btn');
    const fr = f.getBoundingClientRect(), mr = m.getBoundingClientRect(), after = getComputedStyle(f, '::after');
    return { w: fr.width, h: fr.height, radius: getComputedStyle(f).borderRadius, gap: mr.left - fr.right, fileBg: getComputedStyle(m).backgroundColor, findBg: getComputedStyle(f).backgroundColor, pillBg: getComputedStyle(document.querySelector('.head-pill')).backgroundColor, hit: fr.height - 2 * parseFloat(after.top) };
  });
  expect(Math.round(g.w) === 34 && Math.round(g.h) === 34 && g.radius === '50%', `Find's circle: ${JSON.stringify(g)}`);
  expect(g.gap >= 6 && g.pillBg === 'rgba(0, 0, 0, 0)' && g.fileBg !== 'rgba(0, 0, 0, 0)', `Find and File apart: ${JSON.stringify(g)}`);
  expect(g.hit >= 44, `Find's hit area: ${JSON.stringify(g)}`);
}, true);

for (const [where, phone] of [['desktop', false], ['phone', true]]) for (const look of ['modern', 'retro']) {
  await check(`R5 ${where} ${look}: every key row's labels on one line, ⌫ with the digits on the desktop, two-line faces clear of the cap's top`, async (page) => {
    await setLook(page, look);
    await page.waitForTimeout(400);
    const g = await page.evaluate(() => {
      const rows = new Map();
      const tops = [];
      for (const k of document.querySelectorAll('.key')) {
        const kr = k.getBoundingClientRect();
        // A Thumb Index tab carries its glyph over its word, by design, as on iOS.
        if (!k.offsetParent || k.classList.contains('ti-tab') || kr.right < 0 || kr.left > innerWidth || kr.width < 5 || kr.height > 80) continue;
        const l = k.querySelector('.kl').getBoundingClientRect();
        const key = Math.round(kr.top);
        rows.set(key, [...(rows.get(key) ?? []), { k: (k.getAttribute('aria-label') || '').slice(0, 8), c: l.top + l.height / 2 - kr.top }]);
        if (k.querySelector('.kl.two')) tops.push({ k: k.getAttribute('aria-label').slice(0, 8), top: l.top - kr.top });
      }
      const weights = [...document.querySelectorAll('.key .ks')].filter((s) => s.offsetParent && getComputedStyle(s).display !== 'none').map((s) => getComputedStyle(s).fontWeight);
      return { rows: [...rows.values()], tops, weights };
    });
    for (const r of g.rows) {
      const cs = r.map((x) => x.c);
      expect(Math.max(...cs) - Math.min(...cs) < 1.5, `labels off one line: ${JSON.stringify(r)}`);
    }
    expect(g.tops.every((t) => t.top >= 3.5), `a two-line face near the cap's top: ${JSON.stringify(g.tops)}`);
    // Only the phone's ⌫ has a caption now: AC's "all lines" went, and the desktop hides ⌫'s.
    expect((!phone || g.weights.length) && g.weights.every((w) => w === '400'), `captions in the regular weight: ${g.weights}`);
  }, phone);
}

for (const [where, phone] of [['desktop', false], ['phone', true]]) {
  await check(`R5 ${where}: a slider's bounds are as wide as their numbers; step and its value sit together, the value underlined`, async (page) => {
    await page.evaluate(() => window.slopculator.setLines(['a = 3', '']));
    await page.waitForTimeout(400);
    const g = await page.evaluate(() => {
      const row = document.querySelector('.slider-row'), r = (q) => row.querySelector(q).getBoundingClientRect();
      const lo = r('.lim.lo'), hi = r('.lim.hi'), lab = r('.step-label'), st = r('.lim.step'), track = r('input[type=range]');
      const cs = getComputedStyle(row.querySelector('.lim.step'));
      return { lo: lo.width, hi: hi.width, gap: st.left - lab.right, step: st.width, rule: cs.borderBottomWidth, track: track.width, row: row.getBoundingClientRect().width };
    });
    expect(g.lo < 40 && g.hi < 40, `bounds: ${JSON.stringify(g)}`);
    expect(g.gap >= 2 && g.gap <= 8 && Math.round(g.step) === 44 && g.rule === '1px', `step: ${JSON.stringify(g)}`);
    expect(g.track > g.row * 0.45, `the track: ${JSON.stringify(g)}`);
  }, phone);
}

await check('UX4 1: the "Use ans ×" chip is there at once; Tab, Ctrl/⌘+Enter and Enter take it; undo to a bare * clears it', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['5', '']));
  await page.locator('.rows .row').nth(1).locator('.expr').click();
  await freezeClock(page);
  await page.keyboard.type('*100');
  await page.clock.runFor(120);
  const chip = await page.evaluate(() => { const b = document.querySelectorAll('.rows .row')[1].querySelector('.fix.calm-fix'); return b && b.offsetParent ? b.textContent : null; });
  await page.clock.resume();
  expect(chip && /ans/.test(chip), `the chip 120 ms after typing: ${chip}`);
  await page.keyboard.press('Tab');
  // .fix, not .calm-fix: leaving the line rebuilds the chip without its calm class, and focus moves to the new one.
  expect(await page.evaluate(() => document.activeElement?.classList.contains('fix')), 'Tab reaches the chip at once');
  await page.locator('.rows .row').nth(1).locator('.expr').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const t = (await lines(page)).map((l) => l.text);
  expect(t[1] === 'ans*100' && t.length === 3, `Enter takes the offer: ${JSON.stringify(t)}`);
  await page.locator('.rows .row').nth(1).locator('.expr').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('*');
  await page.waitForTimeout(150);
  expect(!(await page.evaluate(() => !!document.querySelectorAll('.rows .row')[1].querySelector('.fix'))), 'a bare * keeps a stale chip');
}, false, { clock: true });

// 12 000's two readings are in test/fixes.test.ts.
await check('UX4 4: , and = keys add no spaces; the reader hears what shows', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['']));
  await page.locator('.rows .row .expr').first().click();
  for (const label of ['2', ',', '3', '=']) await page.evaluate((l) => [...document.querySelectorAll('.numpad .key')].find((k) => (k.getAttribute('aria-label') || '').split(/[:.]/)[0].trim() === l || k.getAttribute('aria-label') === l).click(), label);
  await page.waitForTimeout(100);
  expect((await lines(page))[0].text === '2,3=', `keys typed: ${(await lines(page))[0].text}`);
  await page.evaluate(() => window.slopculator.setLines(['5', '']));
  await page.locator('.rows .row').nth(1).locator('.expr').click();
  await page.keyboard.type('*100');
  await page.waitForTimeout(1000);
  const heard = await page.evaluate(() => document.querySelector('[role=status][aria-live]')?.textContent ?? '');
  expect(!/Unexpected/.test(heard) && /ans/.test(heard), `announced: ${heard}`);
});

await check('The screen reader says what the line shows', async (page) => {
  const heard = () => page.evaluate(() => document.querySelector('[role=status][aria-live]')?.textContent ?? '');
  const type = async (text, ...keys) => {
    await page.evaluate(() => window.slopculator.setLines(['']));
    await page.locator('.rows .row .expr').first().click();
    await page.keyboard.type(text);
    for (const key of keys) await page.keyboard.press(key);
    await page.waitForTimeout(1000);
    return heard();
  };
  const answer = await type('2 + 2');
  expect(answer === 'Line 1 equals 4', `an answer: ${answer}`);
  const warned = await type('1234 567');
  expect(/^Line 1 equals 699678\. Check this: 1234 567 multiplies/.test(warned), `a warning after the answer: ${warned}`);
  const skipped = await type('normaldist(0, 1)');
  expect(skipped === warned, `a distribution isn't said: ${skipped}`);
  const slot = await type('nCr(1, ');
  expect(/^Line 1: nCr\(n, r\)/.test(slot), `an empty slot says the usage: ${slot}`);
  const unfinished = await type('nCr(1, ', 'End');
  expect(unfinished === 'Line 1: Unfinished: add what comes next', `an unfinished line isn't an error: ${unfinished}`);
});

await check('UX4 4: Mac labels, a fresh ⌘/ then Enter does nothing, AC says ⌘Z, percent skips oapercent', async (page) => {
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  await page.evaluate(() => window.slopculator.setLines(['12*3', '']));
  await page.locator('.rows .row').last().locator('.expr').click();
  await page.keyboard.type('7');
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('.menu-btn').click());
  await page.waitForTimeout(200);
  const undoHint = await page.evaluate(() => [...document.querySelectorAll('.menu button')].find((b) => b.textContent.startsWith('Undo'))?.textContent ?? '');
  await page.keyboard.press('Escape');
  await page.locator('.rows .row').last().locator('.expr').click();
  expect(mac ? /⌘Z/.test(undoHint) && !/⌃Z/.test(undoHint) : /Ctrl\+Z/.test(undoHint), `Undo's label: ${undoHint}`);
  await page.evaluate(() => { try { localStorage.removeItem(slopKeys.recentFunctions); } catch {} });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Control+/');
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => !document.querySelector('.pal-item.sel')), 'a fresh palette selects nothing');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  const t = (await lines(page)).map((l) => l.text);
  expect(!t.some((x) => x.includes('ln(')), `Enter on a fresh palette inserted: ${JSON.stringify(t)}`);
  const ac = await page.evaluate(() => document.querySelector('.key.desk-ac')?.getAttribute('aria-label') ?? '');
  expect(/brings them back/.test(ac) && !/appears after/.test(ac), `AC: ${ac}`);
  await page.keyboard.press('Control+/');
  await page.keyboard.type('percent');
  await page.waitForTimeout(150);
  const got = await page.$$eval('.pal-item .pal-label', (els) => els.map((e) => e.textContent));
  await page.keyboard.press('Escape');
  expect(!got.includes('oapercent'), `percent: ${got}`);
});

await check('UX4 4: Share that fails copies the sheet and says so', async (page) => {
  await page.evaluate(() => { navigator.share = () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })); window.slopculator.setLines(['12*3', '']); });
  await page.evaluate(() => document.querySelector('.menu-btn').click());
  await page.waitForTimeout(200);
  await page.evaluate(() => [...document.querySelectorAll('.menu button')].find((b) => b.textContent.startsWith('Share'))?.click());
  await page.waitForTimeout(400);
  expect(/Sharing unavailable. Sheet copied./.test(await page.textContent('.toast')), `toast: ${await page.textContent('.toast')}`);
}, true);

await check('Final 5: the keypad\'s enter takes the "Use ans ×" offer, as the keyboard\'s does', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['5', '']));
  await page.locator('.rows .row').nth(1).locator('.expr').click();
  await page.keyboard.type('*100');
  await page.waitForTimeout(150);
  await page.evaluate(() => [...document.querySelectorAll('.numpad .key')].find((k) => (k.getAttribute('aria-label') || '').startsWith('enter')).click());
  await page.waitForTimeout(200);
  const t = (await lines(page)).map((l) => l.text);
  expect(t[1] === 'ans*100' && t.length === 3, `keypad enter: ${JSON.stringify(t)}`);
});

await check('Final 7: the phone Graph tab has a slider for each variable its curves use; a drag is one undo step', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['a = 2', 'c = 5', 'y = a x', '']));
  await page.waitForTimeout(300);
  await page.locator('.nav-view', { hasText: 'Graph' }).tap();
  await page.waitForTimeout(500);
  const names = await page.$$eval('.gs-row .gs-name', (els) => els.map((e) => e.textContent));
  expect(names.join() === 'a', `sliders: ${names}`);
  await page.evaluate(() => { const r = document.querySelector('.gs-row input'); for (const v of ['3', '4', '5']) { r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); } r.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(900);
  expect((await lines(page))[0].text === 'a = 5', `after the drag: ${(await lines(page))[0].text}`);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(200);
  expect((await lines(page))[0].text === 'a = 2', `undo: ${(await lines(page))[0].text}`);
}, true);

await check('Final bugs (phone): a long-press line menu stays open on lift; ⌫ on an empty line takes it away', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['12*3', '7+5', '']));
  await page.waitForTimeout(300);
  const box = await page.locator('.rows .row').first().locator('.gutter').boundingBox();
  await page.evaluate(({ x, y }) => { const g = document.elementFromPoint(x, y).closest('.gutter'); g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: x, clientY: y })); }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.waitForTimeout(500);
  await page.evaluate(({ x, y }) => { const g = document.elementFromPoint(x, y); g.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })); g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y })); }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => !!document.querySelector('.line-menu, .menu.line, [role=menu].line-menu') || [...document.querySelectorAll('[role=menu]')].some((m) => m.offsetParent && /Duplicate/.test(m.textContent))), 'the line menu closed on lift');
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('.graph-pane, .keys, body').dispatchEvent(new Event('touchstart', { bubbles: true })));
  await page.waitForTimeout(300);
  await page.locator('.rows .row').last().locator('.expr').tap();
  await page.evaluate(() => [...document.querySelectorAll('.numpad .key')].find((k) => (k.getAttribute('aria-label') || '').startsWith('⌫')).click());
  await page.waitForTimeout(200);
  const t = (await lines(page)).map((l) => l.text);
  expect(t.join('|') === '12*3|7+5', `⌫ on an empty line: ${JSON.stringify(t)}`);
  expect(await page.evaluate(() => { const a = document.activeElement; return a?.classList.contains('expr') && a.value === '7+5' && a.selectionStart === a.value.length; }), 'the caret goes to the end of the line above');
}, true);

const pctResult = async (page) => (await lines(page))[0].result;
await check('Percent: desktop Modes flips 80 + 15% between 92 (of x, the default) and 80.15 (÷ 100)', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['80 + 15%', '80 * 15%', '']));
  await page.waitForTimeout(200);
  expect((await pctResult(page)) === '92', `default: ${await pctResult(page)}`);
  expect((await page.evaluate(() => window.slopculator.settings().percentOf)) === true, 'percentOf starts on');
  await page.click('.modebar .desk-more');
  const row = page.locator('.mode-menu .pct-row');
  expect(await row.isVisible(), 'the Adding a percent row is in Modes');
  expect((await row.locator('span').first().textContent()) === '80 + 15% =', 'its label is the example');
  expect((await row.locator('button', { hasText: '92' }).getAttribute('aria-pressed')) === 'true', '92 is pressed');
  await row.locator('button', { hasText: '80.15' }).click();
  await page.waitForTimeout(200);
  const after = await lines(page);
  expect(after[0].result === '80.15' && after[1].result === '12', `÷ 100: ${JSON.stringify(after.map((l) => l.result))}`);
  await row.locator('button', { hasText: '92' }).click();
  await page.waitForTimeout(200);
  expect((await pctResult(page)) === '92', `back to of x: ${await pctResult(page)}`);
  expect(await page.evaluate(() => document.querySelector('.rows .row').textContent.includes('15% of 80 added')), 'the line notes 15% of 80 added');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+/');
  await page.waitForTimeout(150);
  await page.keyboard.type('Percent: of the number');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect((await pctResult(page)) === '80.15', `palette: ${await pctResult(page)}`);
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForTimeout(400);
  expect((await pctResult(page)) === '80.15' && (await page.evaluate(() => window.slopculator.settings().percentOf)) === false, 'a reload keeps As a number');
});

await check('Percent: phone Modes sheet\'s "Adding a percent" flips 80 + 15% between 92 and 80.15', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['80 + 15%', '']));
  await page.waitForTimeout(200);
  expect((await pctResult(page)) === '92', `default: ${await pctResult(page)}`);
  await page.locator('.modebar .modes .pill.more').tap();
  await page.waitForTimeout(450);
  const group = page.locator('.mode-sheet .choice[aria-label="Adding a percent"]');
  const opts = await group.locator('[role=radio]').allTextContents();
  expect(JSON.stringify(opts) === '["Of the number80 + 15% = 92","As a number80 + 15% = 80.15"]', `options: ${JSON.stringify(opts)}`);
  await group.locator('[role=radio]').nth(1).tap();
  await page.waitForTimeout(200);
  expect((await pctResult(page)) === '80.15' && (await group.locator('[role=radio]').nth(1).getAttribute('aria-checked')) === 'true', `as a number: ${await pctResult(page)}`);
  await group.locator('[role=radio]').nth(0).tap();
  await page.waitForTimeout(200);
  expect((await pctResult(page)) === '92', `of the number: ${await pctResult(page)}`);
  await page.locator('.mode-sheet').screenshot({ path: '.shots/e2e-percent-phone-sheet.png' });
}, true);

// A bigger window is never tighter, and audit-e2e covers 761 × 560.
for (const [w, h] of [[1280, 800]]) for (const look of ['modern', 'retro']) {
  await check(`D2 desktop ${w}×${h} ${look}: File, Appearance and Modes open over the page and work with the mouse and the keys`, async (page) => {
    await page.setViewportSize({ width: w, height: h });
    await setLook(page, look);
    await page.waitForTimeout(300);
    const over = (q) => page.evaluate((q) => {
      const m = document.querySelector(q);
      if (!m || m.hidden) return { shown: false };
      const r = m.getBoundingClientRect();
      const pts = [[r.left + 20, r.top + 20], [r.left + r.width / 2, r.top + Math.min(r.height - 10, 120)]];
      return { shown: r.height > 40 && r.width > 100, mine: pts.every(([x, y]) => m.contains(document.elementFromPoint(x, y))), inWindow: r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5 };
    }, q);
    await page.click('.modebar .menu-btn');
    await page.waitForTimeout(150);
    let o = await over('.menu-wrap:not(.appear-wrap) > .menu');
    expect(o.shown && o.mine && o.inWindow, `File: ${JSON.stringify(o)}`);
    await page.keyboard.press('Escape');
    expect(await page.isHidden('.menu-wrap:not(.appear-wrap) > .menu'), 'Esc leaves File open');
    await page.focus('.modebar .menu-btn');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('role') === 'menuitem'), 'ArrowDown on File put focus elsewhere');
    await page.keyboard.press('Escape');
    await page.click('.modebar .appear-btn');
    await page.waitForTimeout(150);
    o = await over('.appear-menu');
    expect(o.shown && o.mine && o.inWindow, `Appearance: ${JSON.stringify(o)}`);
    await page.keyboard.press('Escape');
    await page.focus('.modebar .appear-btn');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => !!document.activeElement?.closest('.appear-menu')), 'ArrowDown on Appearance put focus elsewhere');
    await page.keyboard.press('Escape');
    await page.click('.modebar .desk-more');
    await page.waitForTimeout(150);
    o = await over('.mode-menu');
    expect(o.shown && o.mine && o.inWindow, `Modes: ${JSON.stringify(o)}`);
    await page.keyboard.press('Escape');
    expect(await page.isHidden('.mode-menu'), 'Esc leaves Modes open');
  });
}

await check('D2 desktop: Find sits on the bar beside File at its height; it, ⌘K / Ctrl+K and ⌘/ open the palette', async (page) => {
  const g = await page.evaluate(() => { const f = document.querySelector('.modebar .head-find').getBoundingClientRect(), m = document.querySelector('.modebar .menu-btn').getBoundingClientRect(); return { f: f.toJSON(), m: m.toJSON(), text: document.querySelector('.modebar .head-find').textContent.trim() }; });
  expect(g.text === 'Find' && Math.abs(g.f.height - g.m.height) < 0.6 && Math.abs(g.f.top - g.m.top) < 0.6 && g.m.left - g.f.right >= 0 && g.m.left - g.f.right <= 8, `Find on the bar: ${JSON.stringify(g)}`);
  const open = () => page.evaluate(() => !!document.querySelector('dialog.palette[open]'));
  await page.click('.modebar .head-find');
  await page.waitForTimeout(150);
  expect(await open(), 'Find did not open the palette');
  await page.keyboard.press('Escape');
  await page.locator('.rows .expr').first().click();
  await page.keyboard.press('ControlOrMeta+k');
  await page.waitForTimeout(150);
  expect(await open(), '⌘K did not open the palette');
  await page.keyboard.type('duct');
  await page.keyboard.press('Escape');
  expect((await lines(page))[0].text === '', `⌘K let typing into the line: ${(await lines(page))[0].text}`);
  await page.keyboard.press('ControlOrMeta+/');
  await page.waitForTimeout(150);
  expect(await open(), '⌘/ no longer opens the palette');
  await page.keyboard.press('Escape');
});

await check('D2 desktop: a function from Find goes in as its key does: caret inside, grey slots, calm; a refrigerant one takes the fluid', async (page) => {
  await page.locator('.rows .expr').first().click();
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('dew point');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  let l = await lineNow(page);
  expect(l.text === 'dewpoint()' && l.caret === 9 && l.calm && !l.red && /dewpoint\(\w+/.test(l.slots ?? ''), `dew point: ${JSON.stringify(l)}`);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('superheat');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  l = await lineNow(page);
  expect(/^superheat\("?R?410A"?, \)$/.test(l.text) && l.calm && !l.red, `superheat takes R-410A: ${JSON.stringify(l)}`);
  await page.keyboard.type('118, 50');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const got = await lines(page);
  expect(Math.abs(got[0].value - 10.157) < 0.01, `superheat: ${JSON.stringify(got[0])}`);
});

await check('D2 desktop: the line being typed keeps its whole error above the keys on a full sheet', async (page) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => window.slopculator.setLines(['binompdf(10, 0.3, 4)', 'invNorm(0.95)', 'normaldist(0, 1)', 'a = 5', 'y = a x^2 - 3', 'superheat("R410A", 118, 50)', 'ductsize(1000, 0.1)', '']));
  await page.waitForTimeout(300);
  await page.locator('.rows .row').last().locator('.expr').click();
  await page.keyboard.type('dewpoint(1, 2, 3, 4, 5)');
  await page.locator('.row.active .out .err').waitFor();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const g = await page.evaluate(() => { const e = document.querySelector('.row.active .out .err'), k = document.querySelector('.keypad').getBoundingClientRect(), rows = document.querySelector('.rows').getBoundingClientRect(); return e ? { err: e.getBoundingClientRect().bottom, keys: k.top, list: rows.bottom, text: e.textContent } : null; });
  expect(g && g.err <= g.keys + 0.5 && g.err <= g.list + 0.5, `the error runs onto the keys: ${JSON.stringify(g)}`);
});

await check('D2 desktop: a new curve that doesn\'t show is fitted; a slider moving it later isn\'t', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['normaldist(0, 1)', '']));
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => window.slopculator.graph.view());
  expect(before.ymax < 1, `the bell curve's view: ${JSON.stringify(before)}`);
  await page.locator('.rows .row').last().locator('.expr').click();
  await page.keyboard.type('a = 1');
  await page.keyboard.press('Enter');
  await page.keyboard.type('y = a x^2 - 3');
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => window.slopculator.graph.view());
  expect(after.ymin <= -3 && after.ymax >= 5, `the parabola wasn't fitted: ${JSON.stringify(after)}`);
  await page.evaluate(() => { const r = document.querySelector('.slider-row .slider'); r.value = '3'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(1200);
  const slid = await page.evaluate(() => window.slopculator.graph.view());
  expect(Math.abs(slid.ymin - after.ymin) < 1e-6 && Math.abs(slid.ymax - after.ymax) < 1e-6, `a slider refitted the view: ${JSON.stringify({ after, slid })}`);
});

await check('D2 desktop: det of a 2 × 2 from the keyboard: Ctrl+Alt+4, Enter, the 2 × 2 chip, cells by comma, then −2', async (page) => {
  await page.locator('.rows .expr').first().click();
  await page.keyboard.press('Control+Alt+4');
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  expect((await lineNow(page)).text === 'det()', `det: ${JSON.stringify(await lineNow(page))}`);
  await page.locator('.row.active .hint-line .grid-chip', { hasText: '2 × 2' }).click();
  await page.waitForTimeout(150);
  for (const c of ['1', ',', '2', ',', '3', ',', '4']) await page.keyboard.type(c);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const l = await lines(page);
  expect(l[0].result === '-2', `det: ${JSON.stringify(l[0])}`);
});

await check('search: a function from the palette is its own undo step, named for it', async (page) => {
  await page.locator('.rows .expr').first().click();
  await page.keyboard.type('5');
  await page.keyboard.press('ControlOrMeta+k');
  await page.waitForTimeout(150);
  await page.keyboard.type('sqrt');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(150);
  expect((await page.locator('.toast').textContent()).includes('Undid: sqrt'), `toast: ${await page.locator('.toast').textContent()}`);
  expect((await lines(page))[0].text === '5', `the typing before it stays: ${JSON.stringify(await lines(page))}`);
});

const placeCaret = (page, at) => page.evaluate((c) => { const i = document.querySelector('.row.active .expr'); i.focus(); i.setSelectionRange(c, c); }, at);
const backKey = (page) => page.locator('.keypad .key:has(svg.back)').first();
const lineAndCaret = (page) => page.evaluate(() => { const i = document.querySelector('.row.active .expr'); return { text: i.value, caret: i.selectionStart }; });

for (const [where, narrow] of [['desktop', false], ['phone', true]]) {
  await check(`H1 ${where}: the ⌫ key steps back out of an empty matrix cell, and never takes a bracket`, async (page) => {
    await page.evaluate(() => window.slopculator.setLines(['[[1, 2], [ , 4]]']));
    await page.locator('.rows .expr').first().click();
    await placeCaret(page, 10);
    await backKey(page).click();
    await page.waitForTimeout(120);
    const l = await lineAndCaret(page);
    expect(l.text === '[[1, 2], [ , 4]]' && l.caret === 6, `⌫ in an empty cell: ${JSON.stringify(l)}`);
  }, narrow);
  if (!narrow) await check(`H1 ${where}: the ⌫ key clears a whole empty grid, and Ctrl+Z brings it back`, async (page) => {
    await page.evaluate(() => window.slopculator.setLines(['[[ , ], [ , ]]']));
    await page.locator('.rows .expr').first().click();
    await placeCaret(page, 3);
    await backKey(page).click();
    await page.waitForTimeout(120);
    const l = await lineAndCaret(page);
    expect(l.text === '' && l.caret === 0, `⌫ in an empty grid: ${JSON.stringify(l)}`);
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(200);
    expect((await lineAndCaret(page)).text === '[[ , ], [ , ]]', `Ctrl+Z after ⌫: ${JSON.stringify(await lineAndCaret(page))}`);
  }, narrow);
  if (!narrow) await check(`H1 ${where}: the physical Backspace follows the same matrix rule`, async (page) => {
    await page.evaluate(() => window.slopculator.setLines(['[[1, 2], [ , 4]]']));
    await page.locator('.rows .expr').first().click();
    await placeCaret(page, 10);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(120);
    const l = await lineAndCaret(page);
    expect(l.text === '[[1, 2], [ , 4]]' && l.caret === 6, `Backspace in an empty cell: ${JSON.stringify(l)}`);
  }, narrow);
  if (!narrow) await check(`H1 ${where}: ⌫ on an empty first line deletes it when other lines exist`, async (page) => {
    await page.evaluate(() => window.slopculator.setLines(['', '7']));
    await page.locator('.rows .expr').first().click();
    await backKey(page).click();
    await page.waitForTimeout(150);
    const t = (await lines(page)).map((x) => x.text);
    expect(t.join('|') === '7', `lines after ⌫: ${JSON.stringify(t)}`);
  }, narrow);
  if (!narrow) await check(`H1 ${where}: Enter steps to the next empty matrix cell`, async (page) => {
    await page.evaluate(() => window.slopculator.setLines(['[[ , ], [ , ]]']));
    await page.locator('.rows .expr').first().click();
    await placeCaret(page, 3);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
    const l = await lineAndCaret(page);
    expect(l.text === '[[ , ], [ , ]]' && l.caret === 5 && (await lines(page)).length === 1, `Enter in a cell: ${JSON.stringify(l)}`);
  }, narrow);
}

await check('H2 phone: Find inserts a function the way its tile does', async (page) => {
  await page.locator('.rows .expr').first().click();
  await page.locator('.head-find').tap();
  await page.waitForTimeout(200);
  await page.keyboard.type('deriv2');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const l = await lineNow(page);
  expect(l.text === 'deriv2(, x, )' && l.caret === 7, `deriv2 from Find: ${JSON.stringify(l)}`);
}, true);

await check('H2 phone: a narrow window has the Shape, Vector and matrix tiles the phones have', async (page) => {
  const names = () => page.$$eval('.ti-tile .ti-face', (ns) => ns.map((n) => n.textContent));
  await tapTab(page, 'Math');
  await page.locator('.ti-seg', { hasText: 'Graph' }).tap();
  await page.waitForTimeout(200);
  expect((await names()).includes('Shape…'), `Graph page: ${await names()}`);
  await tapTab(page, 'Matrix');
  await page.waitForTimeout(200);
  expect((await names()).includes('Any size…'), `Matrix page: ${await names()}`);
  await page.locator('.ti-seg', { hasText: 'Vectors' }).tap();
  await page.waitForTimeout(200);
  expect((await names()).includes('Vector…'), `Vectors page: ${await names()}`);
  await page.locator('.ti-tile:has(.ti-face:text-is("Vector…"))').tap();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => !!document.querySelector('dialog[open] .mx-name')), 'the Vector tile opens its editor');
}, true);

await check('H2 phone: a 6 × 6 matrix grid scrolls inside its dialog on a narrow window, and inserts', async (page) => {
  await tapTab(page, 'Matrix');
  await page.waitForTimeout(200);
  await page.locator('.ti-tile:has(.ti-face:text-is("Any size…"))').tap();
  await page.waitForSelector('dialog.mx[open]');
  const grow = page.locator('dialog.mx .mx-size button', { hasText: '+' });
  for (const axis of [0, 1]) for (let i = 0; i < 4; i++) await grow.nth(axis).tap();
  const fit = await page.evaluate(() => {
    const dialog = document.querySelector('dialog.mx').getBoundingClientRect();
    const box = document.querySelector('dialog.mx');
    const grid = box.querySelector('.mx-grid');
    return { dialogRight: dialog.right, width: innerWidth, formWider: box.scrollWidth > box.clientWidth, gridScrolls: grid.scrollWidth > grid.clientWidth, cells: grid.querySelectorAll('input').length };
  });
  expect(fit.cells === 36, `cells: ${fit.cells}`);
  expect(fit.dialogRight <= fit.width, `the dialog runs off the window: ${JSON.stringify(fit)}`);
  expect(!fit.formWider, `the whole form scrolls sideways: ${JSON.stringify(fit)}`);
  expect(fit.gridScrolls, `the grid should scroll inside the dialog: ${JSON.stringify(fit)}`);
  await page.locator('[aria-label="Row 6, column 6"]').fill('7');
  await page.locator('dialog.mx button.primary').tap();
  await page.waitForTimeout(150);
  expect((await page.inputValue('.row.active .expr')).endsWith('[0, 0, 0, 0, 0, 7]]'), `line: ${await page.inputValue('.row.active .expr')}`);
}, true);

for (const phone of [false, true]) await check(`design system: spoken key labels do not change styling (${phone ? 'phone' : 'desktop'})`, async (page) => {
  for (const look of ['modern', 'retro']) {
    await setLook(page, look);
    await page.evaluate(() => document.fonts.ready);
    const changed = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.numpad .key, .numpad .key :is(.kl, .ks, .kicon)')];
      const styles = () => nodes.map((el) => {
        const s = getComputedStyle(el);
        return [s.font, s.letterSpacing, s.color, s.display, s.width, s.height, s.top, s.bottom, s.left, s.right, s.transform].join('|');
      });
      const before = styles();
      document.querySelectorAll('.numpad .key').forEach((el) => el.setAttribute('aria-label', 'Accessible wording can change'));
      const after = styles();
      return before.flatMap((style, i) => style === after[i] ? [] : [{ node: nodes[i].outerHTML, before: style, after: after[i] }]);
    });
    expect(changed.length === 0, `${look}: ${JSON.stringify(changed)}`);
  }
}, phone);

await check('design system: desktop Undo stays available for ten seconds', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['6*7']));
  await freezeClock(page);
  await page.evaluate(() => window.slopculator.clear());
  await page.clock.runFor(9900);
  expect(await page.isVisible('.toast.show button'), 'Undo disappeared before ten seconds');
  await page.clock.runFor(200);
  expect(await page.evaluate(() => document.querySelector('.toast').inert), 'Undo still takes input after ten seconds');
}, false, { clock: true });

if (!process.env.E2E_MATCH && !shard) console.log(results.join('\n'));
console.log(`${results.filter((r) => r.startsWith('PASS')).length} passed, ${results.filter((r) => r.startsWith('FAIL')).length} failed`);
console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
process.exitCode = results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0;
