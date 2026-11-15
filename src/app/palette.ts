import { COMMANDS } from './commands';
import { mountDialog } from './overlay';
import { KEYS, store } from './persistence';
import { COLOR_NAMES, GRAPH_RATE_NAMES, MOTION_NAMES, THEME_NAMES } from '../ui/appearance';
import { USAGE, PRIORITY } from '../ui/complete';
import { ROUND_CHOICES } from '../ui/rounding';
import { type FnEntry, pushRecent, functionCatalog, findInsert, searchScore, SHOW_FROM, findDefaults } from '../ui/search';
import { play } from './sound';
import { homeOf, TABS } from '../ui/thumbindex';
import { setSetting, MODES, flipMode } from './controls';
import { escapeRegExp } from '../ui/text';
import { h } from './dom';
import { combineAll, runUndo, runRedo, addTable, appendLine } from './edits';
import { copy } from './feedback';
import { duplicateSheet, renameSheet, sheetAsText, exportJSON, importJSON, toggleKeySound } from './file';
import { copyGraphImage, exportSVG, fitGraph } from './graphpane';
import { switchPadSide } from './keypad';
import { graph } from './layout';
import { insertFromSearch } from './lineeditor';
import { COMBINE_HELP, COMBINE_OPS } from '../ui/combine';
import { openMatrixEditor, openShapeEditor, openVectorEditor } from './editors';
import { coarse, kb } from './platform';
import { prideUnlocked, setPride } from './pride';
import { showPrivacy } from './privacydialog';
import { focusLine } from './rowviews';
import { doc, currentSheet } from './sheet';
import { setKeypad, keypadOn } from './shell';
import { setThemeValue, setColor, setGraphRate, setMotion } from './theme';
import { ti, toggleTab, flashTab } from './thumb';

interface Command {
  label: string;
  detail: string;
  group: 'Function' | 'Action' | 'Example';
  keys?: string;
  fn?: FnEntry;
  danger?: boolean;
  run: () => void;
}
let recentFns: string[] = (() => {
  try {
    const v = JSON.parse(store.get(KEYS.recentFunctions) ?? '[]');
    return Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
})();
function noteRecent(name: string): void {
  recentFns = pushRecent(recentFns, name);
  store.set(KEYS.recentFunctions, JSON.stringify(recentFns));
}
function paletteCommands(): Command[] {
  const cmds: Command[] = [];
  for (const e of functionCatalog())
    cmds.push({ label: e.name, detail: e.detail || USAGE.get(e.name) || '', group: 'Function', keys: homeOf(e.name) ?? e.bank, fn: e, run: () => { noteRecent(e.name); insertFromSearch(findInsert(e, ti.fluid)); flashTab(e.name); } });
  const action = (label: string, detail: string, run: () => void, keys?: string, danger = false) => cmds.push({ label, detail, group: 'Action', keys, run, danger });
  action('Clear every line', 'Ctrl+Z brings every line back, any time later', COMMANDS.clearAll.run, COMMANDS.clearAll.keys.replace('Backspace', '⌫'), true);
  for (const [op, label, word] of COMBINE_OPS) action(`${word} all lines (${label})`, COMBINE_HELP, () => combineAll(op));
  action('Undo', 'Take back the last deleted line, clear, new sheet or open', runUndo, 'Ctrl+Z');
  action('Redo', 'Do the last undone change again', runRedo, 'Ctrl+Shift+Z');
  action('Add a normal curve', 'normaldist with a Cumulative probability box', COMMANDS.normalCurve.run, COMMANDS.normalCurve.keys);
  action('Add a table', 'Outcomes and probabilities, or data columns', addTable);
  action('New matrix…', 'A grid of any size to fill in, named A, B, …', openMatrixEditor);
  action('New shape…', 'A triangle or polygon from its corners, point by point', openShapeEditor);
  action('New vector…', 'A vector from its components, named v, u, …', openVectorEditor);
  action('Toggle degrees / radians', doc.settings.deg ? 'Now: degrees' : 'Now: radians', () => flipMode(MODES.angle), 'Ctrl+Alt+D');
  action('Toggle exact answers', 'Fractions, √ and π forms', () => flipMode(MODES.answers), 'Ctrl+Alt+E');
  action('Percent: of the number / as a number', MODES.addPercent.on() ? 'Now: of the number, 80 + 15% = 92' : 'Now: as a number, 80 + 15% = 80.15', () => flipMode(MODES.addPercent));
  action('Toggle sample SD', doc.settings.sample ? 'Now: sample (÷ n−1)' : 'Now: population (÷ n)', () => flipMode(MODES.sd), 'Ctrl+Alt+M');
  action('Toggle probabilities as %', '', () => flipMode(MODES.percent), 'Ctrl+Alt+P');
  action('Toggle line letters', 'Line 1 is A, line 2 is B, …', () => flipMode(MODES.letters), 'Ctrl+Alt+L');
  action('Toggle complex numbers', '√(−1) = i', () => flipMode(MODES.complex));
  for (const pl of ROUND_CHOICES) action(pl === null ? 'Round: automatic' : `Round to ${pl} decimal place${pl === 1 ? '' : 's'}`, 'For every answer and for copying', () => setSetting(() => { doc.display.places = pl; }));
  if (prideUnlocked()) action('Pride colors', doc.ui.pride ? 'Turn the flag off' : 'The flag over any theme', () => setPride(!doc.ui.pride));
  for (const [t, name] of THEME_NAMES) action(`Theme: ${name}`, t === 'oled' ? 'True black for OLED screens' : t === 'contrast' ? 'Black and white, outlined keys' : '', () => setThemeValue(t), 'Ctrl+Alt+T');
  for (const [c, name] of COLOR_NAMES) action(`Color: ${name}`, c === 'default' ? 'The look\'s own accent' : 'Sets the accent: the caret, the line being typed, enter and the operators', () => setColor(c));
  for (const [m, name] of MOTION_NAMES) action(`Motion: ${name}`, m === 'reduced' ? 'Quick fades, and nothing bounces or slides' : m === 'off' ? 'No animation' : '', () => setMotion(m));
  for (const [r, name] of GRAPH_RATE_NAMES) action(`Graph frame rate: ${name}`, r === '60' ? 'A little less battery while the graph moves' : "The display's full rate while the graph moves", () => setGraphRate(r));
  action('Fit the graph', 'Zoom to what is plotted', () => fitGraph(), 'Ctrl+Alt+F');
  action('Reset the graph', 'Back to −10 … 10', () => graph.reset(true));
  action('Save the graph as PNG', '', () => graph.exportPNG());
  action('Copy the graph image', 'Paste it into notes or a doc', copyGraphImage, 'C in the graph');
  action('Save the graph as SVG', 'Vector image: sharp at any size, good for printing', exportSVG);
  action('Clear pinned labels', 'Click points on the graph to pin them', () => graph.clearPins());
  action('Show or hide the keypad', '', COMMANDS.toggleKeypad.run, COMMANDS.toggleKeypad.keys);
  action('Show or hide the graph', '', COMMANDS.toggleGraph.run, COMMANDS.toggleGraph.keys);
  action('New sheet', 'A blank sheet; a named one is saved first, and Undo brings it back', COMMANDS.newSheet.run, COMMANDS.newSheet.keys, true);
  action('Save sheet', currentSheet ? `Every edit goes into "${currentSheet}"` : 'Keep it under a name', COMMANDS.saveSheet.run, COMMANDS.saveSheet.keys);
  action('Duplicate sheet', 'Save a copy as "Name copy" and open it', duplicateSheet);
  action('Rename sheet…', 'Change the open sheet\'s name', renameSheet);
  action('Open sheet…', 'Pick a saved sheet', COMMANDS.openSheet.run, COMMANDS.openSheet.keys);
  action('History', 'Everything you have calculated, kept for good', COMMANDS.history.run, COMMANDS.history.keys);
  action('Switch number pad side', 'Keys laid out for the right thumb or mirrored for the left', switchPadSide);
  action('Copy sheet as text', 'Every line with its answer', () => copy(sheetAsText()));
  action('Export sheet…', 'JSON file', exportJSON);
  action('Import sheet…', 'JSON file', importJSON);
  action(doc.ui.sound === false ? 'Turn key sounds on' : 'Turn key sounds off', '', () => toggleKeySound());
  action('Keyboard shortcuts', 'Every key, in one list', COMMANDS.help.run, COMMANDS.help.keys);
  action('Privacy', 'What Slopculator keeps, and where', showPrivacy);
  TABS.forEach((t, i) => action(`Keypad: ${t.name}`, `Open the ${t.name} tab: ${t.subtitle}`, () => { if (!keypadOn()) setKeypad(true); if (ti.tab !== i) toggleTab(i, true); }, `Ctrl+Alt+${i + 1}`));
  const example = (label: string, lines: string[], detail: string) => cmds.push({ label, detail, group: 'Example', run: () => { for (const l of lines) appendLine(l); } });
  example('Shade a normal curve', ['μ = 400', 'σ = 50', 'normaldist(μ, σ)'], 'μ, σ sliders and a curve; tick Cumulative probability');
  example('z-score and area', ['zscore(180, 280, 40)', 'normalcdf(-inf, ans)'], 'Standardize, then the area to the left');
  example('Binomial probability', ['binompdf(10, 0.5, 6)', 'binomcdf(10, 0.5, 6)'], 'Exactly 6 and at most 6 in 10 flips');
  example('Compound interest', ['compound(1000, 0.05, 12, 10)', 'solve(1000(1 + 0.05/12)^(12t) = 2000, t)'], 'Future value, then time to double');
  example('Graph a sine wave with sliders', ['a = 2', 'b = 1', 'y = a sin(b x)'], 'Drag a and b');
  example('Matrix inverse', ['A = [[1, 2], [3, 4]]', 'det(A)', 'inv(A)'], 'Define a matrix and invert it');
  example('Drag a parabola\'s vertex', ['h = 1', 'k = -2', 'y = (x - h)^2 + k', '(h, k)'], 'Grab the ringed point on the graph and move it');
  example('HVAC: moist air from a sling reading', ['psychwb(75, 62.6)', 'psych(75, 50, 5280)'], 'Every property; the second line is at 5280 ft');
  example('HVAC: check a refrigerant charge', ['superheat("R410A", 118, 50)', 'subcool("R410A", 340, 95)', 'targetsuperheat(62, 85)'], 'Gauge pressures and line temperatures');
  example('HVAC: cooling coil load', ['coil(1200, 75, 50, 55, 90)', 'sensibleheat(1200, 20)'], 'Total, sensible and latent load, tons, condensate');
  example('HVAC: size a duct', ['ductsize(1000, 0.1)', 'ductvel(1000, 14)', 'eqdia(18, 10)'], '1000 CFM at 0.1 in. w.c. per 100 ft');
  example('HVAC: refrigeration cycle', ['refcycle("R454B", 45, 105, 10, 10, 70)', 'ptchart("R454B", 45)'], 'COP, EER, kW/ton, discharge temperature');
  example('HVAC: psychrometric chart', ['y = grains(x, 100)', 'y = grains(x, 50)', 'y = grains(x, 25)'], 'Grains against dry bulb at three humidities; zoom to fit');
  // The homework guide (docs/guide.md), one example per typical problem, tagged by unit.
  example('Unit 7: change of base', ['log_3(81)', 'ln(81)/ln(3)'], 'log₃ 81 two ways');
  example('Unit 7: doubling time', ['solve(1000(1 + 0.05/12)^(12t) = 2000, t)'], 'Monthly compounding at 5%');
  example('Unit 8: rational function', ['y = 1/(x - 2) + 3'], 'Asymptotes at x = 2 and y = 3');
  example('Unit 9: arithmetic sequence and sum', ['seq(2n + 1, n, 1, 4)', 'sum(2n + 1, n, 1, 20)'], 'Terms, then a partial sum');
  example('Unit 9: geometric sequence', ['a(n) = 3·2^(n − 1)', 'a(5)', 'sum(a(n), n, 1, 5)'], 'Define it, use it, add it up');
  example('Unit 10: circle and ellipse', ['x^2 + y^2 = 25', 'x^2/9 + y^2/4 = 1'], 'Conics as equations');
  example('Unit 11: list statistics', ['L = {2, 4, 4, 4, 5, 5, 7, 9}', 'mean(L)', 'sdp(L)', 'fivenum(L)'], 'Mean, population SD, box plot');
  example('Unit 11: empirical rule vs exact', ['empirical(400, 50, 350, 500)', 'normalcdf(350, 500, 400, 50)'], '0.815 by the rule, 0.8186 exact');
  example('Unit 11: percentile score', ['invNorm(0.9, 100, 15)'], 'The 90th percentile when μ = 100, σ = 15');
  example('Unit 11: expected value of a game', ['EV({-1, 5}, {0.8, 0.2})', 'netgain({0, 10}, {0.9, 0.1}, 2)'], 'Average outcome, then net of the cost');
  example('Unit 12: solve a system', ['linsolve([[2, 1], [1, 3]], [3, 5])'], '2x + y = 3, x + 3y = 5');
  example('Unit 12: transform a triangle', ['T = polygon((0,0), (2,0), (1,2))', 'rotation(90) * T', 'dilation(2) * T'], 'Rotate and dilate a shape');
  example('Unit 13: unit circle, exact', ['unitcircle(60)', 'unitcircle(135)'], 'Turn on Exact for √ forms');
  example('Unit 13: transformed sine with sliders', ['a = 2', 'b = 3', 'c = 0', 'd = 1', 'y = a sin(b(x − c)) + d', 'trigform(a, b, c, d)'], 'Drag the sliders');
  return cmds;
}
/** Higher is better; -1 is no match. */
function fuzzy(q: string, text: string): number {
  if (!q) return 0;
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 1000 - t.length;
  const at = (w: string) => { const m = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(w)}`, 'u').exec(t); return m ? m.index + m[1].length : -1; };
  const i0 = at(q);
  if (i0 > 0) return 700 - i0 - t.length / 10;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => at(w) >= 0)) return 400 - t.length / 10;
  return -1;
}
export function openPalette(): void {
  if (document.querySelector('dialog.palette[open]')) return;
  const all = paletteCommands();
  const input = h('input', { class: 'pal-input', type: 'text', placeholder: 'Search functions, actions, and examples', spellcheck: 'false', autocomplete: 'off',
    role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list', 'aria-autocomplete': 'list', 'aria-label': 'Command palette' });
  const list = h('div', { class: 'pal-list', id: 'pal-list', role: 'listbox' });
  const foot = h('div', { class: 'pal-foot' }, h('span', {}, h('kbd', {}, '↑↓'), ' choose'), h('span', {}, h('kbd', {}, 'Enter'), ' insert or run'), h('span', {}, h('kbd', {}, 'Esc'), ' close'));
  const dialog = h('dialog', { class: 'palette', 'aria-label': 'Command palette' }, input, list, foot);
  if (coarse.matches) input.inputMode = 'search';
  let shown: Command[] = [];
  // Nothing chosen yet and nothing typed: nothing is selected, so Enter on a fresh palette does nothing (it once inserted
  // ln()). With recent functions the newest is selected, ready to insert again.
  let sel = recentFns.length ? 0 : -1;
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const rank = (c: Command): number => {
      if (!c.fn) return Math.max(fuzzy(q, c.label), fuzzy(q, c.detail) - 300, c.keys ? fuzzy(q, c.keys) - 400 : -1);
      const s = searchScore(q, c.fn);
      return s < SHOW_FROM ? -1 : s + (PRIORITY.includes(c.label) ? 40 : 0);
    };
    const scored = all
      .map((c) => ({ c, s: q ? rank(c) : 0 }))
      .filter((x) => x.s >= 0 || !q)
      .sort((a, b) => b.s - a.s || (a.c.group === b.c.group ? 0 : a.c.group === 'Action' ? -1 : 1));
    if (!q) {
      const fns = new Map(all.filter((c) => c.fn).map((c) => [c.label, c]));
      const first = findDefaults(all.flatMap((c) => (c.fn ? [c.fn] : [])), recentFns).map((e) => fns.get(e.name)!).filter(Boolean);
      const rest = all.filter((c) => !c.fn);
      shown = [...first, ...rest.filter((c) => !c.danger), ...rest.filter((c) => c.danger)].slice(0, 60);
    } else shown = scored.slice(0, 60).map((x) => x.c);
    sel = Math.min(sel, shown.length - 1);
    list.replaceChildren(...shown.map((c, i) => {
      const item = h('div', { class: `pal-item${i === sel ? ' sel' : ''}`, role: 'option', id: `pal-${i}`, 'aria-selected': String(i === sel) },
        h('span', { class: `pal-tag ${c.group.toLowerCase()}` }, c.group === 'Function' ? 'f(x)' : c.group === 'Action' ? 'do' : 'try'),
        h('span', { class: 'pal-label' }, c.label),
        h('span', { class: 'pal-detail' }, c.detail),
        c.keys ? h('kbd', { class: c.fn && homeOf(c.fn.name) ? 'pal-keys home' : 'pal-keys' }, kb(c.keys)) : null,
      );
      item.addEventListener('mousedown', (e) => { e.preventDefault(); sel = i; choose(); });
      item.addEventListener('mousemove', () => { if (sel !== i) { sel = i; mark(); } });
      return item;
    }));
    if (!shown.length) list.append(h('div', { class: 'pal-empty' }, 'Nothing matches. Try a function name like invNorm, or what it does, like "percentile" or "miles to km".'));
    input.setAttribute('aria-activedescendant', shown.length && sel >= 0 ? `pal-${sel}` : '');
  };
  const mark = () => {
    list.querySelectorAll('.pal-item').forEach((el, i) => { el.classList.toggle('sel', i === sel); el.setAttribute('aria-selected', String(i === sel)); });
    input.setAttribute('aria-activedescendant', `pal-${sel}`);
    list.querySelector('.pal-item.sel')?.scrollIntoView({ block: 'nearest' });
  };
  const choose = () => {
    const c = shown[sel];
    if (!c) return;
    dialog.close();
    play(c.group === 'Function' ? 'fn' : 'toggle');
    if (c.group === 'Function') focusLine();
    c.run();
  };
  input.addEventListener('input', () => { sel = input.value.trim() || recentFns.length ? 0 : -1; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      sel = sel < 0 ? (e.key === 'ArrowDown' ? 0 : shown.length - 1) : (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      mark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose();
    }
  });
  dialog.addEventListener('close', () => { if (!document.activeElement || document.activeElement === document.body) focusLine(); });
  dialog.addEventListener('mousedown', (e) => { if (e.target === dialog) dialog.close(); });
  mountDialog(dialog);
  draw();
  dialog.showModal();
  input.focus();
}
