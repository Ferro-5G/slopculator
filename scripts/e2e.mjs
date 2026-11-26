import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { appUrl, exposeKeys, launchBrowser, openApp } from './lib/app.mjs';

mkdirSync('.shots', { recursive: true });
// Independent browser profiles make optional parallel batches safe. E2E_SHARD=0/4 runs the first of four.
const shard = process.env.E2E_SHARD?.split('/').map(Number);
if (shard && (shard.length !== 2 || !shard.every(Number.isInteger) || shard[1] < 1 || shard[0] < 0 || shard[0] >= shard[1])) throw new Error('E2E_SHARD must be index/count, with 0 <= index < count');
let checkIndex = 0;
const browser = await launchBrowser();
const results = [];
const errors = [];

/** @param phone true for a 390 × 844 phone, or a phone's viewport ({ width: 375, height: 667 }). */
/** @param open opens the app in the page, for a check that serves it its own way. */
async function check(name, fn, phone = false, { folded = false, clock = false, open = openApp } = {}) {
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
  // A reload waits for the app to finish booting (its agent API is the last thing boot sets up), so a check never reads
  // the page before the saved sheet and settings are back. A fixed wait after it wasn't always enough on CI.
  if (!clock) {
    const reload = page.reload.bind(page);
    page.reload = async (options) => {
      const r = await reload(options);
      await page.waitForFunction(() => !!window.slopculator, null, { timeout: 10000 }).catch(() => {});
      return r;
    };
  }
  await open(page);
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
/** To the composer's new line: an edit in the composer is kept (Enter), then the new line takes the caret. */
const toNewLine = async (page) => {
  if (await page.evaluate(() => !!document.querySelector('.composer.editing'))) await page.keyboard.press('Enter');
  await page.locator('.composer .expr').click();
};
/** A File menu item, by its words: Add a table, Add a normal curve, Start with an example… */
const fileItem = async (page, text) => {
  await page.click('.menu-btn');
  await page.locator('.menu [role=menuitem]', { hasText: text }).first().click();
};
/** The graph is a block that comes when a line draws: send one, so a check about the graph has one. */
const drawSomething = async (page, { text = 'y = x', clock = false } = {}) => {
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  if (clock) await page.clock.runFor(200);
  else await page.waitForFunction(() => !!document.querySelector('.tape .graph-pane'));
};
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

// A platform directory a checkout may not have brings its own checks of the built page.
if (existsSync('src-tauri/e2e.mjs')) await (await import('../src-tauri/e2e.mjs')).default({ check, expect, lines });

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
  await page.locator('.ti-tile', { hasText: 'Matrix builder' }).click();
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
  await drawSomething(page, { clock: true });
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

await check('motion states: pointer down takes ownership from a graph zoom immediately', async (page) => {
  await drawSomething(page, { clock: true });
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
  await page.click('.menu-btn');
  await page.locator('.menu [role=menuitem]', { hasText: 'Start with an example' }).click();
  await page.locator('.examples-dialog .starter-card', { hasText: 'Shaded normal curve' }).click();
  await page.waitForTimeout(400);
  const l = await lines(page);
  expect(l.some((x) => x.probability && Math.abs(x.probability - 0.8186) < 1e-3), JSON.stringify(l));
  await page.screenshot({ path: '.shots/e2e-starter.png' });
});

/** A block on the canvas, by the text its line reads. */
const blockOf = async (page, text) => {
  const i = await page.evaluate((t) => [...document.querySelectorAll('.tape .rows .row.blk')].findIndex((r) => r.querySelector('input.expr')?.value === t), text);
  return page.locator('.tape .rows .row.blk').nth(Math.max(0, i));
};
const composerText = (page) => page.locator('.composer .expr').inputValue();
const typeLine = async (page, text) => { await page.keyboard.type(text); await page.keyboard.press('Enter'); await page.waitForTimeout(120); };

await check('canvas: a sent line becomes a block; a click on it edits it in the composer, Update keeps the change and Cancel puts it back', async (page) => {
  await page.keyboard.type('12*7');
  await page.waitForFunction(() => document.querySelector('.composer')?.dataset.state === 'ok');
  expect((await page.locator('.composer .out').innerText()).includes('84'), 'no live answer in the composer');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  expect(await (await blockOf(page, '12*7')).isVisible(), 'the sent line is not a block on the canvas');
  expect(await composerText(page) === '', 'the composer kept the sent line');
  await (await blockOf(page, '12*7')).click();
  await page.waitForTimeout(150);
  expect(await composerText(page) === '12*7', 'a click on the block did not load it into the composer');
  expect((await page.locator('.composer-enter').innerText()) === 'Update', 'enter does not read Update while editing');
  expect(await page.locator('.blk-ghost').isVisible(), 'no ghost where the block waits');
  await page.keyboard.press('End');
  await page.keyboard.type('+1');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  let l = await lines(page);
  expect(l.some((x) => x.text === '12*7+1' && x.result === '85'), JSON.stringify(l));
  expect(await composerText(page) === '', 'Update left the line in the composer');
  await (await blockOf(page, '12*7+1')).click();
  await page.keyboard.type('000');
  await page.locator('.composer-cancel').click();
  await page.waitForTimeout(150);
  l = await lines(page);
  expect(l.some((x) => x.text === '12*7+1'), `Cancel did not put the line back: ${JSON.stringify(l)}`);
  await (await blockOf(page, '12*7+1')).click();
  await page.keyboard.type('9');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  l = await lines(page);
  expect(l.some((x) => x.text === '12*7+1'), `Esc did not put the line back: ${JSON.stringify(l)}`);
});

await check('canvas: typing a name that is already defined offers Update r, previews it, and changes that line', async (page) => {
  await typeLine(page, 'r = 4');
  await typeLine(page, 'A = πr^2');
  await page.keyboard.type('r = 6');
  await page.waitForTimeout(150);
  expect((await page.locator('.composer-enter').innerText()) === 'Update r', `enter reads ${await page.locator('.composer-enter').innerText()}`);
  const preview = await page.evaluate(() => window.slopculator.lines());
  expect(!preview.some((x) => x.error), `the preview reads r as defined twice: ${JSON.stringify(preview)}`);
  expect(preview.some((x) => x.text === 'A = πr^2' && Math.abs(x.value - 36 * Math.PI) < 1e-9), `no live preview: ${JSON.stringify(preview)}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const l = (await lines(page)).filter((x) => x.text);
  expect(JSON.stringify(l.map((x) => x.text)) === '["r = 6","A = πr^2"]', JSON.stringify(l));
});

await check('canvas: an unsent Update r survives a reload as the draft, not as a second definition of r', async (page) => {
  await typeLine(page, 'r = 4');
  await typeLine(page, 'A = πr^2');
  await page.keyboard.type('r = 6');
  await page.waitForFunction(() => document.querySelector('.composer-enter')?.textContent === 'Update r');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.composer-enter')?.textContent === 'Update r');
  const after = await lines(page);
  expect(!after.some((x) => x.error), `a line errs after the reload: ${JSON.stringify(after)}`);
  expect(after.some((x) => x.text === 'A = πr^2' && Math.abs(x.value - 36 * Math.PI) < 1e-9), `no live preview after the reload: ${JSON.stringify(after)}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.composer-enter')?.textContent !== 'Update r');
  const l = (await lines(page)).filter((x) => x.text);
  expect(JSON.stringify(l.map((x) => x.text)) === '["r = 6","A = πr^2"]', JSON.stringify(l));
});

await check('phone on its side: the keypad keeps its number keys tall enough to tap', async (page) => {
  const seven = await page.evaluate(() => ({ ...[...document.querySelectorAll('#keypad .key')].find((k) => k.textContent.trim() === '7')?.getBoundingClientRect().toJSON(), screen: innerHeight }));
  expect(seven.height >= 40 && seven.bottom <= seven.screen, `the 7 key: ${JSON.stringify(seven)}`);
  await page.locator('#keypad .key', { hasText: /^7$/ }).tap();
  await page.waitForFunction(() => window.slopculator.lines().some((x) => x.text === '7'));
}, { width: 640, height: 360 });

await check('canvas: a name used by another line is wired to it and drawn lines to the graph; a slider drag pulses and lands on the right answers', async (page) => {
  await typeLine(page, 'a = 1');
  await typeLine(page, 'y = a(x - 1)^2 - 3');
  await typeLine(page, 'b = 2a');
  await page.waitForTimeout(300);
  const wires = await page.evaluate(() => [...document.querySelectorAll('.cv-wires path.w')].map((p) => `${p.dataset.from}>${p.dataset.to}`));
  const ids = await page.evaluate(() => window.slopculator.lines().map((l) => l.text));
  expect(wires.length === 3 && wires.some((w) => w.endsWith('>#graph')), `wires: ${wires} for ${ids}`);
  expect(await page.locator('.tape .rows .blk-graph').isVisible(), 'no graph block');
  const range = page.locator('.tape .row.blk-slider input.slider');
  const box = await range.boundingBox();
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 5 });
  const pulsed = await page.evaluate(() => document.querySelectorAll('.cv-wires path.pulse').length);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const l = await lines(page);
  const a = l.find((x) => x.text.startsWith('a = ')), b = l.find((x) => x.text === 'b = 2a');
  expect(a && b && Number(b.result) === 2 * Number(a.result) && Number(a.result) > 1, JSON.stringify(l));
  expect(pulsed > 0, 'no pulse ran down the wires');
});

/** Holds a slider down by its thumb, moves it `by` px, and returns a function that lets go. */
const holdSlider = async (page, name, by) => {
  const range = page.locator(`.tape .row.blk-slider input.slider[aria-label="${name}"]`);
  await range.scrollIntoViewIfNeeded();
  const box = await range.boundingBox();
  const f = await range.evaluate((r) => (Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min)));
  const x = box.x + 10 + (box.width - 20) * f, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + by, y, { steps: 4 });
  await page.waitForTimeout(500);
  return () => page.mouse.up();
};
const shownTags = (page) => page.evaluate(() => [...document.querySelectorAll('.cv-tag.on:not(.gone)')].map((t) => ({ key: t.dataset.key, text: t.textContent, lit: t.classList.contains('lit'), dim: t.classList.contains('dim'), box: t.getBoundingClientRect().toJSON() })));

await check('canvas: values on wires show only while a slider is held, lit with their change where it reaches, then go; pointing at a wire shows its full value', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['d = 0.3', 'v = 2', 'A = πd^2/4', 'Q = A v', 'T = {9.6, 10.4, 10.1}', 'Tm = mean(T)']));
  await page.waitForTimeout(400);
  expect((await shownTags(page)).length === 0, `tags at rest: ${JSON.stringify(await shownTags(page))}`);
  const letGo = await holdSlider(page, 'd', 12);
  const held = await shownTags(page);
  const lit = held.filter((t) => t.lit), dim = held.filter((t) => t.dim);
  expect(lit.some((t) => /^d.*[+−][\d.]+%/.test(t.text)), `no lit d tag with its change: ${JSON.stringify(held)}`);
  expect(lit.some((t) => t.text.startsWith('A')), `A's tag isn't lit: ${JSON.stringify(held)}`);
  expect(dim.some((t) => t.text.startsWith('v')) && dim.some((t) => t.text.startsWith('T')), `wires d doesn't reach aren't dim: ${JSON.stringify(held)}`);
  expect(held.some((t) => t.text.startsWith('T') && /\d–\d/.test(t.text)) && await page.locator('.cv-tag .bars').count() > 0, `a list's tag isn't a range with bars: ${JSON.stringify(held)}`);
  // Each tag sits on a wire, clear of every block.
  const blocks = await page.evaluate(() => [...document.querySelectorAll('.tape .rows > .row.blk:not(.blk-blank)')].map((b) => b.getBoundingClientRect().toJSON()));
  for (const t of held) for (const b of blocks) expect(!(t.box.left < b.right - 1 && b.left < t.box.right - 1 && t.box.top < b.bottom - 1 && b.top < t.box.bottom - 1), `tag ${t.text} covers a block`);
  await letGo();
  await page.waitForFunction(() => !document.querySelector('.cv-tag.on'), null, { timeout: 4000 });
  // Pointing at a wire shows its tag, with the full value, and dims the rest.
  const at = await page.evaluate(() => { const p = document.querySelector('.cv-wires path.hit'); const l = p.getTotalLength(), pt = p.getPointAtLength(l / 2), m = p.getScreenCTM(); return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f }; });
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(250);
  const hovered = await shownTags(page);
  expect(hovered.length === 1, `pointing at a wire shows ${hovered.length} tags`);
  expect(await page.locator('.cv-wires path.w.dim').count() > 0, 'pointing at a wire dims the others');
  await page.mouse.move(5, 300);
  await page.waitForTimeout(250);
  expect((await shownTags(page)).length === 0, 'the tag stays after the pointer leaves');
  // The keyboard reaches the tags: one Tab stop, arrows between them, and a focused one shows.
  await page.locator('.cv-tag[tabindex="0"]').focus();
  expect((await shownTags(page)).length === 1, 'a focused tag does not show');
  const first = await page.evaluate(() => document.activeElement.dataset.key);
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate((k) => document.activeElement.classList.contains('cv-tag') && document.activeElement.dataset.key !== k, first), 'the arrow keys do not move between tags');
});

await check('phone canvas: holding a slider puts each tag on its wire in open canvas, lights what it reaches, and the slider stays under the finger', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['d = 0.3', 'A = πd^2/4', 'Q = 2A']));
  await page.waitForTimeout(400);
  const before = await page.locator('.tape .row.blk-slider input.slider').boundingBox();
  const blocksBefore = await page.evaluate(() => [...document.querySelectorAll('.tape .rows > .row.blk:not(.blk-blank)')].map((b) => b.getBoundingClientRect().toJSON()));
  const letGo = await holdSlider(page, 'd', 6);
  const after = await page.locator('.tape .row.blk-slider input.slider').boundingBox();
  expect(Math.abs(after.y - before.y) < 2, `the slider moved under the finger: ${before.y} → ${after.y}`);
  expect(!(await page.locator('.tape .row.blk-slider .lim.step').isVisible()), 'a slider shows its step field in the column');
  const held = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.tape .rows > .row.blk:not(.blk-blank)')].map((b) => b.getBoundingClientRect().toJSON());
    const wires = [...document.querySelectorAll('.cv-wires path.w')].map((p) => ({ key: `${p.dataset.from}>${p.dataset.to}`, box: p.getBoundingClientRect().toJSON() }));
    const tags = [...document.querySelectorAll('.cv-tag.on:not(.gone)')].map((t) => ({ key: t.dataset.key, box: t.getBoundingClientRect().toJSON() }));
    const lit = document.querySelectorAll('.tape .rows > .row.blk.cv-lit').length;
    return { blocks, wires, tags, lit };
  });
  const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  expect(held.tags.length === 2, `not a tag on each wire: ${JSON.stringify(held.tags)}`);
  for (const t of held.tags) {
    expect(!held.blocks.some((b) => hit(t.box, b)), `a tag covers a block: ${JSON.stringify(t)}`);
    // On its wire: the wire's box runs through the tag's.
    const w = held.wires.find((x) => x.key === t.key);
    expect(w && w.box.left <= t.box.right && w.box.right >= t.box.left && w.box.top <= t.box.bottom && w.box.bottom >= t.box.top, `a tag is off its wire: ${JSON.stringify({ t, w })}`);
  }
  expect(held.lit === 3, `the slider and what it reaches don't light up: ${held.lit}`);
  // Nothing in the column moved while held.
  expect(held.blocks.every((b, k) => Math.abs(b.top - blocksBefore[k].top) < 1 && Math.abs(b.left - blocksBefore[k].left) < 1), `a block moved while the slider was held: ${JSON.stringify(blocksBefore.map((b) => [b.left, b.top, b.width]))} → ${JSON.stringify(held.blocks.map((b) => [b.left, b.top, b.width]))}`);
  await letGo();
  await page.waitForFunction(() => !document.querySelector('.cv-tag.on:not(.gone)') && !document.querySelector('.tape .row.blk.cv-lit'), null, { timeout: 4000 });
}, true);

/** The column's blocks and wires, in page coordinates, for the Cascade checks. */
const column = (page) => page.evaluate(() => ({
  blocks: Object.fromEntries([...document.querySelectorAll('.tape .rows > .row.blk:not(.blk-blank)')].map((b) => [b.querySelector('.expr')?.value ?? '', b.getBoundingClientRect().toJSON()])),
  graph: document.querySelector('.tape .rows > .blk-graph')?.getBoundingClientRect().toJSON() ?? null,
  column: (() => { const l = document.querySelector('.tape .rows'), cs = getComputedStyle(l), r = l.getBoundingClientRect(); return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) }; })(),
  wires: [...document.querySelectorAll('.cv-wires path.w')].map((p) => ({ from: p.dataset.from, to: p.dataset.to, d: p.getAttribute('d') })),
}));
/** A wire's square points from its path (M, L, H, V and the Q of each rounded corner's turn). */
const wirePoints = (d) => {
  const nums = [...d.matchAll(/([MLHVQ])\s*([-\d.,\s]+)/g)];
  const pts = [];
  for (const [, op, args] of nums) {
    const v = args.trim().split(/[\s,]+/).map(Number);
    const last = pts[pts.length - 1];
    if (op === 'M' || op === 'L') pts.push({ x: v[0], y: v[1] });
    else if (op === 'H') pts.push({ x: v[0], y: last.y });
    else if (op === 'V') pts.push({ x: last.x, y: v[0] });
    else if (op === 'Q') pts.push({ x: v[0], y: v[1] });
  }
  return pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
};
/** Whether two wires' square points cross, or run along each other. */
const wiresCross = (a, b) => {
  const segs = (pts) => pts.slice(1).map((q, i) => [pts[i], q]);
  return segs(a).some(([p0, p1]) => segs(b).some(([q0, q1]) => {
    const pv = Math.abs(p0.x - p1.x) < 0.5, qv = Math.abs(q0.x - q1.x) < 0.5;
    if (pv === qv) return pv ? Math.abs(p0.x - q0.x) < 0.5 && Math.min(p1.y, p0.y) < Math.max(q0.y, q1.y) - 0.5 && Math.min(q0.y, q1.y) < Math.max(p0.y, p1.y) - 0.5 : false;
    const [v0, v1, h0, h1] = pv ? [p0, p1, q0, q1] : [q0, q1, p0, p1];
    return h0.y > Math.min(v0.y, v1.y) + 0.5 && h0.y < Math.max(v0.y, v1.y) - 0.5 && v0.x > Math.min(h0.x, h1.x) + 0.5 && v0.x < Math.max(h0.x, h1.x) - 0.5;
  }));
};

await check('phone canvas: Cascade makes a block a pill as wide as its line and steps a dependent right; the graph spans', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['p = 1.3', 'f(x) = x^3 - 3x', 'y = 2sin(90x) + p', 'd = 3p^2 - 3']));
  await page.waitForTimeout(500);
  const c = await column(page);
  const width = c.column.right - c.column.left;
  const f = c.blocks['f(x) = x^3 - 3x'], y = c.blocks['y = 2sin(90x) + p'], d = c.blocks['d = 3p^2 - 3'], p = c.blocks['p = 1.3'];
  expect(f && y && d && p && c.graph, `blocks missing: ${JSON.stringify(Object.keys(c.blocks))}`);
  // Each line's pill is its line's width, short of the column's; nothing runs past the column.
  expect(f.width < width * 0.75 && y.width < width * 0.9, `pills as wide as the column: f ${f.width}, y ${y.width} of ${width}`);
  expect(Object.values(c.blocks).every((b) => b.right <= c.column.right + 1 && b.left >= c.column.left - 1), 'a block runs out of the column');
  // Its text keeps one line: no pill squeezes its line.
  const lines = await page.evaluate(() => [...document.querySelectorAll('.tape .rows > .row.blk-curve .tex')].map((t) => t.getClientRects().length && t.getBoundingClientRect().height));
  expect(lines.every((h) => h < 40), `a pill wraps its line: ${lines}`);
  // Sources hug the left; y and d read p and step right by the same step.
  expect(Math.abs(f.left - c.column.left) < 1 && Math.abs(p.left - c.column.left) < 1, `a source is off the left: f ${f.left}, p ${p.left}, column ${c.column.left}`);
  expect(y.left - f.left > 20 && Math.abs((d.left - c.column.left) - (y.left - c.column.left)) < 1, `dependents don't step right: y ${y.left}, d ${d.left}`);
  expect(Math.abs(c.graph.width - width) < 2, `the graph doesn't span: ${c.graph.width} of ${width}`);
  // One radius for blocks, the graph and the composer.
  const radii = await page.evaluate(() => [...document.querySelectorAll('.tape .rows > .row.blk:not(.blk-blank), .tape .rows > .blk-graph, .composer')].map((e) => getComputedStyle(e).borderTopLeftRadius));
  expect(new Set(radii).size === 1 && radii[0] === '22px', `radii differ: ${radii}`);
}, true);

await check('phone canvas: Cascade wires drop straight down in lanes of their own and never cross; only one takes the margin', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['p = 1.3', 'f(x) = x^3 - 3x', 'y = 2sin(90x) + p', 'd = 3p^2 - 3']));
  await page.waitForTimeout(500);
  const c = await column(page);
  const routes = c.wires.map((w) => ({ ...w, pts: wirePoints(w.d) }));
  const margin = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.tape .rows')).paddingLeft));
  const straight = routes.filter((r) => r.pts.length === 2 && r.pts[0].x === r.pts[1].x);
  const inMargin = routes.filter((r) => r.pts.some((q) => q.x < margin));
  expect(routes.length === 4, `not four wires: ${routes.length}`);
  expect(straight.length === 3 && inMargin.length === 1, `wires aren't straight but one: ${JSON.stringify(routes.map((r) => r.pts))}`);
  for (let i = 0; i < routes.length; i++) for (let j = 0; j < i; j++) expect(!wiresCross(routes[i].pts, routes[j].pts), `wires cross: ${routes[i].d} and ${routes[j].d}`);
}, true);

await check('phone canvas: on a busier sheet sliders leave open canvas on their right, wires take it before the margin, and few cross', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['a = 2', 'b = 3', 'c = a + b', 'y = a sin(x) + b', 'q = c^2', 'g = q + a', 'h = g/b', 'y = c x/4']));
  await page.waitForTimeout(500);
  const c = await column(page);
  const width = c.column.right - c.column.left;
  const sliders = await page.evaluate(() => [...document.querySelectorAll('.tape .rows > .row.blk-slider')].map((b) => b.getBoundingClientRect().width));
  expect(sliders.length === 2 && sliders.every((w) => width - w >= 60), `sliders fill the column: ${sliders} of ${width}`);
  const margin = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.tape .rows')).paddingLeft));
  const listLeft = await page.evaluate(() => document.querySelector('.tape .rows').getBoundingClientRect().left);
  const routes = c.wires.map((w) => wirePoints(w.d));
  const inMargin = routes.filter((pts) => pts.some((q) => q.x < margin - 1));
  const onRight = routes.filter((pts) => pts.some((q) => q.x > c.column.right - listLeft - 60));
  expect(inMargin.length <= 2, `more than two wires in the margin: ${inMargin.length}`);
  expect(onRight.length >= 2, `no wires down the right: ${JSON.stringify(routes)}`);
  // a → g, b → h, c → y₂ and y → graph interleave pairwise, so one crossing at least; the layout keeps to a few.
  let pairs = 0;
  for (let i = 0; i < routes.length; i++) for (let j = 0; j < i; j++) if (wiresCross(routes[i], routes[j])) pairs++;
  expect(pairs <= 3, `too many crossings: ${pairs}`);
}, true);

await check('phone canvas: on the example sheet the wires drop straight and the held tag rides on its wire', async (page) => {
  await page.evaluate(() => { sessionStorage.setItem('e2e-first-run', '1'); localStorage.removeItem(window.slopKeys.firstRun); localStorage.removeItem(window.slopKeys.current); localStorage.removeItem(window.slopKeys.document); });
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('.tape .row.blk-slider'));
  await page.waitForTimeout(400);
  const routes = (await column(page)).wires.map((w) => wirePoints(w.d));
  expect(routes.length >= 2 && routes.every((pts) => pts.length === 2 && pts[0].x === pts[1].x), `the example's wires aren't straight: ${JSON.stringify(routes)}`);
  const letGo = await holdSlider(page, 'k', 8);
  const t = await page.evaluate(() => {
    const tag = document.querySelector('.cv-tag.on:not(.gone)'), wire = document.querySelector('.cv-wires path.w.lit');
    return tag && wire && { tag: tag.getBoundingClientRect().toJSON(), wire: wire.getBoundingClientRect().toJSON() };
  });
  expect(t && t.wire.left >= t.tag.left && t.wire.right <= t.tag.right && t.wire.top <= t.tag.top && t.wire.bottom >= t.tag.bottom, `the tag isn't on its wire: ${JSON.stringify(t)}`);
  // The graph traces, dotted, where the curve started.
  await letGo();
}, true);

await check('Deg | Rad keeps one size whichever is chosen, on a phone and on a desktop', async (page) => {
  for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(200);
    const size = () => page.evaluate(() => { const s = [...document.querySelectorAll('.modebar .desk-modes .seg')].find((e) => e.offsetParent); const r = s.getBoundingClientRect(); return { w: r.width, h: r.height, b: [...s.querySelectorAll('button')].map((b) => b.getBoundingClientRect().width) }; });
    const a = await size();
    await page.evaluate(() => window.slopculator.setSettings({ deg: false }));
    await page.waitForTimeout(150);
    const b = await size();
    await page.evaluate(() => window.slopculator.setSettings({ deg: true }));
    await page.waitForTimeout(150);
    expect(a.w === b.w && a.h === b.h && a.b.every((w, k) => w === b.b[k]), `Deg | Rad changed size at ${vp.width}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
});

await check('canvas: a window going from the phone\'s column to the wide canvas drops the column\'s widths and steps', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['p = 1.3', 'y = 2sin(90x) + p']));
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => [...document.querySelectorAll('.tape .rows > .row.blk')].some((b) => b.style.marginLeft)), 'the column set no steps');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => !!document.querySelector('.tape.cv-wide'));
  await page.waitForTimeout(300);
  const left = await page.evaluate(() => [...document.querySelectorAll('.tape .rows > .row.blk, .tape .rows > .blk-graph')].map((b) => [b.style.marginLeft, b.style.marginTop]).flat().filter(Boolean));
  expect(left.length === 0, `the column's steps stayed on the wide canvas: ${left}`);
}, { width: 390, height: 844 });

await check('desktop canvas: a line that reads another steps right under it and the wire enters its input pin', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['p = 1.3', 'y = 2sin(90x) + p']));
  await page.waitForTimeout(500);
  const c = await column(page);
  const p = c.blocks['p = 1.3'], y = c.blocks['y = 2sin(90x) + p'];
  expect(y.left - p.left > 20 && y.top > p.bottom, `y doesn't step right under p: ${JSON.stringify({ p, y })}`);
  const offset = await page.locator('.ng-sock-in').evaluate((socket) => {
    const path = document.querySelector('.cv-wires path.w:not([data-to="#graph"])');
    const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(path.getScreenCTM());
    const box = socket.getBoundingClientRect();
    return Math.hypot(end.x - box.x - box.width / 2, end.y - box.y - box.height / 2);
  });
  expect(offset < 1, `p's wire misses the input pin by ${offset}px`);
});

await check('canvas: Steps unfolds a line into its working without moving it; a failing step says so briefly and the steps after it show —; open lines stay open', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['a = 1', 'b = -3', 'c = 2', 'r = (−b + √(b² − 4ac)) / 2a']));
  await page.waitForTimeout(400);
  const line = page.locator('.tape .rows > .row.blk-value');
  const at = await line.boundingBox();
  await page.locator('.cv-steps').click();
  await page.waitForTimeout(300);
  expect(await page.locator('.cv-steps').getAttribute('aria-expanded') === 'true', 'Steps does not say it is open');
  const moved = await line.boundingBox();
  expect(Math.abs(moved.x - at.x) < 1 && Math.abs(moved.y - at.y) < 1, `the line moved when it opened: ${JSON.stringify([at, moved])}`);
  const steps = await page.evaluate(() => [...document.querySelectorAll('.cv-tray .cv-step')].map((s) => ({ math: s.querySelector('.sm').textContent.replace(/\s/g, ''), v: s.querySelector('.v').textContent, box: s.getBoundingClientRect().toJSON() })));
  expect(steps.length === 6, `steps: ${JSON.stringify(steps.map((s) => s.math))}`);
  expect(steps.some((s) => s.math === '2a' && s.v === '2') && steps.some((s) => s.v === '1'), `step values: ${JSON.stringify(steps)}`);
  const tray = await page.locator('.cv-tray').boundingBox();
  expect(tray.y >= moved.y + moved.height, 'the tray is not under its line');
  for (const s of steps) expect(s.box.left >= tray.x && s.box.right <= tray.x + tray.width && s.box.bottom <= tray.y + tray.height, `a step is outside the tray: ${s.math}`);
  // Pointing at a step marks the part of the line it works out.
  await page.locator('.cv-step', { hasText: '4ac' }).first().hover();
  expect(await page.locator('.tape .row.blk-value .tex .cv-hl').count() > 0, 'pointing at a step marks nothing in the line');
  // A failing step: short words, a coral border; the steps after it show —, their wires dashed.
  await page.locator('.tape .row.blk-slider input.slider[aria-label="c"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.slopculator.lines().some((l) => l.text === 'c = 3'));
  await page.waitForTimeout(300);
  const bad = page.locator('.cv-step.bad');
  expect(await bad.count() === 1 && (await bad.locator('.v').innerText()) === 'Not real', `the failing step: ${await bad.allInnerTexts()}`);
  expect((await page.locator('.cv-step.void .v').allInnerTexts()).every((t) => t === '—') && await page.locator('.cv-step.void').count() === 1, 'the step after it does not show —');
  expect(await page.locator('.cv-wires path.w.err').count() >= 2, 'no dashed wires after the failing step');
  await bad.hover();
  expect((await bad.locator('.v').innerText()).includes('negative'), 'pointing at the failing step does not show the full error');
  // It stays open after a reload.
  await page.reload();
  await page.waitForFunction(() => !!window.slopculator);
  await page.waitForTimeout(400);
  expect(await page.locator('.cv-tray .cv-step').count() === 6, 'the open line closed on reload');
  await page.locator('.cv-steps').click();
  await page.waitForTimeout(200);
  expect(await page.locator('.cv-tray').count() === 0, 'Steps did not close the tray');
});

await check('canvas: during a drag only the steps that change light, each with its change', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['a = 1', 'b = -3', 'c = 2', 'r = (−b + √(b² − 4ac)) / 2a']));
  await page.waitForTimeout(300);
  await page.locator('.cv-steps').click();
  await page.waitForTimeout(300);
  const letGo = await holdSlider(page, 'c', -12);
  const steps = await page.evaluate(() => [...document.querySelectorAll('.cv-tray .cv-step')].map((s) => ({ math: s.querySelector('.sm').textContent.replace(/\s/g, ''), d: s.querySelector('.d').textContent, same: s.classList.contains('same') })));
  expect(steps.filter((s) => s.d).length === 4 && steps.filter((s) => s.same).length === 2, `steps mid-drag: ${JSON.stringify(steps)}`);
  expect(steps.find((s) => s.math === '2a')?.same && !steps.find((s) => s.math === '2a')?.d, `2a should stay as it was: ${JSON.stringify(steps)}`);
  await letGo();
});

await check('phone canvas: Steps opens the working as an indented tree under the line', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['a = 1', 'b = -3', 'c = 2', 'r = (−b + √(b² − 4ac)) / 2a']));
  await page.waitForTimeout(300);
  await page.locator('.cv-steps').tap();
  await page.waitForTimeout(500);
  const steps = await page.evaluate(() => [...document.querySelectorAll('.cv-tray .cv-step')].map((s) => ({ math: s.querySelector('.sm').textContent.replace(/\s/g, ''), x: Math.round(s.getBoundingClientRect().left) })));
  expect(steps.length === 6 && steps[0].math.startsWith('−b') && steps.at(-1).math === '2a', `tree order: ${JSON.stringify(steps)}`);
  expect(steps[1].x > steps[0].x && steps[2].x > steps[1].x && steps.at(-1).x === steps[0].x, `not indented by depth: ${JSON.stringify(steps)}`);
  const tray = await page.locator('.cv-tray').boundingBox(), line = await page.locator('.tape .rows > .row.blk-value').boundingBox();
  expect(tray.y >= line.y + line.height - 1, 'the tree is not under its line');
  const view = await page.locator('.tape').boundingBox();
  expect(tray.y + 40 <= view.y + view.height && line.y >= view.y - 1, 'the opened steps or their line are out of sight');
}, true);

await check('canvas: figure blocks draw from their line, sit clear of each other, and switch to their numbers', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['θ = 40', 'unit circle(θ)', 'f(x) = x^3 - 3x', 'tangent(f, 1.3)', 'riemann(f, 0, 2, 8)', 'P = normalcdf(-1, 1)', 'M = [[1.5, 0.6], [0.4, 1.2]]']));
  await page.waitForTimeout(500);
  const kinds = await page.evaluate(() => [...document.querySelectorAll('.cv-fig:not([hidden])')].map((f) => [...f.classList].find((c) => c.startsWith('cv-fig-')) + ':' + f.querySelectorAll('svg path, svg line').length));
  for (const k of ['unit-circle', 'tangent', 'riemann', 'normal', 'matrix']) expect(kinds.some((x) => x.startsWith(`cv-fig-${k}:`) && Number(x.split(':')[1]) > 10), `no ${k} figure: ${JSON.stringify(kinds)}`);
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.tape .rows > .row.blk:not(.blk-blank), .tape .blk-graph')].map((el) => el.getBoundingClientRect().toJSON()));
  const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  expect(!boxes.some((a, i) => boxes.some((b, j) => i < j && hit(a, b))), 'two blocks overlap');
  // The riemann sum and the integral under its figure, from the engine.
  expect((await page.locator('.cv-fig-riemann .cv-readouts').innerText()).replace(/\s/g, '').includes('=−2'), 'the integral is not under the strips');
  // = shows the numbers, and the choice is kept.
  const normal = page.locator('.tape .row.blk', { has: page.locator('.cv-fig-normal') });
  await normal.locator('.cv-seg-view button[data-value="numbers"]').click();
  await page.waitForTimeout(200);
  expect(await page.locator('.cv-fig-normal').isHidden(), '= did not hide the figure');
  await page.reload();
  await page.waitForFunction(() => !!window.slopculator);
  await page.waitForTimeout(400);
  expect(await page.locator('.cv-fig-normal').isHidden(), 'the numbers view was not kept');
  await normal.locator('.cv-seg-view button[data-value="figure"]').click();
  await page.waitForTimeout(200);
  expect(await page.locator('.cv-fig-normal').isVisible(), '△ did not bring the figure back');
});

await check('canvas: dragging a figure handle moves the slider it reads or rewrites the line, and arrow keys nudge it', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['θ = 40', 'unit circle(θ)', 'P = normalcdf(-1, 1)']));
  await page.waitForTimeout(500);
  const h = await page.locator('.cv-fig-unit-circle .fh').boundingBox();
  const c = await page.locator('.cv-fig-unit-circle rect.fw').first().boundingBox();
  // From the point to straight above the circle's middle: 90°.
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2, c.y + 12, { steps: 6 });
  expect(await page.evaluate(() => window.slopculator.lines()[0].text) === 'θ = 90', `the slider did not follow: ${await page.evaluate(() => window.slopculator.lines()[0].text)}`);
  expect(await page.locator('.cv-fig-unit-circle .fs-teal[stroke-dasharray]').count() > 0, 'the cos guide does not show while the point is held');
  await page.mouse.up();
  await page.waitForTimeout(150);
  // A typed bound rewrites the line in place.
  const hi = page.locator('.cv-fig-normal .fh[data-h="hi"]');
  const b = await hi.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 50, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  const text = await page.evaluate(() => window.slopculator.lines()[2].text);
  expect(/^P = normalcdf\(-1, 1\.\d+\)$/.test(text), `the bound was not rewritten: ${text}`);
  // Arrow keys on a focused handle.
  await hi.focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => window.slopculator.lines()[2].text);
  expect(after !== text && /^P = normalcdf\(-1, 1\.\d+\)$/.test(after), `ArrowLeft did not nudge the bound: ${text} → ${after}`);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-h')) === 'hi', 'the handle lost focus');
});

await check('canvas: Riemann’s Left, Middle and Right rewrite its line', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['g(x) = x^2', 'riemann(g, 0, 1, 4)']));
  await page.waitForTimeout(400);
  await page.locator('.cv-fig-rule button[data-value="left"]').click();
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.slopculator.lines()[1].text) === 'riemann(g, 0, 1, 4, "left")', 'Left did not rewrite the line');
  expect((await page.locator('.cv-fig-riemann .ro-sum .rv').innerText()) === '0.21875', 'the sum did not change to the left ends');
});

await check('phone canvas: a figure block fills the column, the unit circle beside its waves', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['θ = 40', 'unit circle(θ)']));
  await page.waitForTimeout(500);
  const blk = await page.locator('.tape .row.blk-figure').boundingBox(), svg = await page.locator('.cv-fig-svg').boundingBox();
  expect(svg.width > blk.width - 40 && svg.x >= blk.x && svg.x + svg.width <= blk.x + blk.width + 1, `the figure does not fill its block: ${JSON.stringify([blk, svg])}`);
  const panes = await page.evaluate(() => [...document.querySelectorAll('.cv-fig-svg rect.fw')].map((r) => r.getBoundingClientRect().toJSON()));
  expect(panes.length === 2 && Math.abs(panes[0].top - panes[1].top) < 1 && panes[1].left > panes[0].right, `the circle and its waves are not side by side: ${JSON.stringify(panes)}`);
}, true);

await check('canvas: named moist-air states share one psychrometric chart, each with its readouts and ports', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['Tdb = 26', 'RH = 50', 'A = psych(Tdb, RH, "SI")', 'B = psych(13, 95, "SI")', 'q = A.h − B.h']));
  await page.waitForTimeout(500);
  expect(await page.locator('.tape .blk-psych').count() === 1, 'no one chart for the sheet');
  const states = await page.locator('.blk-psych .cv-states .row.blk-pstate').count();
  expect(states === 2, `the states are not in the chart: ${states}`);
  const reads = await page.evaluate(() => [...document.querySelectorAll('.blk-psych .cv-reads')].map((r) => r.innerText.replace(/\s+/g, ' ')));
  expect(reads[0].includes('14.8') && reads[0].includes('°C') && reads[0].includes('g/kg') && reads[0].includes('kJ/kg'), `A's readouts: ${reads[0]}`);
  const ticks = await page.evaluate(() => [...document.querySelectorAll('.cv-fig-psych text')].map((t) => t.textContent));
  expect(ticks.includes('40 °C') && ticks.includes('g/kg') && !ticks.some((t) => /°F|gr\/lb/.test(t)), `the axes mix units: ${ticks.join(' ')}`);
  // q's two wires leave from the h readouts' ports, on the chart's right edge.
  const ports = await page.evaluate(() => {
    const chart = document.querySelector('.blk-psych').getBoundingClientRect();
    const hs = [...document.querySelectorAll('.blk-psych .rd[data-port="h"]')].map((r) => r.getBoundingClientRect());
    const outs = [...document.querySelectorAll('.cv-wires circle.port-out')].map((c) => c.getBoundingClientRect()).map((r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }));
    return hs.map((h) => outs.some((o) => Math.abs(o.x - chart.right) < 3 && Math.abs(o.y - (h.top + h.height / 2)) < 3));
  });
  expect(ports.length === 2 && ports.every(Boolean), `the h ports carry no wires: ${JSON.stringify(ports)}`);
  expect(await page.locator('.cv-wires circle.port-free').count() === 4, 'unused ports are not shown as hollow dots');
  // = shows the numbers only; △ brings the chart back.
  await page.locator('.cv-psych-view button[data-value="numbers"]').click();
  await page.waitForTimeout(200);
  expect(await page.locator('.cv-fig-psych').isHidden(), '= did not hide the chart');
  await page.locator('.cv-psych-view button[data-value="figure"]').click();
  await page.waitForTimeout(200);
  expect(await page.locator('.cv-fig-psych').isVisible(), '△ did not bring the chart back');
});

await check('canvas: dragging a state on the chart moves its sliders or rewrites its line, and arrow keys nudge it', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['Tdb = 26', 'RH = 50', 'A = psych(Tdb, RH, "SI")', 'B = psych(13, 95, "SI")']));
  await page.waitForTimeout(500);
  const a = await page.locator('.cv-fig-psych .fh').first().boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 40, a.y + a.height / 2 - 60, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.slopculator.lines().slice(0, 2).map((l) => l.text));
  expect(after[0] !== 'Tdb = 26' && after[1] !== 'RH = 50' && /^Tdb = \d+(\.5)?$/.test(after[0]), `the sliders did not follow: ${after}`);
  const b = page.locator('.cv-fig-psych .fh').nth(1);
  await b.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.slopculator.lines()[3].text) === 'B = psych(13.5, 95, "SI")', 'ArrowRight did not nudge the dry bulb');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.slopculator.lines()[3].text) === 'B = psych(13.5, 94, "SI")', 'ArrowDown did not nudge the humidity');
  // A click on a state's line edits it in the composer.
  await page.locator('.blk-psych .row.blk-pstate').nth(1).click({ position: { x: 80, y: 14 } });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => !!document.querySelector('.composer.editing')), 'a state did not open in the composer');
});

await check('canvas: a list is a stats block, its readouts wired from their ports; a fit draws its scatter', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['d = [31.2, 33.8, 29.6, 32.4, 30.9, 31.7, 34.1, 32.8, 28.9, 33.2]', 'fk = mean(d) − 1.645 stdev(d)', 'x1 = [2, 4, 6, 8, 10]', 'y1 = [0.41, 0.79, 1.22, 1.6, 2.02]', 'y1 ~ m x1 + b', 'k = 1 / m']));
  await page.waitForTimeout(500);
  expect(await page.locator('.cv-fig-stats').count() === 1, 'the list draws no histogram (or the fit’s lists do)');
  expect(await page.locator('.cv-fig-pairs').count() === 1, 'the fit draws no scatter');
  const labels = await page.evaluate(() => [...document.querySelectorAll('.cv-reads .rd')].map((r) => `${r.querySelector('.k').textContent}:${r.dataset.port ?? ''}`));
  for (const want of ['n:n', 'x̄:mean', 's:s', 'median:median', 'slope:m', 'intercept:b']) expect(labels.includes(want), `no readout ${want}: ${labels}`);
  const wired = await page.evaluate(() => {
    const out = [...document.querySelectorAll('.cv-wires circle.port-out')].map((c) => c.getBoundingClientRect().y);
    return ['mean', 's', 'm'].map((p) => { const r = document.querySelector(`.cv-reads .rd[data-port="${p}"]`).getBoundingClientRect(); return out.some((y) => Math.abs(y + 3 - (r.top + r.height / 2)) < 4); });
  });
  expect(wired.every(Boolean), `a readout read by a line has no wire from its port: ${wired}`);
  // The block's line stays short: a long list shows its first items and an ellipsis.
  expect((await page.locator('.tape .row.blk-reads .tex').first().innerText()).includes('…'), 'the long list is set in full');
});

await check('phone canvas: the psychrometric chart fills the column, its states under it', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['A = psych(80, 50)', 'B = psych(55, 95)', 'q = A.h − B.h']));
  await page.waitForTimeout(500);
  const blk = await page.locator('.tape .blk-psych').boundingBox(), svg = await page.locator('.cv-fig-psych svg').boundingBox(), st = await page.locator('.blk-pstate').first().boundingBox();
  expect(svg.width > blk.width - 40 && svg.x >= blk.x - 1 && svg.x + svg.width <= blk.x + blk.width + 1, `the chart does not fill its block: ${JSON.stringify([blk, svg])}`);
  expect(st.y > svg.y + svg.height - 1, 'the states are not under the chart');
  const ticks = await page.evaluate(() => [...document.querySelectorAll('.cv-fig-psych text')].map((t) => t.textContent));
  expect(ticks.some((t) => t.endsWith('°F')) && ticks.includes('gr/lb'), `°F lines get °C axes: ${ticks.join(' ')}`);
}, true);

await check('the composer sets what is typed as math on one row: × for *, italic names, the answer on the right, a sparkline for a curve', async (page) => {
  const box = await page.locator('.composer').boundingBox();
  await page.keyboard.type('12*7');
  await page.waitForTimeout(150);
  const typed = await page.evaluate(() => ({ text: document.querySelector('.cv-mirror .cv-track').textContent, caret: !document.querySelector('.cv-mirror .cv-caret').hidden, field: getComputedStyle(document.querySelector('.composer .expr')).color }));
  expect(typed.text === '12×7' && typed.caret, `the composer shows ${JSON.stringify(typed)}`);
  expect((await page.locator('.composer .out').innerText()).includes('84'), 'no live answer');
  expect(await page.locator('.composer').getAttribute('data-state') === 'ok', 'the edge does not light once the line works out');
  // The caret goes where a click is in the math.
  const one = await page.locator('.cv-mirror .g').first().boundingBox();
  await page.mouse.click(one.x + one.width * 0.4, one.y + one.height / 2);
  expect(await page.evaluate(() => document.querySelector('.composer .expr').selectionStart) === 1, 'a click in the math does not put the caret there');
  await page.keyboard.press('End');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('y = 2sin(45x)');
  await page.waitForTimeout(150);
  expect(await page.locator('.composer-preview svg path').count() === 1, 'no sparkline for a line that draws');
  const italic = await page.evaluate(() => [...document.querySelectorAll('.cv-mirror .g-var')].map((g) => g.textContent + getComputedStyle(g).fontStyle));
  expect(italic.includes('yitalic') && italic.includes('xitalic') && !italic.some((t) => t.startsWith('s')), `names and functions: ${italic}`);
  const after = await page.locator('.composer').boundingBox();
  expect(Math.abs(after.height - box.height) < 1, `the composer grew from ${box.height} to ${after.height}`);
});

await check('the composer is calm while typing: an error shows only after the pause, short and whole, with the full words on hover', async (page) => {
  await page.keyboard.type('2 + qqq');
  const during = await page.evaluate(() => { const e = document.querySelector('.composer .out .err'); return !!e && e.getBoundingClientRect().width > 0; });
  expect(!during, 'red text while typing');
  const err = page.locator('.composer.shows-error .out .err');
  await err.waitFor({ state: 'visible' });
  const said = await err.evaluate((e) => ({ text: e.textContent, full: e.dataset.full ?? '', cut: e.scrollWidth > e.clientWidth + 1 }));
  expect(said.text === "qqq isn't defined" && !said.cut && /Define it on its own line/.test(said.full), `the composer's error: ${JSON.stringify(said)}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.tape .rows .row.blk .out .err')].some((e) => e.textContent === "qqq isn't defined"), null, { timeout: 5000 });
  await page.evaluate(() => window.slopculator.setLines(['r = sqrt(-3)']));
  await page.waitForFunction(() => document.querySelector('.tape .rows .row.blk .out .err')?.textContent === 'Not real', null, { timeout: 5000 });
});

await check('canvas: the first run shows an editable example; Clear example takes it away with Undo, and File brings it back', async (page) => {
  await page.evaluate(() => { localStorage.removeItem(window.slopKeys.firstRun); localStorage.removeItem(window.slopKeys.document); sessionStorage.setItem('e2e-first-run', '1'); });
  await page.reload();
  await page.waitForFunction(() => !!window.slopculator);
  await page.waitForTimeout(300);
  let l = (await lines(page)).map((x) => x.text);
  expect(JSON.stringify(l) === '["k = 45","y = 2sin(kx)"]', JSON.stringify(l));
  expect(await page.locator('.example-frame').isVisible(), 'no example frame');
  expect(await page.locator('.composer .expr').getAttribute('placeholder') === '12 × 7, or r = 4', 'no first-run placeholder');
  expect(await page.locator('.saved-note').count() === 0, 'the saved note came back');
  expect(!(await page.locator('.example-frame').innerText()).includes('Example'), 'the example frame has a title again');
  expect(await page.locator('.blk-example-graph').isVisible(), "the example has no graph of its own");
  expect(await page.locator('.tape .graph-pane').count() === 0, "the sheet's graph shows with only the example drawing");
  await page.click('.example-clear');
  await page.waitForTimeout(150);
  l = (await lines(page)).map((x) => x.text);
  expect(JSON.stringify(l) === '[""]', `cleared: ${l}`);
  await page.locator('.toast.show button', { hasText: 'Undo' }).click();
  await page.waitForTimeout(150);
  expect((await lines(page)).length === 2, 'Undo did not bring the example back');
  await page.click('.example-clear');
  await page.click('.menu-btn');
  await page.locator('.menu [role=menuitem]', { hasText: 'Start with an example' }).click();
  await page.locator('.examples-dialog .starter-card', { hasText: 'Welcome example' }).click();
  await page.waitForTimeout(150);
  expect((await lines(page)).some((x) => x.text === 'k = 45'), 'Examples did not bring the example back');
  await page.click('.menu-btn');
  await page.locator('.menu [role=menuitem]', { hasText: 'Start with an example' }).click();
  expect(await page.locator('.examples-dialog .starter-card', { hasText: 'Welcome example' }).isHidden(), 'Examples offers the welcome example while it is on the sheet');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(() => !!window.slopculator);
  await page.click('.example-clear');
  await page.reload();
  await page.waitForFunction(() => !!window.slopculator);
  expect(!(await lines(page)).some((x) => x.text === 'k = 45'), 'the example came back by itself');
});

await check('canvas: Fit all, zoom and the keypad toggle; Ctrl+K opens Find', async (page) => {
  for (const t of ['1', '2', '3']) await typeLine(page, t);
  await page.click('.cv-tools .cv-btn:has-text("+")');
  await page.waitForTimeout(300);
  expect((await page.locator('.cv-zoom').innerText()) === '125%', `zoom: ${await page.locator('.cv-zoom').innerText()}`);
  await page.click('.cv-tools .cv-btn:has-text("Fit all")');
  await page.waitForTimeout(300);
  expect(Number((await page.locator('.cv-zoom').innerText()).replace('%', '')) <= 100, 'Fit all zoomed in past 100%');
  const keys = page.locator('#keypad');
  expect(await keys.isVisible(), 'keypad hidden at the start');
  await page.click('.bar-tog[aria-controls=keypad]');
  await page.waitForTimeout(300);
  expect(!(await keys.isVisible()), 'Keypad did not hide the keys');
  await page.keyboard.press('ControlOrMeta+k');
  await page.waitForTimeout(200);
  expect(await page.locator('.palette, [role=dialog].palette, .cmd-palette').first().isVisible(), 'Ctrl+K did not open Find');
});

await check('phone canvas: blocks stack in the sheet\'s order with a wire straight down between them, the composer sits over the keys, and the keypad has no enter', async (page) => {
  await page.locator('#keypad .key[data-key="7"]').tap();
  await page.locator('.composer-enter').tap();
  await page.keyboard.type('a = 2');
  await page.locator('.composer-enter').tap();
  await page.keyboard.type('b = a + 1');
  await page.locator('.composer-enter').tap();
  await page.waitForTimeout(300);
  const tops = await page.evaluate(() => [...document.querySelectorAll('.tape .rows > .row.blk:not(.blk-blank)')].map((r) => r.getBoundingClientRect().top));
  expect(tops.length === 3 && tops.every((t, k) => k === 0 || t > tops[k - 1]), `blocks out of order: ${tops}`);
  const wire = await page.evaluate(() => { const p = document.querySelector('.cv-wires path.w'); return p ? p.getBoundingClientRect().toJSON() : null; });
  expect(wire !== null && wire.width < 2 && wire.height > 4, `no wire straight down: ${JSON.stringify(wire)}`);
  const comp = await page.locator('.composer').boundingBox(), pad = await page.locator('#keypad').boundingBox();
  expect(comp.y + comp.height <= pad.y + 1, 'the composer is not over the keys');
  expect((await page.locator('#keypad .key[data-action=enter]').count()) === 0, 'the keypad still has an enter key');
  expect((await page.locator('.composer-tabs .ti-tab').count()) === 5, 'the tabs are not on the composer');
}, true);

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
  await page.mouse.click(...at(-6, -4));
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
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('dialog.palette .pal-input').fill('Add a table');
  await page.locator('dialog.palette .pal-item', { hasText: 'Add a table' }).first().click();
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

await check('a regression line reads the table, shows its fit and defines m and b; Desmos and LaTeX forms are read and drawn as math', async (page) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('dialog.palette .pal-input').fill('Add a table');
  await page.locator('dialog.palette .pal-item', { hasText: 'Add a table' }).first().click();
  const data = [['1', '3'], ['2', '5'], ['3', '7'], ['4', '9']];
  await page.fill('.tbl thead th:nth-child(2) input', 'y');
  for (let r = 0; r < data.length; r++) for (let c = 0; c < 2; c++) await page.fill(`.tbl input[data-r="${r}"][data-c="${c}"]`, data[r][c]);
  await page.locator('.rows .row .expr').first().click();
  const typed = ['y ~ mx + b', 'm + b', "f(x) = x^3", "f'(2)", 'sum_{n=1}^{10} n^2', '\\frac{1}{2} + \\sqrt{16}', 'int_0^1 x^2 dx', '[1...4]^2'];
  for (const [i, text] of typed.entries()) {
    if (i) await page.keyboard.press('Enter');
    await page.keyboard.type(text);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.rows .row')].filter((r) => r.querySelector('.expr')).map((r) => ({ out: (r.querySelector('.out')?.innerText ?? '').replace(/\s+/g, ' ').trim(), err: !!r.querySelector('.out .err'), math: (r.querySelector('.math')?.textContent ?? '') })));
  const outs = rows.map((r) => r.out);
  expect(!rows.some((r) => r.err), `a line has an error: ${JSON.stringify(outs)}`);
  expect(/Best fit m 2 b 1 R² 1/.test(outs[0]), `the fit: ${outs[0]}`);
  expect(outs[1] === '3' && outs[3] === '12' && outs[4] === '385' && outs[5] === '4.5' && /^0\.3333/.test(outs[6]) && outs[7] === '{1, 4, 9, 16}', `the answers: ${JSON.stringify(outs)}`);
  const named = await page.waitForFunction(() => window.slopculator.graph.names().some((n) => n.text.includes('~')), null, { timeout: 5000 }).then(() => true, () => false);
  expect(named, `the fit isn't drawn with its name: ${JSON.stringify(await page.evaluate(() => window.slopculator.graph.names().map((n) => n.text)))}`);
});

await check('rounding is one slider from Auto to 15 places', async (page) => {
  const places = () => page.evaluate(() => window.slopculator.settings().places);
  const stop = (n) => page.evaluate((v) => { const r = document.querySelector('.round-slider'); r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); }, n);
  // The canvas's bar keeps Deg | Rad; rounding is under Modes.
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
  const answer = await page.evaluate(() => window.slopculator.evaluate('1/3'));
  expect(JSON.stringify(answer).includes('0.333') && !JSON.stringify(answer.result ?? answer).includes('0.3333'), `1/3 at 3 places: ${JSON.stringify(answer)}`);
  await stop(16);
  expect((await places()) === 15, 'last stop is 15 places');
  await stop(0);
  expect((await places()) === null, 'first stop is Auto again');
  await page.click('.modebar .desk-more');
  await page.focus('.mode-menu .round-slider');
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

await check('the line being typed keeps its height while typing, with errors and hints', async (page) => {
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
    // The composer is one row: an error shows on it, on the right, and never makes it taller.
    expect(paused.error === shows && paused.h === start, `${text} after a pause: ${JSON.stringify(paused)}, was ${start}`);
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

await check('desktop: the keypad is the everyday row over a 6 × 4 pad with keys 42 px or more, and the five tabs and AC sit on the composer\'s edge', async (page) => {
  const g = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#keypad .ti-row, #keypad .numpad .krow')].map((r) => [...r.querySelectorAll('.key')].map((k) => ({ h: k.getBoundingClientRect().height, label: k.getAttribute('data-key') })));
    const tabs = [...document.querySelectorAll('.composer-tabs .ti-tab')].map((t) => t.getAttribute('aria-label'));
    const comp = document.querySelector('.composer').getBoundingClientRect(), ac = document.querySelector('.composer-ac').getBoundingClientRect();
    return { rows, tabs, acAbove: ac.bottom <= comp.top + 1 };
  });
  expect(g.rows.length === 5 && g.rows.every((r) => r.length === 6), `rows: ${g.rows.map((r) => r.length)}`);
  expect(g.rows.flat().every((k) => k.h >= 42), `key heights: ${g.rows.map((r) => r[0].h)}`);
  expect(g.rows.map((r) => r.map((k) => k.label).join(' ')).join(' / ') === 'x y π e % ans / ← → 7 8 9 ÷ / xʸ √ 4 5 6 × / ( ) 1 2 3 − / , = 0 . ⌫ +', JSON.stringify(g.rows.map((r) => r.map((k) => k.label))));
  expect(g.tabs.join() === 'Math,Stats,Chance,Matrix,HVAC', `tabs: ${g.tabs}`);
  expect(g.acAbove, 'AC is not on the composer\'s edge');
});
await check('desktop: a tab\'s page swaps inside the keypad under the deck bar, one size on every tab, and never covers the composer', async (page) => {
  const sizes = [];
  for (let i = 0; i < 5; i++) {
    await page.locator('.composer-tabs .ti-tab').nth(i).click();
    await page.waitForTimeout(250);
    const g = await page.evaluate(() => {
      const p = document.querySelector('.ti-page').getBoundingClientRect(), c = document.querySelector('.composer').getBoundingClientRect(), k = document.querySelector('#keypad').getBoundingClientRect(), bar = document.querySelector('.deck-bar').getBoundingClientRect();
      return { p: { t: p.top, b: p.bottom, l: p.left, r: p.right, h: p.height }, compRight: c.right, compBottom: c.bottom, keys: { t: k.top, b: k.bottom, l: k.left, r: k.right }, barBottom: bar.bottom };
    });
    expect(g.p.l >= g.compRight - 1 || g.p.t >= g.compBottom - 1, `tab ${i}: the page runs onto the composer: ${JSON.stringify(g)}`);
    expect(g.p.t >= g.barBottom - 1 && g.p.b <= g.keys.b + 1 && g.p.l >= g.keys.l - 1 && g.p.r <= g.keys.r + 1, `tab ${i}: the page left the keypad card: ${JSON.stringify(g)}`);
    sizes.push(Math.round(g.p.h));
    await page.keyboard.press('Escape');
  }
  expect(new Set(sizes).size === 1, `page heights differ: ${sizes}`);
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
  expect(s.tile === 'asin', `→ then ↓: ${JSON.stringify(s)}`);
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
  expect((await firstRow()) === '← → 7 8 9 ÷', `right: ${await firstRow()}`);
  const box = await page.evaluate(() => document.querySelector('.pad').getBoundingClientRect().height);
  await page.keyboard.press('Control+/');
  await page.keyboard.type('switch number pad');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  expect((await firstRow()) === '÷ 7 8 9 ← →', `left: ${await firstRow()}`);
  const after = await page.evaluate(() => document.querySelector('.pad').getBoundingClientRect().height);
  expect(after === box, `pad height ${box} became ${after}`);
  // The side is saved a moment later (saveSoon); reload only once it's in storage, which a fixed wait didn't always cover on CI.
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => (localStorage.getItem(k) ?? '').includes('"padLeft":true')), null, { timeout: 5000 });
  await page.reload();
  await page.waitForTimeout(150);
  expect((await firstRow()) === '÷ 7 8 9 ← →', `after reload: ${await firstRow()}`);
  await page.click('.keys .key:has-text("7")');
  await page.click('.keys .key:has-text("×")');
  await page.click('.keys .key:has-text("6")');
  await page.waitForTimeout(100);
  expect((await page.textContent('.row.active .result .val')).trim() === '42', `7 * 6: ${await page.textContent('.row.active .result')}`);
});

await check('the line being typed shows its error on its row, whole on hover, and a line left shows it under it', async (page) => {
  await page.keyboard.type('nCr(7,5)*0.56)');
  const during = await page.evaluate(() => { const e = document.querySelector('.row.active .err'); return !!e && e.getBoundingClientRect().width > 0; });
  expect(!during, 'no error while typing');
  await page.waitForTimeout(750);
  const row = await page.evaluate(() => {
    const expr = document.querySelector('.row.active .expr').getBoundingClientRect();
    const err = document.querySelector('.row.active .err');
    const box = err?.getBoundingClientRect();
    return { hasError: document.querySelector('.row.active').classList.contains('has-error'), shown: !!box && box.width > 0, beside: !!box && box.top < expr.bottom && box.left >= expr.right - 1, whole: !!err && /Unmatched/.test(err.title) };
  });
  expect(row.hasError && row.shown && row.beside && row.whole, `active row: ${JSON.stringify(row)}`);
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
  await toNewLine(page);
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
  // On the canvas a value's block reads what was asked, then its answer under it.
  const under = await page.evaluate(() => {
    const r = document.querySelectorAll('.rows .row')[2];
    const a = r.querySelector('.tex').getBoundingClientRect(), b = r.querySelector('.result').getBoundingClientRect();
    return b.top >= a.bottom - 2 && Math.abs(b.left - a.left) < 16;
  });
  expect(under, 'the answer sits under its expression');
  const box = await page.locator('.rows .row').nth(2).locator('.tex .m-run').first().boundingBox();
  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
  await page.waitForTimeout(100);
  const open = await page.evaluate(() => {
    const i = document.activeElement;
    return { value: i.value, caret: i.selectionStart, active: i.closest('.row').classList.contains('active'), inComposer: !!i.closest('.composer') };
  });
  expect(open.value === '2+3' && open.caret === 1 && open.active && open.inComposer, `opened: ${JSON.stringify(open)}`);
  expect(await page.locator('.blk-ghost').isVisible(), 'no ghost where the line waits while it is edited');
  const after = await read();
  expect(after[1].typeset, 'a line not being edited stays typeset');
  await page.keyboard.press('ArrowDown');
  expect((await page.evaluate(() => document.activeElement.value)) === 'normcdf(1', 'arrow keys move between lines');
});

await check('All + combines lines, leaving empty ones out with a note', async (page) => {
  await page.evaluate(() => window.slopculator.setSettings({ lineNames: true }));
  // The composer never sends an empty line, so the sheet with one in the middle comes from the page API.
  await page.evaluate(() => window.slopculator.setLines(['10', '', '5', '']));
  await page.waitForTimeout(100);
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('dialog.palette .pal-input').fill('Add all lines');
  await page.locator('dialog.palette .pal-item', { hasText: 'Add all lines' }).first().click();
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

await check('desktop: the top bar keeps Deg | Rad, the canvas zoom, Find and Keypad, and Modes holds every other mode', async (page) => {
  const shown = await page.evaluate(() => [...document.querySelectorAll('.modebar .desk-modes > *')].filter((e) => e.offsetParent).map((e) => e.textContent.trim()));
  expect(shown.length === 1 && shown[0].includes('Deg') && shown[0].includes('Rad'), `the bar's modes: ${shown}`);
  for (const sel of ['.cv-tools', '.head-find', '.bar-tog[aria-controls=keypad]', '.desk-more']) expect(await page.locator(`.modebar ${sel}`).isVisible(), `${sel} is not on the bar`);
  await page.click('.modebar .desk-more');
  const rows = await page.evaluate(() => [...document.querySelectorAll('.mode-menu .mode-row')].filter((r) => !r.hidden).map((r) => r.textContent));
  for (const want of ['Answers', 'Std dev', 'Rounding', 'Also']) expect(rows.some((r) => r.includes(want)), `Modes has no ${want}: ${rows}`);
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
  // Esc leaves the line being edited for the composer's new line.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Alt+c');
  await page.waitForTimeout(150);
  expect((await page.evaluate(() => navigator.clipboard.readText())) === '4', 'an empty line copies the last answer');
});

const openMatrixGrid = async (page) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('matrix builder');
  await page.waitForTimeout(150);
  await page.locator('.pal-item', { hasText: 'Matrix builder…' }).first().click();
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
    const r = last.getBoundingClientRect(), list = last.closest('.row').getBoundingClientRect();
    const box = last.querySelector('.mat-scroll');
    return { right: r.right, edge: list.right, scrolls: box.scrollWidth > box.clientWidth + 1 };
  });
  expect(fit.right <= fit.edge + 0.5, 'matrix runs past its block: ' + JSON.stringify(fit));
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
  await toNewLine(page);
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
  expect(JSON.stringify(await keys()) === '{"rows":1,"pad":4,"up":true}', `after reloads: ${JSON.stringify(await keys())}`);
  await page.click('.menu-btn');
  await page.locator('.menu button', { hasText: 'Open "Mine"' }).click();
  await page.waitForTimeout(300);
  expect(JSON.stringify(await keys()) === '{"rows":1,"pad":4,"up":true}', `after opening: ${JSON.stringify(await keys())}`);
  await page.click('.menu-btn');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.menu button', { hasText: 'Import' }).click()]);
  await chooser.setFiles({ name: 'calc.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ rows: [{ id: 'a', kind: 'expr', text: '1+1' }], ui: { bank: 'Calc', panel: 0 } })) });
  await page.waitForTimeout(400);
  expect(JSON.stringify(await keys()) === '{"rows":1,"pad":4,"up":true}', `after importing: ${JSON.stringify(await keys())}`);
  expect((await lines(page))[0].text === '1+1', 'the file did not open');
});

await check('Modern is the default look', async (page) => {
  const look = () => page.evaluate(() => document.documentElement.dataset.look);
  const font = () => page.evaluate(() => getComputedStyle(document.querySelector('.modebar .desk-modes .seg button')).fontFamily);
  expect((await look()) === 'modern', 'starts Modern');
  expect((await font()).includes('Schibsted Grotesk'), await font());
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
    page.waitForSelector('.tape .rows .row.shake', { state: 'attached', timeout: 5000 }),
    page.waitForSelector('.composer-slot .row.enter', { state: 'attached', timeout: 5000 }),
    page.keyboard.press('Enter'),
  ]);
  await page.waitForFunction(() => !document.querySelector('.composer-slot .row.enter'), null, { timeout: 5000 }).catch(() => {});
  await page.keyboard.type('1+1');
  // The next line sliding into the composer says this Enter has been handled.
  await Promise.all([page.waitForSelector('.composer-slot .row.enter', { state: 'attached', timeout: 5000 }), page.keyboard.press('Enter')]);
  // Under load the block can land after the composer's slide: wait for it, not a time.
  await page.waitForFunction(() => [...document.querySelectorAll('.tape .rows .row.blk')].some((r) => r.querySelector('input.expr')?.value === '1+1'), null, { timeout: 5000 });
  expect(!(await (await blockOf(page, '1+1')).evaluate((el) => el.classList.contains('shake'))), 'a working line does not shake');
});

// The three follow-ups from #15. The fixes are in the script, not the stylesheets, but the two looks build their
// keypads differently enough to run the keypad one in both. Selecting an error and the graph's PNG run in one.
const setLook = async () => {};
for (const look of ['modern']) {
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
    // The composer shows the error only once typing pauses.
    const mark = page.locator('.composer.shows-error .row.active .err.marked');
    await mark.waitFor({ state: 'visible' });
    expect((await mark.textContent()).includes('qqq'), `error: ${await mark.textContent()}`);
    await mark.click();
    await page.waitForTimeout(100);
    const sel = await page.evaluate(() => { const i = document.querySelector('.rows .expr'); return [i.selectionStart, i.selectionEnd, document.activeElement === i]; });
    expect(sel[0] === 0 && sel[1] === 3 && sel[2], `selection ${sel.join(',')}`);
  });

  if (look === 'modern') await check(`${look}: a PNG of a graph pane that has never been shown is not blank`, async (page) => {
    await setLook(page, look);
    await page.keyboard.press('Control+Alt+Shift+G');
    // Reload only once the hidden graph is saved; a slow machine can take longer than any fixed wait.
    await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('slopculator:v1') || '{}').ui?.graph === false; } catch { return false; } }, null, { timeout: 8000 });
    await page.reload();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => !document.querySelector('.graph-pane')?.isConnected), 'the graph block is shown after the reload');
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
  await page.waitForFunction(() => document.documentElement.dataset.motion === 'off', null, { timeout: 8000 }).catch(() => {});
  expect((await page.getAttribute('html', 'data-motion')) === 'off', 'Off survives a reload');
});

await check('Default look is OLED black with Aurora Glow on and Keyboard Glow removed', async (page) => {
  const attrs = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    glow: document.documentElement.hasAttribute('data-glow'),
    keyGlow: document.documentElement.hasAttribute('data-keyglow'),
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
  }));
  expect(attrs.theme === 'oled', `default theme is oled, got ${attrs.theme}`);
  expect(attrs.glow, 'Aurora Glow should be on by default');
  expect(!attrs.keyGlow, 'Keyboard Glow should not be active');
  expect(attrs.bg === '#000' || attrs.bg === '#000000', `default background is OLED black, got ${attrs.bg}`);
});

for (const look of ['modern']) {
  await check(`${look}: the modes sit in the top bar`, async (page) => {
    await setLook(page, look);
    await page.waitForTimeout(200);
    const bar = await page.locator('.modebar').boundingBox();
    const pill = await page.locator('.modebar .desk-modes .seg').first().boundingBox();
    expect(pill.y >= bar.y && pill.y + pill.height <= bar.y + bar.height, `pill ${JSON.stringify(pill)} outside the bar ${JSON.stringify(bar)}`);
    await page.screenshot({ path: `.shots/e2e-${look}-no-display.png` });
  });
}

await check('clearing shows Undo over the composer, saying what was cleared, keys shown or hidden, and Undo works', async (page) => {
  await page.locator('.row input').first().fill('6*7');
  for (const keys of [true, false]) {
    if (!keys) {
      await page.keyboard.press('Control+Alt+Shift+K');
      await page.waitForFunction(() => document.querySelector('.keypad').hidden);
    }
    await page.click('.clear-all');
    const label = page.locator('.toast.show button');
    expect((await label.textContent()) === 'Undo', 'an Undo button');
    expect((await page.locator('.toast.show span').textContent()) === 'Cleared every line' && (await page.locator('.toast.show span').getAttribute('class')) !== 'sr-only', 'the toast says what was cleared');
    const g = await page.evaluate(() => ({ t: document.querySelector('.toast').getBoundingClientRect().toJSON(), c: document.querySelector('.composer-dock').getBoundingClientRect().toJSON() }));
    expect(g.t.bottom <= g.c.top && g.t.left >= g.c.left - 1 && g.t.right <= g.c.right + 1, `toast not over the composer (keys ${keys}): ${JSON.stringify(g)}`);
    await label.click();
    expect((await lines(page))[0]?.text === '6*7', 'Undo brings the line back');
  }
});

await check('phone: the top bar is one row with a Modes button, and the sheet holds every mode', async (page) => {
  expect(await page.isVisible('.keypad .numpad .key') && await page.isHidden('.keys-toggle'), 'a phone keeps its keypad and has no Keys button');
  for (const look of ['modern']) {
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
    // Modes says so in words, as on the phone apps.
    expect((await page.locator('.modebar .pill.more').innerText()).trim().toLowerCase() === 'modes', `${look}: Modes is not a word pill: ${await page.locator('.modebar .pill.more').innerText()}`);
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
  expect(JSON.stringify(switches) === '["Node canvas","Percent probabilities","Line letters","Complex numbers"]', `switches: ${switches}`);
  expect(await page.isVisible('.mode-sheet .ms-round'), 'rounding is in the sheet');
  await page.locator('.mode-sheet .choice').nth(0).locator('button').nth(1).tap();
  await page.waitForTimeout(100);
  const r = await lines(page);
  expect(Math.abs(Number(r[0].value) - Math.sin(30)) < 1e-9, `recomputed in radians: ${JSON.stringify(r[0])}`);
  await page.locator('.mode-sheet .choice').nth(0).locator('button').nth(0).tap();
  await page.locator('.mode-sheet .ms-switch').nth(1).tap();
  expect(await page.evaluate(() => window.slopculator.settings().percent), 'percent turns on from the sheet');
  await page.locator('.mode-sheet .ms-switch').nth(2).tap();
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
  const i = await page.evaluate((l) => [...document.querySelectorAll('.keypad .key, .composer .key')].findIndex((k) => k.offsetParent && (k.querySelector('.kl')?.textContent === l || k.getAttribute('aria-label') === l)), label);
  if (i < 0) throw new Error(`no key ${label}`);
  await page.locator('.keypad .key, .composer .key').nth(i).tap();
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
    await tapKey(page, 'ENTER');
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
  // First tap selects the block in place and opens its quick-action bar; second tap (or Edit) enters edit mode.
  await page.touchscreen.tap(box.x + box.width - 4, box.y + box.height / 2);
  await page.waitForTimeout(150);
  expect(await page.locator('.mobile-actions .mob-act-edit').isVisible(), 'first tap on phone did not show quick actions');
  expect(!(await page.evaluate(() => !!document.querySelector('.composer.editing'))), 'first tap on phone opened editor immediately');
  await page.touchscreen.tap(box.x + box.width - 4, box.y + box.height / 2);
  await page.waitForTimeout(250);
  expect(await page.locator('.blk-editing-pin').isVisible(), 'edited block disappeared from phone column');
  l = await lineNow(page);
  expect(l.text === 'poissoncdf(2)' && l.caret === 12, `the caret after a tap at the end: ${JSON.stringify(l)}`);
  await tapKeys(page, ',3');
  await page.waitForTimeout(200);
  expect((await lineNow(page)).text === 'poissoncdf(2,3)', `typed on: ${(await lineNow(page)).text}`);
}, true);

await check('phone: det offers Build matrix…, opens inline Matrix Builder, and det of [[1, 2], [3, 4]] is −2', async (page) => {
  await page.locator('.rows .row .expr').first().tap();
  await tapTab(page, 'Matrix');
  await tapTile(page, 'det');
  let l = await lineNow(page);
  expect(l.text === 'det()' && l.calm && !l.red && /Build matrix/.test(l.hint), `det(): ${JSON.stringify(l)}`);
  await page.locator('.hint-line .grid-chip', { hasText: 'Build matrix' }).tap();
  await page.waitForSelector('dialog.mx.mx-matrix[open]');
  expect(!(await page.locator('dialog.mx .mx-name').count()), 'inline matrix builder omits the Name field');
  await page.locator('dialog.mx [data-r="0"][data-c="0"]').fill('1');
  await page.locator('dialog.mx [data-r="0"][data-c="1"]').fill('2');
  await page.locator('dialog.mx [data-r="1"][data-c="0"]').fill('3');
  await page.locator('dialog.mx [data-r="1"][data-c="1"]').fill('4');
  await page.locator('dialog.mx button.primary').tap();
  await page.waitForTimeout(250);
  l = await lineNow(page);
  expect(l.text === 'det([[1, 2], [3, 4]])' && l.out === '−2', `det: ${JSON.stringify(l)}`);
}, true);

await check('phone: 123 swaps back from any tab to the number pad, and its keys type immediately', async (page) => {
  await page.locator('.rows .row .expr').first().tap();
  await tapTab(page, 'Math');
  await page.locator('.ti-close').tap();
  await tapKey(page, '7');
  expect(!(await pageOpen(page)) && (await lineNow(page)).text === '7', `a digit: ${await pageOpen(page)} ${(await lineNow(page)).text}`);
  await tapTab(page, 'Stats');
  await page.locator('.ti-close').tap();
  await tapKey(page, '×');
  expect(!(await pageOpen(page)) && (await lineNow(page)).text === '7*', `× : ${(await lineNow(page)).text}`);
  await tapTab(page, 'HVAC');
  await page.locator('.ti-close').tap();
  await tapKey(page, 'π');
  expect(!(await pageOpen(page)) && (await lineNow(page)).text === '7*π', `π: ${(await lineNow(page)).text}`);
}, true);

await check('phone: AC clears every line, its Undo pill says so for 10 s, and Undo brings every line back', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['6*7', '2+2', '']));
  await page.waitForTimeout(200);
  await freezeClock(page);
  await page.locator('.deck-ac').tap();
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
    // The colours are read the moment a theme lands, not partway through the tabs' fade to it.
    const still = document.createElement('style');
    still.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.append(still);
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (x, y) => { const [a, b] = [lum(rgb(x)), lum(rgb(y))]; return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    for (const look of ['modern']) for (const theme of ['paper', 'ink', 'oled', 'contrast']) {
      window.slopculator.setSettings({ theme });
      // Until the page wears the theme just chosen (a slow machine takes longer than any fixed wait), then two frames.
      const want = theme;
      for (let f = 0; f < 240 && document.documentElement.dataset.theme !== want; f++) await new Promise((r) => requestAnimationFrame(r));
      for (let f = 0; f < 2; f++) await new Promise((r) => requestAnimationFrame(r));
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

await check('phone, one-handed: 48 and 56 px keys up to the seam, operators down the right edge, enter on the composer the one filled key', async (page) => {
  for (const look of ['modern']) {
    await setLook(page, look);
    await page.waitForTimeout(200);
    const g = await page.evaluate(() => {
      const r = (e) => { const x = e.getBoundingClientRect(); return { l: x.left, r: x.right, t: x.top, b: x.bottom, h: x.height, w: x.width }; };
      const kp = document.querySelector('.keypad');
      const bar = kp.querySelector('.deck-bar');
      const pad = [...document.querySelectorAll('.numpad .krow')].map((row) => [...row.querySelectorAll('.key')].map((k) => ({ ...r(k), label: k.getAttribute('aria-label').split(':')[0] })));
      const index = [...document.querySelectorAll('.ti-row .key')].map(r);
      return {
        keypadTop: bar ? bar.getBoundingClientRect().bottom : kp.getBoundingClientRect().top + parseFloat(getComputedStyle(kp).borderTopWidth), firstTop: Math.min(...index.map((k) => k.t)),
        index: index.map((k) => k.h), pad,
        filled: [...document.querySelectorAll('.keys .key, .composer .key')].filter((k) => k.offsetParent && k.classList.contains('hero')).map((k) => k.textContent.trim()),
        enterOnComposer: !!document.querySelector('.composer .key[data-action=enter]')?.offsetParent,
      };
    });
    const lip = look === 'retro' ? 2 : 0;
    expect(g.index.length === 6 && g.index.every((h) => Math.abs(h - (48 - lip)) < 1), `${look}: the everyday row ${g.index}`);
    expect(g.pad.every((row) => row.every((k) => Math.abs(k.h - (56 - lip)) < 1)), `${look}: pad rows ${g.pad.map((r) => r[0].h)}`);
    expect(g.firstTop - g.keypadTop <= (look === 'retro' ? 16 : 10), `${look}: ${Math.round(g.firstTop - g.keypadTop)} px from the seam to the keys`);
    expect(g.pad.map((r) => r.map((k) => k.label).join(' ')).join(' / ') === '← → 7 8 9 ÷ / xʸ √ 4 5 6 × / ( ) 1 2 3 − / , = 0 . ⌫ +', `${look}: pad ${g.pad.map((r) => r.map((k) => k.label).join(' ')).join(' / ')}`);
    const col = g.pad.map((r) => r[5]);
    expect(col.every((k) => Math.abs(k.r - g.pad[0][5].r) < 0.6) && col.every((k, i) => i === 0 || k.t > col[i - 1].t), `${look}: the right column`);
    expect(g.filled.join() === 'ENTER' && g.enterOnComposer, `${look}: filled keys ${g.filled}`);
  }
}, true);

await check('phone, one-handed: the left-hand pad mirrors every group, operators down the left edge with ÷ at the top', async (page) => {
  await page.keyboard.press('Control+/');
  await page.keyboard.type('switch number pad');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const g = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.numpad .krow')].map((row) => [...row.querySelectorAll('.key')].map((k) => k.getAttribute('aria-label').split(':')[0]));
    const index = [...document.querySelectorAll('.ti-row')].map((row) => [...row.querySelectorAll('.key')].map((k) => k.querySelector('.kl').textContent));
    const keys = document.querySelector('.keys').getBoundingClientRect();
    return { rows, index, div: document.querySelector('.numpad .key[data-key="÷"]').getBoundingClientRect().left - keys.left };
  });
  expect(g.rows.map((r) => r.join(' ')).join(' / ') === '÷ 7 8 9 ← → / × 4 5 6 xʸ √ / − 1 2 3 ( ) / + 0 . ⌫ , =', `rows ${JSON.stringify(g.rows)}`);
  expect(g.index.map((r) => r.join(' ')).join(' / ') === 'x y π e % ans', `the everyday row: ${JSON.stringify(g.index)}`);
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

for (const look of ['modern']) {
  await check(`375 px phone, ${look}: ⌫ and the caret keys need no caption, every label 12 px or more, every tile whole and the keys never covered`, async (page) => {
    await setLook(page, look);
    await page.waitForTimeout(200);
    for (const label of ['←', '→', '⌫']) expect(!(await page.$(`.numpad .key[aria-label^="${label}"] .ks`)), `${look} ${label} still has a caption`);
    const arrow = await page.locator('.numpad .key[aria-label^="←"] .kicon').boundingBox();
    expect(arrow && arrow.width >= 18, `the arrow is ${arrow?.width} px`);
    const bad = await labelProblems(page);
    expect(!bad.length, `${look}: ${bad.join(', ')}`);
    const tiles = await tileProblems(page, 24);
    expect(!tiles.length, `${look}: ${tiles.join(', ')}`);
    await tapTab(page, 'HVAC');
    const o = await page.evaluate(() => [document.querySelector('.ti-page').getBoundingClientRect().top, document.querySelector('.composer-dock').getBoundingClientRect().bottom]);
    expect(o[0] >= o[1] - 1, `${look}: the keypad-swap deck covers the composer/canvas: ${o}`);
  }, { width: 375, height: 667 });
}

await check('phone: ⌫ (no caption) turns red as the hold nears, clears the line at 800 ms, and Undo brings it back', async (page) => {
  await page.keyboard.type('12345');
  await page.evaluate(() => document.querySelector('.row.active .expr').setSelectionRange(3, 3));
  const back = page.locator('.numpad .key[data-action="back"]');
  expect((await back.count()) === 1 && (await back.locator('.ks').count()) === 0, 'the ⌫ caption came back');
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
    expect((await page.textContent('.out.long-answer .long-cue:not([hidden])')) === '1,998 digits', 'no digit cue under the box that overflows');
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

const paneShown = (page) => page.evaluate(() => !!document.querySelector('.tape .graph-pane')?.offsetParent);
await check('Hide graph in Modes wins over a plottable line, and Show graph keeps it on an empty sheet', async (page) => {
  await page.keyboard.type('y = x^2');
  await page.waitForTimeout(500);
  await page.click('.modebar .desk-more');
  await page.locator('.mode-menu button', { hasText: 'Graph' }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(!(await paneShown(page)), 'Hide graph left it up');
  await page.reload();
  await page.waitForTimeout(400);
  expect(!(await paneShown(page)), 'the choice did not survive a reload');
  await page.click('.modebar .desk-more');
  await page.locator('.mode-menu button', { hasText: 'Graph' }).click();
  await page.keyboard.press('Escape');
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

await check('desktop: the keypad is as tall as its keys; a hint over it says what the key or tile you point at does, on up to two lines, and is gone at rest', async (page) => {
  const hint = () => page.textContent('.key-hint');
  expect(!(await page.isVisible('.key-hint')) && (await hint()) === '', `the hint at rest: ${await hint()}`);
  const fit = await page.evaluate(() => { const k = document.querySelector('.keypad').getBoundingClientRect(), p = document.querySelector('.pad').getBoundingClientRect(); return { gap: k.bottom - p.bottom }; });
  expect(fit.gap <= 14, `the keypad has room under its keys: ${JSON.stringify(fit)}`);
  await page.locator('.numpad .key', { hasText: /^7$/ }).first().hover();
  await page.waitForTimeout(150);
  expect((await hint()) === '', `a digit types itself, so it has no hint: ${await hint()}`);
  await page.locator('.composer-enter').hover();
  await page.waitForTimeout(150);
  expect((await hint()) === '' && !(await page.locator('.composer-enter').getAttribute('title')), `ENTER needs no hint or tooltip: ${await hint()}`);
  expect((await page.locator('.rail-list').textContent()).trim() === '', 'empty rail should stay blank');
  await page.locator('.numpad .key[data-action="back"]').first().hover();
  await page.waitForTimeout(100);
  expect((await hint()).length > 4, `pointing at ⌫: ${await hint()}`);
  const over = await page.evaluate(() => [document.querySelector('.key-hint').getBoundingClientRect().bottom, document.querySelector('.keypad').getBoundingClientRect().top]);
  expect(await page.isVisible('.key-hint') && over[0] <= over[1], `the hint is not over the keypad: ${over}`);
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

await check('File keeps files; motion and keypad preferences are in Appearance', async (page) => {
  await page.click('.menu-btn');
  const file = await page.locator('.menu-wrap:not(.appear-wrap) > .menu').textContent();
  for (const word of ['New sheet', 'Open', 'Save', 'Duplicate', 'Rename', 'Export', 'Import', 'PNG', 'SVG']) expect(file.includes(word), `File lost ${word}`);
  for (const word of ['History', 'Clear all', 'Show the example again']) expect(!file.includes(word), `File still has ${word}`);
  expect(await page.isVisible('.head-pill .head-history'), 'History is not beside File');
  for (const word of ['Look', 'Theme', 'Color', 'Motion']) expect(!file.includes(word), `File still has ${word}`);
  expect((await page.locator('.menu-wrap:not(.appear-wrap) > .menu :is(select, .swatch)').count()) === 0, 'File still has pickers');
  await page.click('.appear-btn');
  expect(await page.isHidden('.menu-wrap:not(.appear-wrap) > .menu'), 'File stayed open under Appearance');
  expect(await page.isVisible('.appear-menu'), 'Appearance did not open');
  for (const q of ['select.motion', '.seg']) expect(await page.locator(`.appear-menu ${q}`).first().isVisible(), `Appearance has no ${q}`);
  await page.keyboard.press('Escape');
  expect(await page.isHidden('.appear-menu'), 'Escape left Appearance open');
  expect(await page.evaluate(() => document.activeElement.classList.contains('appear-btn')), 'focus did not go back to the button');
});

await check('phone: Appearance is in the Modes sheet', async (page) => {
  expect(await page.isHidden('.appear-btn'), 'a sliders button for Appearance in a phone top bar');
  await page.locator('.modebar .modes .pill.more').tap();
  await page.waitForTimeout(450);
  for (const q of ['select.motion']) expect(await page.locator(`.mode-sheet ${q}`).first().isVisible(), `the sheet has no ${q}`);
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
await check('desktop: AC on the composer\'s edge shows its legend in every look and theme', async (page) => {
  const bad = await page.evaluate(async () => {
    const out = [];
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    for (const look of ['modern']) for (const theme of ['paper', 'ink', 'oled', 'contrast']) {
      window.slopculator.setSettings({ theme });
      await new Promise((r) => setTimeout(r, 120));
      const k = document.querySelector('.composer-ac');
      const l = k.querySelector('.kl'), lc = getComputedStyle(l);
      // AC is a word on the composer's edge, over the stage behind it.
      const kc = getComputedStyle(document.querySelector('.composer-dock').closest('.left'));
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
  expect(got[0].font.includes('Schibsted Grotesk') && !got[0].font.includes('Mono') && got[0].nums.includes('tabular-nums'), JSON.stringify(got[0]));
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

for (const look of ['modern']) {
  await check(`${look}: a parser error reads in plain words, with the parser's message kept in its title`, async (page) => {
    await setLook(page, look);
    await page.evaluate(() => window.slopculator.setLines(['normcdf(1', '2 +', '1 + 2)', '']));
    await page.waitForTimeout(400);
    const errs = await page.$$eval('.row .err', (es) => es.map((e) => [e.textContent, e.title.split('\n')[0], e.getBoundingClientRect().height]));
    expect(errs.length === 3, JSON.stringify(errs));
    expect(errs[0][0] === 'normcdf( is missing a )' && errs[0][1] === 'Expected ")" to close normcdf(, got end of input', JSON.stringify(errs[0]));
    expect(errs[1][0] === 'Unfinished' && errs[2][0] === 'Extra )', JSON.stringify(errs));
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

await check('one popover at a time, a line menu acts on its line where it is now, and Ctrl+Alt waits for a dialog', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['1+1', '2+2', '3+3']));
  await page.waitForTimeout(300);
  await page.click('.menu-btn');
  await page.locator('.modebar .desk-more').click();
  expect(await page.isVisible('.mode-menu') && (await page.getAttribute('.menu-btn', 'aria-expanded')) === 'false', 'the modes menu and File are both open');
  await page.locator('.rows .row').nth(2).click({ button: 'right', position: { x: 40, y: 14 } });
  expect(await page.isVisible('.line-menu') && await page.isHidden('.mode-menu'), 'the line menu and the modes menu are both open');
  await page.click('.appear-btn');
  expect(await page.isVisible('.appear-menu') && !(await page.$('.line-menu')), 'Appearance and the line menu are both open');
  await page.keyboard.press('Escape');
  await page.locator('.rows .row').nth(2).click({ button: 'right', position: { x: 40, y: 14 } });
  await page.evaluate(() => { const mac = /Mac/.test(navigator.platform); document.querySelector('.rows .expr').dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', ctrlKey: !mac, metaKey: mac, shiftKey: true, bubbles: true })); });
  await page.waitForTimeout(100);
  await page.locator('.line-menu button', { hasText: 'Move up' }).click();
  await page.waitForTimeout(150);
  expect((await lines(page)).map((r) => r.text).join() === '3+3,2+2', `Move up after line 1 went: ${JSON.stringify(await lines(page))}`);
  await page.locator('.rows .row').nth(0).click({ button: 'right', position: { x: 40, y: 14 } });
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
  await toNewLine(page);
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
  await toNewLine(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('7+5');
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+Alt+Shift+n');
  await page.waitForTimeout(150);
  const blank = await page.evaluate(() => window.slopculator.lines().map((l) => l.text).filter(Boolean));
  expect(blank.length === 0, `New sheet: ${blank}`);
  expect((await page.textContent('.toast')).includes('New sheet'), `New sheet toast: ${await page.textContent('.toast')}`);
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
  await toNewLine(page);
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
  await drawSomething(page);
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
  // The toast sits over the composer, clear of it and of the keys, with room for what was done as well as Undo.
  const t = await page.evaluate(() => { const r = document.querySelector('.toast').getBoundingClientRect(), c = document.querySelector('.composer-dock').getBoundingClientRect(), k = document.querySelector('.keypad').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, ct: c.top, cl: c.left, cr: c.right, kl: k.left, kt: k.top, text: document.querySelector('.toast').innerText }; });
  expect(t.b <= t.ct && t.l >= t.cl - 1 && t.r <= t.cr + 1 && (t.r <= t.kl || t.b <= t.kt), `toast not over the composer: ${JSON.stringify(t)}`);
  expect(/Undo/.test(t.text) && t.text.replace('Undo', '').trim().length > 0, `the toast says what was done as well as Undo: ${t.text}`);
});

await check('UX 7 phone: the keypad ) steps over the one a function put in, the toast sits above the keys, no shortcuts in the line menu', async (page) => {
  await page.locator('.rows .row .expr').first().tap();
  const tapKey = (label) => page.evaluate((label) => [...document.querySelectorAll('.keypad .key, .composer .key')].find((k) => k.querySelector('.kl')?.textContent.replace(/\s/g, '') === label && k.offsetParent).click(), label);
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


await check('R3 keys: one caption rule, no "above" or "move", no caption on ⌫, and AC is off its keys', async (page) => {
  const g = await page.evaluate(() => {
    const cap = (label) => [...document.querySelectorAll('.keypad .key, .composer .key')].find((k) => k.getAttribute('aria-label')?.startsWith(label) && k.offsetParent)?.querySelector('.ks');
    const ks = [...document.querySelectorAll('.keypad .key .ks')].filter((e) => e.offsetParent);
    return { ans: !!cap('ans'), left: !!cap('←'), back: cap('⌫')?.textContent, ac: cap('AC')?.textContent, sizes: [...new Set(ks.map((e) => getComputedStyle(e).fontSize))], one: ks.every((e) => e.scrollHeight <= 14) };
  });
  expect(!g.ans && !g.left, `redundant captions: ${JSON.stringify(g)}`);
  expect(g.back === undefined && g.ac === undefined, `⌫ and AC captions: ${JSON.stringify(g)}`);
  expect(g.sizes.length <= 1 && g.one, `caption sizes: ${JSON.stringify(g)}`);
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
  await toNewLine(page);
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

await check('UX2 5-6: the phone File menu is short and pure, and Reorder lines lives in the line menu and moves lines undoably', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['1', '2', '3']));
  await page.waitForTimeout(200);
  await page.locator('.menu-btn').tap();
  await page.waitForTimeout(150);
  const items = await page.$$eval('.menu [role=menuitem]', (els) => els.map((e) => e.textContent.trim()));
  expect(['New sheet', 'Open…', 'Duplicate', 'Rename…', 'Copy as text', 'Start with an example…'].every((w) => items.includes(w)), `menu: ${items}`);
  expect(!items.some((t) => /History|Clear all/.test(t)), `History and Clear all left File: ${items}`);
  expect(await page.locator('.head-pill .head-history').isVisible(), 'History is not beside File on a phone');
  expect(!items.some((t) => /palette|shortcuts|key sounds|Number pad|Hide keypad|Hide graph|Combine|Reorder|system keyboard|Add a table/i.test(t)), `extras on a phone: ${items}`);
  await page.locator('.menu-btn').tap();
  await page.waitForTimeout(100);
  // Open Reorder lines from a line's context menu.
  await page.locator('.tape .rows > .row.blk').first().click({ button: 'right' });
  await page.waitForTimeout(150);
  await page.locator('.line-menu [role=menuitem]', { hasText: 'Reorder lines' }).tap();
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
  expect(!op.err && op.hint === 'Unfinished', `while typing 2*: ${JSON.stringify(op)}`);
  const hintState = () => page.evaluate(() => { const r = document.querySelector('.rows .row'); const hint = r.querySelector('.out .calm-hint'); return { h: Math.round(r.getBoundingClientRect().height), shown: !!hint && getComputedStyle(hint).display !== 'none' }; });
  const before = await hintState();
  // (Brackets close as they're typed, so 2*(3 would be 2*(3), finished.)
  await page.keyboard.type('-');
  const during = await hintState();
  await page.keyboard.type('(');
  const during2 = await hintState();
  expect(before.shown && during.shown && during2.shown && before.h === during.h && during.h === during2.h, `the hint holds while typing on: ${JSON.stringify([before, during, during2])}`);
  // Leaving the line: a click on the canvas.
  await page.mouse.click(700, 300);
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

// Only the narrowest desktop width can overflow.
for (const width of [1366]) {
  await check(`R4 desktop ${width}: switching look refolds the bar, so ? stays in the window`, async (page) => {
    await page.setViewportSize({ width, height: 900 });
    for (const look of ['modern']) {
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
  await toNewLine(page);
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
  await toNewLine(page);
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
  await page.locator('.composer .expr').click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.waitForTimeout(200);
  expect((await texts(page))[1] === 'sqrt(16)', `Ctrl+Enter: ${(await texts(page))[1]}`);
});

await check('A heading line draws no grey slots, and a call on an ordinary line does', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['binompdf(', '# binompdf(']));
  const slotsOf = async (text) => {
    await (await blockOf(page, text)).click();
    await page.keyboard.press('End');
    await page.waitForTimeout(100);
    // The line clicked is the one in the composer now.
    return page.evaluate(() => document.querySelector('.composer .row .slots:not([hidden])')?.textContent ?? null);
  };
  const line = await slotsOf('binompdf(');
  expect(line === 'binompdf(n, p, k', `the ordinary line: ${line}`);
  const heading = await slotsOf('# binompdf(');
  expect(heading === null, `the heading: ${heading}`);
});

await check('The line menu\'s Copy result copies what Ctrl+Alt+C copies: a shaded curve\'s probability, nothing from an unshaded one', async (page) => {
  await fileItem(page, 'Start with an example');
  await page.locator('.examples-dialog .starter-card', { hasText: 'Shaded normal curve' }).click();
  await page.waitForTimeout(400);
  const k = await page.evaluate(() => [...document.querySelectorAll('.rows .row')].findIndex((r) => r.querySelector('.dist-prob:not([hidden])')));
  expect(k >= 0, 'no shaded curve');
  const copyItem = async () => {
    await page.locator('.rows .row').nth(k).click({ button: 'right', position: { x: 40, y: 14 } });
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


await check('R5 phone: Modes, Find and File are word pills, as on the phone apps', async (page) => {
  const g = await page.evaluate(() => {
    const box = (q) => { const e = document.querySelector(q), r = e.getBoundingClientRect(); return { text: e.innerText.trim(), h: Math.round(r.height), l: r.left, r: r.right, bg: getComputedStyle(e).backgroundColor }; };
    return { modes: box('.modebar .pill.more'), find: box('.head-find'), file: box('.head-pill .menu-btn'), deg: !!document.querySelector('.modebar .desk-modes .seg')?.offsetParent };
  });
  expect(g.modes.text === 'Modes' && g.find.text.startsWith('Find') && g.file.text === 'File' && g.deg, `the bar's words: ${JSON.stringify(g)}`);
  expect(g.find.h === g.file.h && g.modes.h === g.file.h && g.file.l - g.find.r >= 6 && g.find.l - g.modes.r >= 6, `pills apart and alike: ${JSON.stringify(g)}`);
  expect([g.modes, g.find, g.file].every((x) => x.bg !== 'rgba(0, 0, 0, 0)'), `pills with no ground: ${JSON.stringify(g)}`);
}, true);

for (const [where, phone] of [['desktop', false], ['phone', true]]) for (const look of ['modern']) {
  await check(`R5 ${where} ${look}: every key row's labels on one line, ⌫ with the digits on the desktop, two-line faces clear of the cap's top`, async (page) => {
    await setLook(page, look);
    await page.waitForTimeout(400);
    const g = await page.evaluate(() => {
      const rows = new Map();
      const tops = [];
      for (const k of document.querySelectorAll('.key')) {
        const kr = k.getBoundingClientRect();
        // A Thumb Index tab carries its glyph over its word, by design, as on iOS.
        // The composer's AC sits on its own edge, not in a key row.
        if (!k.offsetParent || k.classList.contains('ti-tab') || k.closest('.composer-head') || kr.right < 0 || kr.left > innerWidth || kr.width < 5 || kr.height > 80) continue;
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
    // Any caption a key shows is in the regular weight (⌫ and AC show none now).
    expect(g.weights.every((w) => w === '400'), `captions in the regular weight: ${g.weights}`);
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
  expect(t[1] === 'ans*100' && t.length === 2, `Enter takes the offer: ${JSON.stringify(t)}`);
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
  expect(unfinished === 'Line 1: Unfinished', `an unfinished line isn't an error: ${unfinished}`);
});

await check('UX4 4: Mac labels, a fresh ⌘/ then Enter does nothing, AC says ⌘Z, percent skips oapercent', async (page) => {
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  await page.evaluate(() => window.slopculator.setLines(['12*3', '']));
  await toNewLine(page);
  await page.keyboard.type('7');
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('.menu-btn').click());
  await page.waitForTimeout(200);
  const undoHint = await page.evaluate(() => [...document.querySelectorAll('.menu button')].find((b) => b.textContent.startsWith('Undo'))?.textContent ?? '');
  await page.keyboard.press('Escape');
  await toNewLine(page);
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
  const ac = await page.evaluate(() => document.querySelector('.composer-ac')?.getAttribute('aria-label') ?? '');
  expect(/Clear all/.test(ac) && !/brings them back|appears after/.test(ac), `AC: ${ac}`);
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
  await page.evaluate(() => document.querySelector('.composer .key[data-action=enter]').click());
  await page.waitForTimeout(200);
  const t = (await lines(page)).map((l) => l.text);
  expect(t[1] === 'ans*100' && t.length === 2, `keypad enter: ${JSON.stringify(t)}`);
});

await check('Final bugs (phone): a long-press line menu stays open on lift; ⌫ on an empty line takes it away', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['12*3', '7+5', '']));
  await page.waitForTimeout(300);
  // A long press on a block, as a finger held on it.
  const box = await page.locator('.rows .row').first().boundingBox();
  await page.evaluate(({ x, y }) => { const g = document.elementFromPoint(x, y); g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', button: 0, clientX: x, clientY: y })); }, { x: box.x + 8, y: box.y + box.height / 2 });
  await page.waitForTimeout(500);
  await page.evaluate(({ x, y }) => { const g = document.elementFromPoint(x, y); g.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })); g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y })); }, { x: box.x + 8, y: box.y + box.height / 2 });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => !!document.querySelector('.line-menu, .menu.line, [role=menu].line-menu') || [...document.querySelectorAll('[role=menu]')].some((m) => m.offsetParent && /Duplicate/.test(m.textContent))), 'the line menu closed on lift');
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('.graph-pane, .keys, body').dispatchEvent(new Event('touchstart', { bubbles: true })));
  await page.waitForTimeout(300);
  await toNewLine(page);
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
for (const [w, h] of [[1280, 800]]) for (const look of ['modern']) {
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
  expect(g.text.startsWith('Find') && Math.abs(g.f.height - g.m.height) < 0.6 && Math.abs(g.f.top - g.m.top) < 0.6 && g.m.left - g.f.right >= 0 && g.m.left - g.f.right <= 8, `Find on the bar: ${JSON.stringify(g)}`);
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

await check('D2 desktop: a new curve that doesn\'t show is fitted; a slider moving it later isn\'t', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['normaldist(0, 1)', '']));
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => window.slopculator.graph.view());
  expect(before.ymax < 1, `the bell curve's view: ${JSON.stringify(before)}`);
  await toNewLine(page);
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

await check('D2 desktop: det of a 2 × 2 via Build matrix… chip and inline Matrix Builder gives −2', async (page) => {
  await page.locator('.rows .expr').first().click();
  await page.keyboard.press('Control+Alt+4');
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  expect((await lineNow(page)).text === 'det()', `det: ${JSON.stringify(await lineNow(page))}`);
  await page.locator('.row.active .hint-line .grid-chip', { hasText: 'Build matrix' }).click();
  await page.waitForSelector('dialog.mx.mx-matrix[open]');
  await page.locator('dialog.mx [data-r="0"][data-c="0"]').fill('1');
  await page.locator('dialog.mx [data-r="0"][data-c="1"]').fill('2');
  await page.locator('dialog.mx [data-r="1"][data-c="0"]').fill('3');
  await page.locator('dialog.mx [data-r="1"][data-c="1"]').fill('4');
  await page.locator('dialog.mx button.primary').click();
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
    if (narrow) await page.locator('.mobile-actions .mob-act.primary').click();
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
    if (narrow) await page.locator('.mobile-actions .mob-act.primary').click();
    await placeCaret(page, 10);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(120);
    const l = await lineAndCaret(page);
    expect(l.text === '[[1, 2], [ , 4]]' && l.caret === 6, `Backspace in an empty cell: ${JSON.stringify(l)}`);
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
  expect((await names()).includes('Matrix builder…'), `Matrix page: ${await names()}`);
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
  await page.locator('.ti-tile:has(.ti-face:text-is("Matrix builder…"))').tap();
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
  for (const look of ['modern']) {
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

await check('a link adds its lines as one undoable step, within its limits, and never redefines a name', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['rate = 0.05', 'sqrt(16)']));
  const q = ['sqrt(t) = t*100', 'rate = 1', 'k = 2', '1+1', '9'.repeat(1001)].map((l) => `q=${encodeURIComponent(l)}`).join('&');
  await page.goto('about:blank');
  await page.goto(`${appUrl}#${q}`);
  await page.waitForFunction(() => !!window.slopculator);
  const texts = async () => (await lines(page)).map((l) => l.text);
  expect(JSON.stringify(await texts()) === JSON.stringify(['rate = 0.05', 'sqrt(16)', 'k = 2', '1+1']), `after the link: ${JSON.stringify(await texts())}`);
  expect((await lines(page))[1].result === '4', 'the link redefined sqrt');
  expect((await lines(page))[0].result === '0.05' && !(await lines(page))[0].error, 'the link broke rate');
  expect(!(await page.evaluate(() => location.hash)), 'the link stayed in the address');
  const toast = await page.textContent('.toast');
  expect(toast.includes("Added 2 lines from the link and left out 3. A link can't redefine sqrt or rate"), toast);
  await page.click('.toast button');
  expect(JSON.stringify(await texts()) === JSON.stringify(['rate = 0.05', 'sqrt(16)']), `after Undo: ${JSON.stringify(await texts())}`);
});

await check('a ?q= query adds nothing, since a query reaches the host\'s logs', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['1+1']));
  await page.goto('about:blank');
  await page.goto(`${appUrl}?q=${encodeURIComponent('2*21')}`);
  await page.waitForFunction(() => !!window.slopculator);
  const texts = (await lines(page)).map((l) => l.text);
  expect(JSON.stringify(texts) === JSON.stringify(['1+1']), `after the query: ${JSON.stringify(texts)}`);
});

await check('File > Privacy shows the policy, with its links opening in a new tab', async (page) => {
  await page.click('.menu-btn');
  await page.getByRole('menuitem', { name: 'Privacy' }).click();
  const dialog = page.locator('dialog.privacy');
  await dialog.waitFor();
  expect(await dialog.evaluate((d) => d.open), 'the dialog is not open');
  expect((await dialog.locator('h1').textContent()) === 'Privacy', 'no Privacy title');
  const links = await dialog.locator('a').evaluateAll((as) => as.map((a) => [a.href, a.target, a.rel]));
  expect(links.length === 3 && links.every(([href, target, rel]) => href.startsWith('https://') && target === '_blank' && rel === 'noopener noreferrer'), JSON.stringify(links));
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
});

await check('an imported line id with a quote in it still draws the graph', async (page) => {
  await page.click('.menu-btn');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.menu button', { hasText: 'Import' }).click()]);
  const rows = [{ id: 'q"x', kind: 'expr', text: 'a = 2' }, { id: 'r2', kind: 'expr', text: 'y = a x' }];
  await chooser.setFiles({ name: 'quote.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ rows })) });
  await page.waitForFunction(() => window.slopculator.lines().length === 2);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const names = await page.evaluate(() => window.slopculator.graph.names().map((n) => n.text));
  expect(names.length === 1, `curves on the graph: ${JSON.stringify(names)}`);
  expect(await page.evaluate(() => window.slopculator.addLine('1+1').result) === '2', 'adding a line failed');
});

await check('importing JSON that is not a sheet leaves the sheet as it was', async (page) => {
  await typeLine(page, 'a = 2');
  await page.click('.menu-btn');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.menu button', { hasText: 'Import' }).click()]);
  await chooser.setFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await page.waitForFunction(() => /isn't a Slopculator sheet/.test(document.body.innerText));
  const l = (await lines(page)).filter((x) => x.text);
  expect(JSON.stringify(l.map((x) => x.text)) === '["a = 2"]', `the sheet changed: ${JSON.stringify(l)}`);
});

await check('a matrix too big to show draws its top-left corner and says so', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['A = identity(20)', 'B = augment(augment(A, A), A)', 'transpose(B) * B']));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const shown = await page.evaluate(() => [...document.querySelectorAll('.result')].map((r) => ({ cells: r.querySelectorAll('table.mat td').length, more: r.querySelector('.mat-more')?.textContent ?? null })));
  expect(shown[0].cells === 400 && shown[0].more === null, `identity(20): ${JSON.stringify(shown[0])}`);
  expect(shown[1].cells === 21 * 20 && shown[1].more === '20 × 60 matrix, showing the top-left 20 × 20', `20 × 60: ${JSON.stringify(shown[1])}`);
  expect(shown[2].cells === 21 * 21 && shown[2].more === '60 × 60 matrix, showing the top-left 20 × 20', `60 × 60: ${JSON.stringify(shown[2])}`);
  expect((await lines(page))[2].result.split('],').length === 60, 'the answer itself lost rows');
});

await check('names like constructor typeset as themselves', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['constructor = 5', 'a_constructor = 2', 'constructor + a_constructor']));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const tex = await page.evaluate(() => [...document.querySelectorAll('.tex')].map((t) => t.textContent));
  expect(!tex.some((t) => /native code/.test(t)), `typeset: ${JSON.stringify(tex)}`);
  expect((await lines(page))[2].result === '7', 'the lines did not evaluate');
});

await check('node editor: spawn, wire, edit, block a cycle, disconnect and undo', async (page) => {
  const menu = page.locator('.ng-menu');
  const search = menu.getByRole('combobox', { name: 'Search math nodes' });
  const spawn = async (template) => {
    await search.fill(template);
    await search.press('Enter');
    await menu.waitFor({ state: 'detached' });
  };
  const add = async (template) => {
    await page.getByRole('button', { name: '+ Node', exact: true }).click({ timeout: 3000 });
    await spawn(template);
  };
  const out = page.locator('.ng-sock-out');
  const operation = (title) => page.locator('.blk-node', { has: page.locator('.ng-head', { hasText: title }) });
  const pin = (node, n) => node.locator(`.ng-sock-in[data-pin="${n}"]`);
  const center = async (locator) => {
    const { x, y, width, height } = await locator.boundingBox();
    return { x: x + width / 2, y: y + height / 2 };
  };
  const drag = async (source, end, during = async () => {}) => {
    const from = await center(source);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await during();
    await page.mouse.up();
  };
  const answers = async (expected) => {
    const got = (await lines(page)).filter((line) => line.text).map(({ result, error }) => error || result);
    expect(JSON.stringify(got.slice(2)) === JSON.stringify(expected), `answers: ${JSON.stringify(got)}`);
  };

  await add('Number');
  await add('Number');
  await add('Add');
  const sum = operation('Add');
  const a = await center(pin(sum, 0));
  await drag(out.nth(0), { x: a.x - 18, y: a.y }, async () => {
    expect(await pin(sum, 0).evaluate((el) => el.classList.contains('ng-snap')), 'the wire did not snap to Add A');
  });
  await drag(out.nth(1), await center(pin(sum, 1)));
  await answers(['10']);

  await drag(sum.locator('.ng-sock-out'), { x: 930, y: 520 });
  expect(await page.locator('.ng-drag-layer path').isVisible(), 'the wire preview disappeared behind the spawn menu');
  expect(await menu.getByRole('option', { name: /Number/ }).count() === 0, 'the contextual menu offered a node without inputs');
  await spawn('Multiply');
  const product = operation('Multiply');
  await product.evaluate((el) => Promise.allSettled(el.getAnimations().map((animation) => animation.finished)));
  const placed = await product.boundingBox();
  expect(Math.hypot(placed.x - 930, placed.y - 520) < 1, `Multiply was placed at ${placed.x}, ${placed.y}`);
  const b = product.getByRole('textbox', { name: 'Value for B' });
  await b.fill('4');
  await page.evaluate(() => {
    window.nodeField = document.activeElement;
    window.slopculator.setSettings({ deg: false });
  });
  // Wait two animation frames after recompute to verify the focused input survives render without replacing the node.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await b.evaluate((el) => el === window.nodeField && el === document.activeElement && el.value === '4'), 'recomputing replaced or reset the focused input');
  await b.press('Enter');
  await answers(['10', '40']);

  const beforeCycle = await lines(page);
  await drag(product.locator('.ng-sock-out'), await center(pin(sum, 0)), async () => {
    expect(await page.locator('.ng-drag-layer.invalid path').isVisible(), 'the cycle preview did not turn invalid');
    expect(await page.locator('.ng-drag-note').textContent() === 'That would make a loop', 'the cycle preview gave no reason');
  });
  expect((await page.locator('.toast').textContent()).includes('That would make a loop'), 'dropping a cycle gave no feedback');
  expect(JSON.stringify(await lines(page)) === JSON.stringify(beforeCycle), 'dropping a cycle changed the sheet');
  await pin(sum, 1).click({ modifiers: ['Alt'] });
  await answers(['5', '20']);
  await page.keyboard.press('ControlOrMeta+z');
  await answers(['10', '40']);
});

await check('node editor: duplicate pins route separately, rewires are undoable, and Escape cancels', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['a = 5', 'b = 7', 'n1 = a + a']));
  const sum = page.locator('.blk-node');
  const firstPin = sum.locator('.ng-sock-in[data-pin="0"]');
  const otherOut = page.locator('.ng-sock-out').nth(1);
  const endpoints = await sum.evaluate((block) => {
    const distance = (point, socket) => {
      const r = socket.getBoundingClientRect();
      return Math.hypot(point.x - r.left - r.width / 2, point.y - r.top - r.height / 2);
    };
    const out = document.querySelector('.ng-sock-out');
    return [...block.querySelectorAll('.ng-sock-in')].map((socket) => {
      const key = `${out.dataset.row}>${socket.dataset.row}@${socket.dataset.pin}`;
      const path = [...document.querySelectorAll('.cv-wires path.w')].find((el) => el.dataset.key === key);
      if (!path) return null;
      const matrix = path.getScreenCTM();
      return [distance(path.getPointAtLength(0).matrixTransform(matrix), out),
        distance(path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix), socket)];
    });
  });
  expect(endpoints.length === 2 && endpoints.every((pair) => pair?.every((d) => d < 1)), `socket offsets: ${JSON.stringify(endpoints)}`);

  const startDrag = async (locator) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
  };
  const moveTo = async (locator) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
  };
  const answer = async (value) => expect((await lines(page))[2].result === value, `wanted ${value}: ${JSON.stringify(await lines(page))}`);
  const menu = page.locator('.ng-menu');
  const preview = page.locator('.ng-drag-layer path');
  await startDrag(firstPin);
  await moveTo(otherOut);
  await page.keyboard.press('Escape');
  await preview.waitFor({ state: 'detached' });
  await page.mouse.up();
  await answer('10');

  await startDrag(firstPin);
  await moveTo(otherOut);
  await page.mouse.up();
  await answer('12');
  await startDrag(firstPin);
  await page.mouse.move(1000, 720, { steps: 10 });
  await page.mouse.up();
  await answer('5');
  await page.keyboard.press('ControlOrMeta+z');
  await answer('12');

  await startDrag(otherOut);
  await page.mouse.move(1000, 720, { steps: 10 });
  await preview.waitFor();
  await page.mouse.up();
  await menu.waitFor();
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  await preview.waitFor({ state: 'detached' });
  await answer('12');

  await page.mouse.click(1000, 720, { button: 'right' });
  await menu.waitFor();
  const search = menu.getByRole('combobox');
  expect(await search.evaluate((el) => el === document.activeElement), 'the spawn search did not take focus');
  await search.press('ArrowDown');
  await search.press('Enter');
  await menu.waitFor({ state: 'detached' });
  expect((await lines(page)).some((line) => line.text.includes('{1, 2, 3, 4}')), 'arrow navigation did not pick Data List');

  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.palette input').fill('Add math node');
  await page.locator('.palette :text-is("Add math node…")').click();
  await menu.waitFor();
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
});

await check('node editor: portrait phone toggles Nodes on, spawns a node, and switches back to List', async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.cv-nodes-pill').waitFor({ state: 'visible' });
  await page.locator('.cv-nodes-pill').click();
  await page.locator('.tape.cv-wide').waitFor();
  await page.getByRole('button', { name: '+ Node' }).click();
  const menu = page.locator('.ng-menu');
  await menu.waitFor();
  await menu.getByRole('combobox').fill('Add');
  await menu.getByRole('option', { name: 'Add' }).click();
  await menu.waitFor({ state: 'detached' });
  await page.locator('.row.blk-node').first().waitFor();
  expect((await lines(page)).some((line) => line.text.includes('n1 = 0 + 0')), `expected spawned Add node: ${JSON.stringify(await lines(page))}`);
  await page.getByRole('button', { name: '← List' }).click();
  await page.locator('.tape.cv-narrow').waitFor();
  await page.locator('.cv-nodes-pill').waitFor({ state: 'visible' });
});

await check('slider keeps its min/max locked while focused during a drag and refits on release', async (page) => {
  await page.evaluate(() => window.slopculator.setLines(['a = 1', 'y = a x']));
  await page.waitForFunction(() => !!document.querySelector('.slider-row input[type=range]'));
  const before = await page.evaluate(() => {
    const inp = document.querySelector('.slider-row input[type=range]');
    inp.focus();
    const bounds = { min: inp.min, max: inp.max, step: inp.step, focused: document.activeElement === inp };
    inp.value = '8';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return bounds;
  });
  expect(before.focused, 'slider did not receive focus');
  await page.waitForFunction(() => window.slopculator.lines()[0]?.value === 8);
  const during = await page.evaluate(() => {
    const inp = document.querySelector('.slider-row input[type=range]');
    return { min: inp.min, max: inp.max, step: inp.step };
  });
  expect(JSON.stringify(during) === JSON.stringify({ min: before.min, max: before.max, step: before.step }), `bounds shifted mid-drag: ${JSON.stringify(before)} -> ${JSON.stringify(during)}`);
  await page.evaluate(() => {
    const inp = document.querySelector('.slider-row input[type=range]');
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.blur();
    window.slopculator.setSettings({});
  });
  await page.waitForFunction(() => document.querySelector('.slider-row input[type=range]')?.max === '20');
});

if (!process.env.E2E_MATCH && !shard) console.log(results.join('\n'));
console.log(`${results.filter((r) => r.startsWith('PASS')).length} passed, ${results.filter((r) => r.startsWith('FAIL')).length} failed`);
console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
process.exitCode = results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0;
