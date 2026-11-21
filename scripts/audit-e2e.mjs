import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { exposeKeys, launchBrowser, openApp } from './lib/app.mjs';

const browser = await launchBrowser();
let failures = 0;
const undo = (p) => p.keyboard.press('ControlOrMeta+z');
const redo = (p) => p.keyboard.press('ControlOrMeta+Shift+z');
const texts = (p) => p.evaluate(() => window.slopculator.lines().map((r) => r.text));
const seed = (p, lines) => p.evaluate((lines) => window.slopculator.setLines(lines), lines);
/** The composer's line: the sheet's new last line, or the block being edited. */
const expr = (p) => p.locator('.composer .expr');
/** Takes down the Undo toast that seeding leaves over the list toolbar for 10 s, so a click there isn't held until it fades. */
const dropToast = (p) => p.evaluate(() => { const t = document.querySelector('.toast'); t.classList.remove('show'); t.inert = true; });
async function save(p, name) {
  await p.keyboard.press('Control+Alt+s');
  // The open dialog: the last one closed is removed on its close event, a task later, and may still be in the page.
  await p.locator('dialog[open] input').fill(name);
  await p.locator('dialog[open] button[value=ok]').click();
  await expr(p).focus();
}
async function check(name, fn, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  await exposeKeys(context);
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => d.accept());
  try {
    await openApp(p);
    await fn(p);
    assert.deepEqual(errors, []);
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}: ${e.message}`);
  } finally {
    await context.close();
  }
}

for (const operation of ['clear', 'delete']) {
  await check(`${operation} replacement line survives undo and redo of later typing`, async (p) => {
    await seed(p, ['5']);
    if (operation === 'clear') await p.evaluate(() => window.slopculator.clear());
    else await p.locator('.tape .rows .row .del').click();
    await expr(p).fill('42');
    await undo(p); await undo(p);
    assert.deepEqual(await texts(p), ['5']);
    await redo(p); await redo(p);
    assert.deepEqual(await texts(p), ['42']);
    if (operation === 'clear') {
      mkdirSync('.shots', { recursive: true });
      await p.screenshot({ path: '.shots/audit-undo-redo.png' });
    }
  });
}

await check('setLines undo replaces the new lines and redo restores them', async (p) => {
  await seed(p, ['1', '2']);
  await seed(p, ['3', '4']);
  await undo(p);
  assert.deepEqual(await texts(p), ['1', '2']);
  await redo(p);
  assert.deepEqual(await texts(p), ['3', '4']);
});

await check('multi-line paste is one undoable step and keeps row IDs on redo', async (p) => {
  await seed(p, ['1']);
  await p.evaluate(() => {
    const input = document.querySelector('.rows .row .expr');
    input.focus(); input.setSelectionRange(0, 1);
    const data = new DataTransfer(); data.setData('text/plain', '5\n6');
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  assert.deepEqual(await texts(p), ['5', '6']);
  await expr(p).fill('67');
  await undo(p); await undo(p);
  assert.deepEqual(await texts(p), ['1']);
  await redo(p); await redo(p);
  assert.deepEqual(await texts(p), ['5', '67']);
});

for (const trailing of [[], ['']]) {
  await check(`Combine has its own undo with ${trailing.length ? 'an empty' : 'a new'} result line`, async (p) => {
    await seed(p, ['1', '2', ...trailing]);
    await dropToast(p);
    await p.click('.head-find');
    await p.locator('dialog.palette .pal-input').fill('Add all lines');
    await p.locator('dialog.palette .pal-item', { hasText: 'Add all lines' }).first().click();
    assert.deepEqual(await texts(p), ['1', '2', '1 + 2']);
    await undo(p);
    // The composer's empty new line isn't one of the sheet's lines.
    assert.deepEqual(await texts(p), ['1', '2']);
    await redo(p);
    assert.deepEqual(await texts(p), ['1', '2', '1 + 2']);
    await p.evaluate(() => {
      const input = document.querySelector('.rows .row .expr');
      input.value = '10'; input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await undo(p); await undo(p);
    assert.deepEqual(await texts(p), ['1', '2']);
  });
}

await check('Combine toast undo preserves newer source edits', async (p) => {
  await seed(p, ['1', '2']);
  await dropToast(p);
  await p.click('.head-find');
  await p.locator('dialog.palette .pal-input').fill('Add all lines');
  await p.locator('dialog.palette .pal-item', { hasText: 'Add all lines' }).first().click();
  await p.evaluate(() => {
    const input = document.querySelector('.rows .row .expr');
    input.value = '10'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.toast button').click();
  });
  assert.deepEqual(await texts(p), ['10', '2']);
});

for (const damaged of ['{broken', JSON.stringify({ rows: [null] })]) {
  await check('damaged working document cannot overwrite a valid named save: ' + damaged, async (p) => {
    await p.addInitScript((damaged) => {
      localStorage.setItem(slopKeys.document, damaged);
      localStorage.setItem(slopKeys.current, 'Homework');
      localStorage.setItem(slopKeys.sessions, JSON.stringify([{ name: 'Homework', doc: { rows: [{ id: 'old', kind: 'expr', text: '99', color: 0 }] } }]));
    }, damaged);
    await p.reload();
    await p.waitForFunction(() => !!window.slopculator);
    assert.equal(await p.locator('.sheet-title').textContent(), 'Untitled sheet');
    await expr(p).fill('42');
    await p.waitForFunction(() => {
      try { return JSON.parse(localStorage.getItem(slopKeys.document)).rows?.[0]?.text === '42'; }
      catch { return false; }
    });
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem(slopKeys.sessions))[0].doc.rows[0].text);
    assert.equal(saved, '99');
  });
}

await check('repairing duplicate imported IDs cannot collide with another imported row', async (p) => {
  await p.addInitScript(() => {
    Date.now = () => 1000;
    const pending = sessionStorage.getItem('import');
    if (pending) localStorage.setItem(slopKeys.document, pending);
  });
  const load = async (rows) => {
    await p.evaluate((rows) => sessionStorage.setItem('import', JSON.stringify({ rows })), rows);
    await p.reload();
    await p.waitForFunction(() => !!window.slopculator);
  };
  // The id the app gives a repaired row, read back from what it saves, so the next import already holds that id.
  await load([{ id: 'same', text: '2' }, { id: 'same', text: '3' }]);
  await expr(p).fill('9');
  const generated = await p.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    return JSON.parse(localStorage.getItem(slopKeys.document)).rows[1].id;
  });
  assert.notEqual(generated, 'same');
  await load([{ id: generated, text: '1' }, { id: 'same', text: '2' }, { id: 'same', text: '3' }]);
  assert.deepEqual(await texts(p), ['1', '2', '3']);
  assert.equal(await p.locator('.tape .rows .row.blk:not(.blk-blank)').count(), 3);
  await expr(p).fill('4');
  assert.deepEqual(await texts(p), ['1', '2', '3', '4']);
});

await check('editing after undo discards the redo branch', async (p) => {
  await seed(p, ['']);
  await expr(p).fill('1');
  await p.keyboard.press('Enter');
  await expr(p).fill('2');
  await undo(p);
  // Make this a single edit task; the assertion is about redo branching, not native focus selection timing.
  await p.evaluate(() => {
    const input = document.querySelector('.rows .row .expr');
    input.focus(); input.value = '13'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await redo(p);
  assert.deepEqual(await texts(p), ['13']);
});

await check('failed named save reports failure and prevents New from discarding it', async (p) => {
  await seed(p, ['5']); await save(p, 'Homework');
  await p.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === slopKeys.sessions) throw new Error('quota');
      return write.call(this, k, v);
    };
  });
  await p.keyboard.press('Control+Alt+s');
  assert.match(await p.locator('.toast').textContent(), /couldn't be updated/);
  await p.keyboard.press('Control+Alt+Shift+n');
  assert.deepEqual(await texts(p), ['5']);
  assert.equal(await p.locator('.sheet-title').textContent(), 'Homework');
  await expr(p).fill('6');
  await p.waitForFunction(() => /isn't being saved/.test(document.querySelector('.toast')?.textContent ?? ''));
});

await check('New reports a failure on its second save without throwing or recording a switch', async (p) => {
  await seed(p, ['1']); await save(p, 'First');
  await p.evaluate(() => {
    const write = Storage.prototype.setItem;
    let writes = 0;
    Storage.prototype.setItem = function (k, v) {
      if (k === slopKeys.sessions && ++writes === 2) throw new Error('quota');
      return write.call(this, k, v);
    };
  });
  await p.keyboard.press('Control+Alt+Shift+n');
  assert.equal(await p.locator('.sheet-title').textContent(), 'First');
  assert.deepEqual(await texts(p), ['1']);
  assert.match(await p.locator('.toast').textContent(), /couldn't be updated/);
  await undo(p);
  assert.deepEqual(await texts(p), ['']);
});

await check('failed saved-sheet deletion keeps the current name attached', async (p) => {
  await seed(p, ['5']); await save(p, 'Homework');
  await p.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === slopKeys.sessions) throw new Error('quota');
      return write.call(this, k, v);
    };
  });
  await p.keyboard.press('Control+Alt+o');
  await p.locator('.sheet-del').click();
  assert.equal(await p.locator('.sheet-title').textContent(), 'Homework');
  assert.equal(await p.locator('.sheet-name').count(), 1);
  assert.match(await p.locator('.toast').textContent(), /couldn't be updated/);
});

await check('failed sheet-switch undo and redo keep the document and can be retried', async (p) => {
  await seed(p, ['1']); await save(p, 'First');
  await p.keyboard.press('Control+Alt+Shift+n');
  await save(p, 'Second');
  await p.evaluate(() => {
    const write = Storage.prototype.setItem;
    window.auditFailSave = true;
    Storage.prototype.setItem = function (k, v) {
      if (k === slopKeys.sessions && window.auditFailSave) throw new Error('quota');
      return write.call(this, k, v);
    };
  });
  await undo(p);
  assert.equal(await p.locator('.sheet-title').textContent(), 'Second');
  assert.match(await p.locator('.toast').textContent(), /couldn't be updated/);
  await p.evaluate(() => { window.auditFailSave = false; });
  await undo(p);
  assert.equal(await p.locator('.sheet-title').textContent(), 'First');
  await p.evaluate(() => { window.auditFailSave = true; });
  await redo(p);
  assert.equal(await p.locator('.sheet-title').textContent(), 'First');
  await p.evaluate(() => { window.auditFailSave = false; });
  await redo(p);
  assert.equal(await p.locator('.sheet-title').textContent(), 'Second');
});

await check('undoing Open saves edits to the outgoing named sheet before its timer', async (p) => {
  await seed(p, ['1']); await save(p, 'First');
  await p.keyboard.press('Control+Alt+Shift+n');
  await expr(p).fill('2'); await save(p, 'Second');
  await p.keyboard.press('Control+Alt+o');
  await p.locator('.sheet-open', { hasText: 'First' }).click();
  // The toast can undo Open past newer typing. Put the edit and click in one browser task, before autosave.
  await p.evaluate(() => {
    const input = document.querySelector('.rows .row .expr');
    input.value = '12345'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.toast button').click();
  });
  assert.deepEqual(await texts(p), ['2']);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem(slopKeys.sessions)).find((s) => s.name === 'First').doc.rows[0].text);
  assert.equal(saved, '12345');
});

await check('desktop combined probabilities keep their answer whole in their block, in both looks', async (p) => {
  await seed(p, ['normalcdf(-1,1)+normalcdf(-2,2)']);
  for (const look of ['modern', 'retro']) {
    await p.selectOption('select.look', look, { force: true });
    await p.waitForTimeout(150);
    const fit = await p.evaluate(() => {
      const block = document.querySelector('.tape .rows .row.blk:not(.blk-blank)');
      const r = (e) => e.getBoundingClientRect();
      const b = r(block), out = r(block.querySelector('.out')), res = block.querySelector('.out .result');
      return { inside: out.left >= b.left - 0.5 && out.right <= b.right + 0.5, whole: !!res && res.scrollWidth <= res.clientWidth + 1 };
    });
    assert.ok(fit.inside && fit.whole, `${look}: the combined probability is cut or runs out of its block: ${JSON.stringify(fit)}`);
  }
});

for (const look of ['modern', 'retro']) {
  await check(`desktop ${look} wraps long list inputs without clipping or splitting numbers`, async (p) => {
    await p.selectOption('select.look', look, { force: true });
    await seed(p, ['mean([12,18,24,30,36,42,48,54,60,66,72,78])', 'mean([12,18,24])', '']);
    await p.evaluate(() => document.fonts.ready);
    for (const width of [1280, 1366, 1440, 1920]) {
      await p.setViewportSize({ width, height: 800 });
      const rows = await p.locator('.row.typeset').evaluateAll((rows) => rows.map((row) => {
        const tex = row.querySelector('.tex'), src = row.querySelector('.src').getBoundingClientRect();
        const runs = [...tex.querySelectorAll('.m-run')].map((e) => {
          const range = document.createRange(); range.selectNodeContents(e);
          return [...range.getClientRects()].map((r) => ({ left: r.left, right: r.right, top: r.top }));
        });
        return { width: src.width, natural: parseFloat(row.querySelector('.src').style.getPropertyValue('--nat')), fits: runs.flat().every((r) => r.left >= src.left - 1 && r.right <= src.right + 1), lines: new Set(runs.flat().map((r) => r.top)).size, split: runs.some((r) => r.length !== 1), answer: row.querySelector('.val').textContent };
      }));
      assert.ok(rows[0].fits, `${look} ${width}: list inputs extend beyond the source column`);
      assert.ok(!rows[0].split, `${look} ${width}: a number or name split across lines`);
      assert.equal(rows[0].answer, '45');
      if (rows[0].natural > rows[0].width + 1) assert.ok(rows[0].lines > 1, 'overlong list did not wrap');
      else assert.equal(rows[0].lines, 1, 'list that fits wrapped unnecessarily');
      assert.ok(rows[1].fits && !rows[1].split && rows[1].lines === 1, 'short list no longer fits on one line');
    }
  });
}

for (const look of ['modern', 'retro']) {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await check(`${look} released keys return to their row with motion ${reducedMotion}`, async (p) => {
      await p.selectOption('select.look', look, { force: true });
      await seed(p, ['']);
      const keys = [p.locator('.key[aria-label="Math"]'), p.locator('.numpad .key[aria-label="7"]')];
      const before = await Promise.all(keys.map((key) => key.boundingBox()));
      await keys[0].click();
      await p.locator('button[aria-label="Close Math"]').click();
      await keys[1].click();
      await p.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
      for (const [i, key] of keys.entries()) {
        const after = await key.boundingBox();
        assert.ok(Math.abs(after.y - before[i].y) < 0.1, `${look}: released key ${i} stayed ${after.y - before[i].y}px below its row`);
      }
      assert.deepEqual(await texts(p), ['7']);
    }, { reducedMotion });
  }
}

// aria-expanded is script, the same in both looks.
for (const look of ['modern']) {
  await check(`${look} Modes button clears its open state when its menu closes`, async (p) => {
    await p.selectOption('select.look', look, { force: true });
    const trigger = p.locator('.desk-more'), menu = p.locator('.mode-menu');
    await trigger.click();
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    assert.ok(await menu.isVisible());
    await p.keyboard.press('Escape');
    assert.ok(await menu.isHidden());
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false', `${look}: closed Modes still reports expanded`);
    await trigger.click();
    await p.locator('.appear-btn').click();
    assert.ok(await menu.isHidden());
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false', `${look}: switching to Appearance leaves Modes expanded`);
  });
}

for (const look of ['modern', 'retro']) {
  await check(`${look} Appearance preview keeps every key legend complete`, async (p) => {
    await p.selectOption('select.look', look, { force: true });
    await p.locator('.appear-btn').click();
    await p.evaluate(() => document.fonts.ready);
    const legends = await p.locator('.appear-sample .key .kl').evaluateAll((labels) => labels.map((e) => {
      const range = document.createRange(); range.selectNodeContents(e);
      return { text: e.textContent, width: range.getBoundingClientRect().width, room: e.clientWidth };
    }));
    assert.deepEqual(legends.map((l) => l.text), ['7', '8', '9', '×', 'ENTER']);
    for (const label of legends) assert.ok(label.width <= label.room + 1, `${look}: ${label.text} needs ${label.width}px but has ${label.room}px`);
  });
}

for (const look of ['modern', 'retro']) {
  await check(`${look} narrow desktop keeps the graph block's controls inside it and the bar inside the window`, async (p) => {
    await p.selectOption('select.look', look, { force: true });
    await seed(p, ['y = x^2']);
    await p.evaluate(() => document.fonts.ready);
    for (const theme of ['paper', 'contrastLight']) {
      await p.emulateMedia({ colorScheme: 'light' });
      await p.evaluate((theme) => window.slopculator.setSettings({ theme: theme === 'contrastLight' ? 'contrast' : theme }), theme);
      for (const width of [761, 780, 800, 900]) {
        await p.setViewportSize({ width, height: 768 });
        await p.waitForTimeout(100);
        const g = await p.evaluate(() => {
          const pane = document.querySelector('.tape .graph-pane'), r = pane.getBoundingClientRect();
          const buttons = [...pane.querySelectorAll('.graph-tools button')].map((e) => e.getBoundingClientRect());
          const bar = document.querySelector('.modebar');
          return { count: buttons.length, fits: buttons.every((b) => b.left >= r.left - 1 && b.right <= r.right + 1 && b.bottom <= r.bottom + 1), bar: bar.scrollWidth <= bar.clientWidth + 1, page: document.documentElement.scrollWidth <= innerWidth };
        });
        assert.equal(g.count, 6);
        assert.ok(g.fits, `${look} ${theme} ${width}: graph controls escape their block`);
        assert.ok(g.bar && g.page, `${look} ${theme} ${width}: the bar or the page runs past the window: ${JSON.stringify(g)}`);
      }
    }
  });
}

// Dismissing is script; only the longest menu, File, is sized differently enough by the looks to check in both.
for (const look of ['modern', 'retro']) {
  for (const [name, trigger, panel] of [
    ['File', '.menu-btn', '.menu[role="menu"]'],
    ...(look === 'modern' ? [['Appearance', '.appear-btn', '.appear-menu'], ['Modes', '.desk-more', '.mode-menu']] : []),
  ]) {
    await check(`${look} ${name} dismisses on resize and reopens inside the shorter window`, async (p) => {
      await p.selectOption('select.look', look, { force: true });
      await p.locator(trigger).click();
      assert.ok(await p.locator(panel).isVisible());
      await p.setViewportSize({ width: 761, height: 560 });
      await p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(await p.locator(panel).isHidden(), `${look}: ${name} keeps stale placement after resize`);
      assert.equal(await p.locator(trigger).getAttribute('aria-expanded'), 'false');
      await p.locator(trigger).click();
      const box = await p.locator(panel).boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 762 && box.y + box.height <= 560, `${look}: reopened ${name} escapes the window`);
      if (name === 'File') {
        const last = p.locator(panel).getByRole('menuitem', { name: /Privacy/ });
        await last.focus();
        const item = await last.boundingBox();
        assert.ok(item.y >= box.y && item.y + item.height <= box.y + box.height, `${look}: File's final action cannot scroll into view`);
      }
      await p.keyboard.press('Escape');
      assert.ok(await p.locator(panel).isHidden());
    });
  }
}

for (const look of ['modern', 'retro']) {
  await check(`${look} short desktop Math pages keep readable tiles and scroll the final action into view`, async (p) => {
    await p.selectOption('select.look', look, { force: true });
    for (const viewport of [{ width: 761, height: 560 }, { width: 1280, height: 600 }, { width: 1440, height: 900 }]) {
      await p.setViewportSize(viewport);
      await p.locator('.ti-tab[aria-label="Math"]').click();
      await p.evaluate(() => document.fonts.ready.then(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null)))));
      const sizes = await p.locator('.ti-tile').evaluateAll((tiles) => tiles.map((tile) => {
        const rect = tile.getBoundingClientRect(), face = tile.querySelector('.ti-face');
        const range = document.createRange(); range.selectNodeContents(face);
        return { name: tile.getAttribute('aria-label'), height: rect.height, ink: range.getBoundingClientRect().height };
      }));
      for (const tile of sizes) {
        assert.ok(tile.height >= 28, `${look} ${viewport.height}: ${tile.name} shrank to ${tile.height}px`);
        assert.ok(tile.ink <= tile.height + 1, `${look}: formula is taller than its tile`);
      }
      const close = await p.locator('.ti-close').boundingBox(), keypad = await p.locator('#keypad').boundingBox();
      const last = p.locator('.ti-tile').last();
      await last.focus();
      const tile = await last.boundingBox(), scroll = await p.locator('.ti-scroll').boundingBox();
      assert.ok(tile.y >= scroll.y - 1 && tile.y + tile.height <= scroll.y + scroll.height + 1, `${look}: final Math tile cannot scroll into view`);
      const after = await p.locator('.ti-close').boundingBox();
      assert.ok(after.y === close.y && after.y >= keypad.y && after.y + after.height <= keypad.y + keypad.height, `${look}: scrolling hid the deck bar`);
      await p.locator('.ti-close').click();
      assert.ok(await p.locator('.ti-page').isHidden());
    }
  });
}

await check('desktop toolbar controls share one uniform height, and dragging a value block by its answer moves it without copying', async (p) => {
  await p.setViewportSize({ width: 1280, height: 800 });
  await seed(p, ['r = 4', 'A = pi * r^2', 'y = r * sin(x)']);
  await dropToast(p);
  await p.evaluate(() => document.fonts.ready);
  const heights = await p.evaluate(() => [...document.querySelectorAll('#app.canvas-ui > .modebar .desk-modes .seg, #app.canvas-ui > .modebar .cv-tools, #app.canvas-ui > .modebar .head-pill, #app.canvas-ui > .modebar .bar-tog, #app.canvas-ui > .modebar .desk-more, #app.canvas-ui > .modebar .appear-btn, #app.canvas-ui > .modebar .help-btn')]
    .filter((el) => el.offsetParent)
    .map((el) => Math.round(el.getBoundingClientRect().height)));
  assert.ok(heights.length >= 6 && new Set(heights).size === 1, `ragged toolbar heights: ${JSON.stringify(heights)}`);
  // Dragging starting on the value block's .result button moves the block instead of copying.
  const val = p.locator('.tape .rows > .row.blk-value').first();
  const res = val.locator('.out .result');
  const before = await val.boundingBox(), rb = await res.boundingBox();
  assert.ok(before && rb);
  await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await p.mouse.down();
  await p.mouse.move(rb.x + rb.width / 2 + 48, rb.y + rb.height / 2 + 32, { steps: 6 });
  await p.mouse.up();
  const after = await val.boundingBox();
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 20, `value block did not drag from its answer: ${JSON.stringify({ before, after })}`);
  assert.equal(await p.locator('.toast.show').count(), 0, 'dragging from the answer triggered copy toast');
  // A plain click on the answer still copies it.
  await res.click();
  await p.locator('.toast.show').waitFor();
  await dropToast(p);
  // Opening Steps and then clicking Math never jolts canvas zoom.
  const zoomBefore = await p.locator('.cv-zoom').innerText();
  await val.locator('.cv-steps').click();
  await p.locator('.ti-tab[aria-label="Math"]').click();
  const zoomAfter = await p.locator('.cv-zoom').innerText();
  assert.equal(zoomAfter, zoomBefore, `zoom jolted after Steps + Math click: ${zoomBefore} -> ${zoomAfter}`);
  await p.keyboard.press('Escape');
});

await check('wide to narrow resize resets psychrometric chart position, keeps value answers whole under Steps, and hugs narrow Math page to its grid', async (p) => {
  await p.setViewportSize({ width: 1280, height: 800 });
  await seed(p, ['r = 4', 'A = pi * r^2', 'y = r * sin(x)', 'S1 = psych(25, 0.5)']);
  await p.locator('.tape .rows > .row.blk-value .cv-steps').click();
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const state = await p.evaluate(() => {
    const val = document.querySelector('.tape .rows > .row.blk-value');
    const out = val.querySelector('.out'), res = val.querySelector('.out .result');
    const psych = document.querySelector('.tape .blk-psych');
    const prev = psych.previousElementSibling;
    const pr = psych.getBoundingClientRect(), vr = prev.getBoundingClientRect();
    return {
      ansWhole: res.scrollWidth <= out.clientWidth + 1,
      psychLeft: psych.style.left,
      psychTop: psych.style.top,
      psychRight: Math.round(pr.right),
      psychGap: Math.round(pr.top - vr.bottom),
    };
  });
  assert.ok(state.ansWhole, `mobile value answer clipped under Steps: ${JSON.stringify(state)}`);
  assert.equal(state.psychLeft, '', `psychBlock kept stale wide left: ${JSON.stringify(state)}`);
  assert.equal(state.psychTop, '', `psychBlock kept stale wide top: ${JSON.stringify(state)}`);
  assert.ok(state.psychRight <= 390, `psychBlock overflowed phone width: ${JSON.stringify(state)}`);
  assert.ok(state.psychGap < 80, `psychBlock left huge vertical void: ${JSON.stringify(state)}`);
  await p.locator('.ti-tab[aria-label="Math"]').click();
  await p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const deckCheck = await p.evaluate(() => {
    const pg = document.querySelector('.ti-page').getBoundingClientRect();
    const dock = document.querySelector('.composer-dock').getBoundingClientRect();
    const lastTile = [...document.querySelectorAll('.ti-page .ti-tile')].at(-1).getBoundingClientRect();
    return { coversComposer: pg.top < dock.bottom - 1 && pg.bottom > dock.top + 1, slack: Math.round(pg.bottom - lastTile.bottom) };
  });
  assert.ok(!deckCheck.coversComposer, `narrow Math deck covered composer/canvas: ${JSON.stringify(deckCheck)}`);
  assert.ok(deckCheck.slack <= 24, `narrow Math deck left ${deckCheck.slack}px of empty void under its tiles`);
  await p.locator('.ti-close').click();
});

await browser.close();
process.exitCode = failures ? 1 : 0;
