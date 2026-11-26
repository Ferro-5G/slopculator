// Rules the type checker can't see: failures are read through their form and not their wording, timers/rAF/effects don't
// creep in, layers stay clean, private directories don't leak into public code, and stray Markdown notes don't land in
// the tree. Each problem prints as file:line and what to do instead.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// Caps per file. The mobile app keeps its own list, so a checkout without mobile/ has nothing stale to lower.
const BASELINES = [
  { path: 'mobile/lint-baseline.json', covers: (file) => file.startsWith('mobile/'), sections: ['timers', 'raf', 'useEffect'] },
  { path: 'scripts/lint-baseline.json', covers: () => true, sections: ['timers', 'raf'] },
];
const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', 'dist-node', 'dist-site', 'Pods', '.expo', '.gradle', '.git', '.shots', '.claude']);
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

const MESSAGE_DIRS = ['src', 'mobile/src'];
const MESSAGE_HOME = 'src/engine/errors.ts';
const CONSOLE_LOG_DIRS = ['src', 'mobile/src'];
const TIMER_DIRS = ['src', 'mobile/src', 'mobile/modules', 'mobile/scripts', 'mobile/test', 'scripts', 'test'];
const RAF_DIRS = ['src', 'mobile/src', 'mobile/modules', 'scripts', 'test'];
const EFFECT_DIRS = ['mobile/src'];
const PRIVATE_DIRS = ['mobile', 'src-tauri'];
const PUBLIC_CODE_DIRS = ['src', 'test', 'site'];
const LAYERS = [
  { dir: 'src/engine', may: ['src/engine'], says: 'src/engine imports nothing outside itself' },
  { dir: 'src/ui', may: ['src/ui', 'src/engine'], says: 'src/ui imports only itself and src/engine' },
];
const MOBILE_LAYERS = [
  { dir: 'mobile/src/state', forbid: ['mobile/src/components', 'mobile/src/app'], says: 'mobile/src/state stays below UI components and screens' },
  { dir: 'mobile/src/lib', forbid: ['mobile/src/components', 'mobile/src/app'], says: 'mobile/src/lib stays below UI components and screens' },
  { dir: 'mobile/src/components', forbid: ['mobile/src/app'], says: 'mobile/src/components does not import routes from mobile/src/app' },
];
const ALLOWED_ROOT_MD = new Set([
  'AGENTS.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'PRIVACY.md', 'README.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md',
]);
const ALLOWED_SUB_MD = new Set(['mobile/AGENTS.md', 'mobile/README.md', 'trailer/README.md', 'src-tauri/README.md']);
const ALIASES = { '@engine': 'src/engine', '@shared': 'src/ui' };
const PLATFORM_GLOBALS = /(?<![\w$])(?:globalThis\s*\.\s*)?(?:document|window|navigator|localStorage|HTMLElement|process|Buffer|__dirname|__filename)(?![\w$])/g;

const posix = (path) => path.split(sep).join('/');
const inside = (path, dir) => path === dir || path.startsWith(`${dir}/`);
const lineAt = (code, at) => code.slice(0, at).split('\n').length;

function walk(dir, found = [], matcher = SOURCE) {
  const full = dir ? join(root, dir) : root;
  if (!existsSync(full)) return found;
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path, found, matcher);
    } else if (matcher.test(entry.name)) found.push(path);
  }
  return found;
}

const openerOf = (code, close) => {
  for (let i = close, depth = 0; i >= 0; i--) {
    if (')]}'.includes(code[i])) depth++;
    else if ('([{'.includes(code[i]) && --depth === 0) return i;
  }
  return -1;
};

const closerOf = (code, open) => {
  for (let i = open, depth = 0; i < code.length; i++) {
    if ('([{'.includes(code[i])) depth++;
    else if (')]}'.includes(code[i]) && --depth === 0) return i;
  }
  return code.length;
};

/** Where the block around at ends: the first } that closes something opened before at. */
const blockEnd = (code, at) => {
  for (let i = at, depth = 0; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth < 0) return i;
  }
  return code.length;
};

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'void', 'delete', 'throw', 'new', 'await', 'yield']);

/** Whether a / at i opens a regex and doesn't divide, going by what came before it. */
function regexCanStart(out, i) {
  let p = i - 1;
  while (p >= 0 && /\s/.test(out[p])) p--;
  if (p < 0) return true;
  const c = out[p];
  if (/[\w$]/.test(c)) {
    let start = p;
    while (start > 0 && /[\w$]/.test(out[start - 1])) start--;
    return out[start - 1] !== '.' && REGEX_AFTER_WORD.has(out.slice(start, p + 1).join(''));
  }
  if (c === ')') {
    let w = openerOf(out, p) - 1;
    while (w >= 0 && /\s/.test(out[w])) w--;
    return ['if', 'while', 'for'].includes(out.slice(Math.max(0, w - 4), w + 1).join('').match(/[a-z]+$/)?.[0]);
  }
  if (c === '>') return out[p - 1] === '=';
  return '(,=:[!&|?{;+-*%~^'.includes(c);
}

/**
 * The source with comments and the text of strings and regexes blanked, keeping its length and line breaks, so a rule
 * only ever sees real code. strings holds each string's text and where it opens, for reading imports.
 */
function blank(src) {
  const out = src.split('');
  const strings = [];
  const wipe = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  const holes = []; // the brace depth outside each open ${ }
  let depth = 0;
  let i = 0;

  const templateText = (start, opening) => {
    let k = start;
    while (k < src.length) {
      if (src[k] === '\\') k += 2;
      else if (src[k] === '`') {
        if (opening !== null) strings.push({ at: opening, text: src.slice(start, k) });
        wipe(start, k);
        return k + 1;
      } else if (src[k] === '$' && src[k + 1] === '{') {
        wipe(start, k);
        holes.push(depth);
        depth++;
        return k + 2;
      } else k++;
    }
    wipe(start, k);
    return k;
  };

  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      let k = i;
      while (k < src.length && src[k] !== '\n') k++;
      wipe(i, k);
      i = k;
    } else if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? src.length : close + 2;
      wipe(i, end);
      i = end;
    } else if (c === '/' && regexCanStart(out, i)) {
      let k = i + 1;
      let inClass = false;
      while (k < src.length && src[k] !== '\n' && (inClass || src[k] !== '/')) {
        if (src[k] === '\\') k++;
        else if (src[k] === '[') inClass = true;
        else if (src[k] === ']') inClass = false;
        k++;
      }
      if (src[k] === '/') {
        wipe(i + 1, k);
        i = k + 1;
      } else i++;
    } else if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < src.length && src[k] !== c && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      // A quote with no partner on its line is an apostrophe in JSX text.
      if (src[k] === c) {
        strings.push({ at: i, text: src.slice(i + 1, k) });
        wipe(i + 1, k);
        i = k + 1;
      } else i++;
    } else if (c === '`') {
      i = templateText(i + 1, i);
    } else if (c === '{') {
      depth++;
      i++;
    } else if (c === '}') {
      depth--;
      i++;
      if (holes.at(-1) === depth) {
        holes.pop();
        i = templateText(i, null);
      }
    } else i++;
  }
  return { code: out.join(''), strings };
}

/** The expression the method call at dot is made on: r.error in r.error?.includes(x). */
function receiverBefore(code, dot) {
  let i = dot;
  for (;;) {
    while (i > 0 && /\s/.test(code[i - 1])) i--;
    if (code[i - 1] === '!') i--;
    const c = code[i - 1];
    if (c === ')' || c === ']') {
      i = openerOf(code, i - 1);
      if (i <= 0) return '';
      continue;
    }
    if (!/[\w$]/.test(c ?? '')) break;
    while (i > 0 && /[\w$]/.test(code[i - 1])) i--;
    let j = i;
    while (j > 0 && /\s/.test(code[j - 1])) j--;
    if (code[j - 1] !== '.') break;
    i = code[j - 2] === '?' ? j - 2 : j - 1;
  }
  return code.slice(i, dot);
}

/** The part of e before the first top-level ??, || or as. */
function leftOperand(e) {
  for (let i = 0, depth = 0; i < e.length; i++) {
    if ('([{'.includes(e[i])) depth++;
    else if (')]}'.includes(e[i])) depth--;
    else if (depth === 0 && (e.startsWith('??', i) || e.startsWith('||', i) || e.startsWith(' as ', i))) return e.slice(0, i).trim();
  }
  return e;
}

// Singular on purpose: notes.includes(x) asks whether an array holds x, which reads nothing back.
const MESSAGE_NAME = /^(?:err|error|msg|message|note|warning)(?:Text|Msg|Message)?$|(?:Err|Error|Msg|Message|Note|Warning)(?:Text|Msg|Message)?$/;
const MESSAGE_LIST = /^(?:\w+\.)*(?:notes|errors)$/;
const NORMALIZER = /(?:\?\.|\.)(?:toLowerCase|toUpperCase|trim|trimStart|trimEnd|toString|normalize)\(\)$/;

function isMessage(expression, at, bound) {
  let e = expression.replace(/\s+/g, ' ').trim();
  for (let before = ''; before !== e; ) {
    before = e;
    e = leftOperand(e.replace(NORMALIZER, '').replace(/[?!]$/, '').trim());
    const wrapped = /^String\((.*)\)$/.exec(e);
    if (wrapped) e = wrapped[1].trim();
    else if (e.startsWith('(') && closerOf(e, 0) === e.length - 1) e = e.slice(1, -1).trim();
  }
  if (e.endsWith(']')) return MESSAGE_LIST.test(e.slice(0, openerOf(e, e.length - 1)).replace(/\?\.|!/g, '.').replace(/\.+$/, ''));
  if (e.endsWith(')')) e = e.slice(0, openerOf(e, e.length - 1));
  const name = /[\w$]+$/.exec(e)?.[0];
  if (!name) return false;
  return MESSAGE_NAME.test(name) || bound.some((b) => b.name === name && at >= b.from && at <= b.to);
}

/** Names that hold failure text without saying so: a catch's error, a callback or loop over notes, and aliases of those. */
function messageBindings(code) {
  const bound = [];
  for (const m of code.matchAll(/\bcatch\s*\(\s*([\w$]+)[^)]*\)\s*\{/g)) {
    bound.push({ name: m[1], from: m.index, to: closerOf(code, m.index + m[0].length - 1) });
  }
  for (const m of code.matchAll(/\b(?:notes|errors)\s*\)?\s*(?:\?\.|\.)\s*(?:some|every|find|findIndex|filter|map|flatMap|forEach)\s*\(\s*\(?\s*([\w$]+)/g)) {
    const open = code.indexOf('(', m.index + m[0].lastIndexOf('.'));
    bound.push({ name: m[1], from: m.index, to: closerOf(code, open) });
  }
  for (const m of code.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([\w$]+)\s+of\s+[^)\n]*\b(?:notes|errors)\b[^)\n]*\)\s*/g)) {
    const after = m.index + m[0].length;
    const end = code[after] === '{' ? closerOf(code, after) : code.indexOf('\n', after);
    bound.push({ name: m[1], from: m.index, to: end === -1 ? code.length : end });
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*(?::[^=;\n]+)?=(?![=>])/g)) {
    const start = m.index + m[0].length;
    let end = start;
    for (let depth = 0; end < code.length; end++) {
      const c = code[end];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) {
        if (--depth < 0) break;
      } else if (depth === 0 && (c === ';' || c === '\n') && code.slice(start, end).trim()) break;
    }
    if (isMessage(code.slice(start, end), m.index, bound)) bound.push({ name: m[1], from: m.index, to: blockEnd(code, end) });
  }
  return bound;
}

const READ_BACK = 'Read the failure through readError, or isWarningNote for a note, from src/engine/errors.ts instead of testing its wording.';

function checkMessages(file, code, report) {
  const bound = messageBindings(code);
  for (const m of code.matchAll(/(?:\?\.|\.)\s*(?:includes|startsWith|match)\s*\(/g)) {
    if (isMessage(receiverBefore(code, m.index), m.index, bound)) report(file, m.index, READ_BACK);
  }
  for (const m of code.matchAll(/(?:\?\.|\.)\s*test\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    if (isMessage(code.slice(open + 1, closerOf(code, open)), m.index, bound)) report(file, m.index, READ_BACK);
  }
}

function importTarget(spec, file) {
  const alias = /^(@engine|@shared)(\/.*)?$/.exec(spec);
  if (alias) return ALIASES[alias[1]] + (alias[2] ?? '');
  if (file.startsWith('mobile/') && spec.startsWith('@/')) {
    return spec.startsWith('@/assets/') ? `mobile/${spec.slice(2)}` : `mobile/src/${spec.slice(2)}`;
  }
  return spec.startsWith('.') ? posix(relative(root, resolve(root, dirname(file), spec))) : null;
}

function importKind(code, at) {
  const before = code.slice(Math.max(0, at - 40), at);
  if (/\b(?:from|import)\s*$/.test(before)) return 'static';
  if (/\b(?:import|require)\s*\(\s*$/.test(before)) return 'dynamic';
  return null;
}

function checkLayer(file, code, strings, layer, report) {
  for (const s of strings) {
    if (!importKind(code, s.at)) continue;
    const target = importTarget(s.text, file);
    if (target !== null && layer.may.some((dir) => inside(target, dir))) continue;
    report(file, s.at, `${layer.says}, so "${s.text}" can't be imported here. Move what you need into this layer, or have the platform pass it in.`);
  }
  for (const m of code.matchAll(PLATFORM_GLOBALS)) {
    let prev = m.index - 1;
    while (prev >= 0 && /\s/.test(code[prev])) prev--;
    const after = code.slice(m.index + m[0].length).trimStart();
    if (code[prev] === '.' || (after.startsWith(':') && '{,('.includes(code[prev]))) continue;
    report(file, m.index, `${m[0].replace(/^globalThis\s*\.\s*/, '')} only exists on some platforms, and this layer runs in browsers, Node and on phones. Have the platform that calls this pass in what you need.`);
  }
}

function checkMobileLayer(file, code, strings, layer, report) {
  for (const s of strings) {
    if (!importKind(code, s.at)) continue;
    const target = importTarget(s.text, file);
    if (target !== null && layer.forbid.some((dir) => inside(target, dir))) {
      report(file, s.at, `${layer.says}, so "${s.text}" can't be imported here. Pass a callback in or move shared logic down into mobile/src/state or mobile/src/lib.`);
    }
  }
}

function checkPrivateImports(file, code, strings, allowDynamic, report) {
  for (const s of strings) {
    const kind = importKind(code, s.at);
    if (!kind || (allowDynamic && kind === 'dynamic')) continue;
    const target = importTarget(s.text, file) ?? s.text;
    const hit = PRIVATE_DIRS.find((dir) => inside(target, dir));
    if (hit) {
      report(file, s.at, `files outside ${hit}/ cannot import from "${s.text}" because ${hit}/ is excluded from the public copy.`);
    }
  }
}

function checkConsoleLogs(file, code, report) {
  for (const m of code.matchAll(/(?<![\w$])console\s*\.\s*log\s*\(/g)) {
    report(file, m.index, 'remove console.log from app/engine source before shipping.');
  }
}

function checkMarkdown(problems) {
  for (const file of walk('', [], /\.md$/i).sort()) {
    if (ALLOWED_ROOT_MD.has(file) || ALLOWED_SUB_MD.has(file)) continue;
    if (file.startsWith('docs/') || file.startsWith('.github/')) continue;
    problems.push(`${file}:1: stray Markdown file outside docs/ and the repo root docs. Move real documentation into docs/ or delete the scratch note.`);
  }
}

function callMatches(code, pattern) {
  return [...code.matchAll(pattern)]
    .filter((m) => !/\bfunction\s*\*?\s*$/.test(code.slice(Math.max(0, m.index - 20), m.index)))
    .map((m) => m.index);
}

const timerCalls = (code) => callMatches(code, /(?<![\w$])(?:setTimeout|sleep)\s*\(/g);
const rafCalls = (code) => callMatches(code, /(?<![\w$])requestAnimationFrame\s*\(/g);
const effectCalls = (code) => callMatches(code, /(?<![\w$])useEffect\s*\(/g);

const BUDGETS = {
  timers: {
    dirs: TIMER_DIRS,
    count: timerCalls,
    message: (count, allowed, path) =>
      `this file has ${count} setTimeout or sleep call${count === 1 ? '' : 's'} and its baseline allows ${allowed}. Wait on a real condition (an event, a callback, a poll for the state you need), or put the reason in a comment at the call and raise this file's number under "timers" in ${path}.`,
  },
  raf: {
    dirs: RAF_DIRS,
    count: rafCalls,
    message: (count, allowed, path) =>
      `this file has ${count} requestAnimationFrame call${count === 1 ? '' : 's'} and its baseline allows ${allowed}. Avoid chaining frames as a timing workaround; if a frame loop or post-layout read is required, explain why in a comment at the call and raise this file's number under "raf" in ${path}.`,
  },
  useEffect: {
    dirs: EFFECT_DIRS,
    count: effectCalls,
    message: (count, allowed, path) =>
      `this file has ${count} useEffect call${count === 1 ? '' : 's'} and its baseline allows ${allowed}. Derive state during render or run work in an event handler instead of adding another effect. If an external subscription truly needs one, explain why in a comment and raise this file's number under "useEffect" in ${path}.`,
  },
};

function readBaseline(baselinePath, sections) {
  if (!existsSync(baselinePath)) return Object.fromEntries(sections.map((s) => [s, {}]));
  const raw = JSON.parse(readFileSync(baselinePath, 'utf8'));
  // Backward-compatible with flat { "path": count } timer baselines if one exists on an older branch.
  const structured = sections.some((s) => raw[s] && typeof raw[s] === 'object');
  if (!structured) {
    return Object.fromEntries(sections.map((s) => [s, s === 'timers' ? raw : {}]));
  }
  return Object.fromEntries(sections.map((s) => [s, raw[s] ?? {}]));
}

function sameBaseline(a, b, sections) {
  for (const s of sections) {
    const ka = Object.keys(a[s] ?? {});
    const kb = Object.keys(b[s] ?? {});
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (a[s][k] !== b[s][k]) return false;
  }
  return true;
}

function main() {
  const problems = [];
  const sources = new Map();
  const report = (file, at, text) => problems.push(`${file}:${lineAt(sources.get(file).code, at)}: ${text}`);
  const load = (file) => {
    if (!sources.has(file)) sources.set(file, blank(readFileSync(join(root, file), 'utf8')));
    return sources.get(file);
  };

  for (const file of MESSAGE_DIRS.flatMap((dir) => walk(dir))) {
    if (file !== MESSAGE_HOME) checkMessages(file, load(file).code, report);
  }
  for (const file of CONSOLE_LOG_DIRS.flatMap((dir) => walk(dir))) {
    checkConsoleLogs(file, load(file).code, report);
  }
  for (const layer of LAYERS) {
    for (const file of walk(layer.dir)) {
      const { code, strings } = load(file);
      checkLayer(file, code, strings, layer, report);
    }
  }
  for (const layer of MOBILE_LAYERS) {
    for (const file of walk(layer.dir)) {
      const { code, strings } = load(file);
      checkMobileLayer(file, code, strings, layer, report);
    }
  }
  for (const file of PUBLIC_CODE_DIRS.flatMap((dir) => walk(dir))) {
    const { code, strings } = load(file);
    checkPrivateImports(file, code, strings, false, report);
  }
  for (const file of walk('scripts')) {
    const { code, strings } = load(file);
    checkPrivateImports(file, code, strings, true, report);
  }
  checkMarkdown(problems);

  for (const { path, covers, sections } of BASELINES) {
    const baselinePath = join(root, path);
    const allCovered = [...new Set(sections.flatMap((s) => BUDGETS[s].dirs.flatMap((dir) => walk(dir))))]
      .filter((file) => BASELINES.find((b) => b.covers(file)).path === path);
    if (!existsSync(baselinePath) && allCovered.length === 0) continue;
    const baseline = readBaseline(baselinePath, sections);
    const kept = {};
    for (const section of sections) {
      const budget = BUDGETS[section];
      const mine = [...new Set(budget.dirs.flatMap((dir) => walk(dir)))]
        .filter((file) => BASELINES.find((b) => b.covers(file)).path === path)
        .sort();
      const keptSection = {};
      for (const file of mine) {
        const calls = budget.count(load(file).code);
        const allowed = baseline[section][file] ?? 0;
        if (calls.length > allowed) {
          report(file, calls[allowed], budget.message(calls.length, allowed, path));
        }
        const lowest = Math.min(calls.length, allowed);
        if (lowest > 0) keptSection[file] = lowest;
      }
      kept[section] = keptSection;
    }
    if (!sameBaseline(baseline, kept, sections)) {
      // CI can't commit the lower numbers, and a stale higher number there is harmless until someone runs this locally.
      if (process.env.CI) console.log(`${path} is higher than the code needs. Run npm run lint locally to lower it.`);
      else {
        writeFileSync(baselinePath, `${JSON.stringify(kept, null, 2)}\n`);
        console.log(`Lowered ${path} to match the code. Commit the change.`);
      }
    }
  }

  if (problems.length > 0) {
    for (const line of problems) console.error(line);
    console.error(`\n${problems.length} lint problem${problems.length === 1 ? '' : 's'}.`);
    process.exit(1);
  }
  console.log('Lint passed.');
}

main();
