# Architecture

Slopculator is one zero-dependency TypeScript engine shared across front ends. `src/ui/` holds platform-independent UI logic (no DOM or Node globals), including rules shared with the phone apps, which aren't in the public repository yet.

```
src/engine/        lexer -> parser -> compiled closures -> values, plus exact math
src/ui/            shared UI logic with no DOM: keypad, typesetting, search, layout, plots, palettes
src/app/           web app UI (vanilla TypeScript, no framework)
src/main.ts        loads fonts/styles and boots src/app
test/              vitest unit tests; scripts/e2e.mjs runs the built app in Chrome
```

## Engine pipeline

1. **`lexer.ts`** tokenizes input. Lines containing a backslash pass through `latex.ts` first to normalize copied LaTeX (`\frac{1}{2}`, `\left(`, `x_{1}`). It also normalizes symbols (`×`, `÷`, `−`, `≤`), superscripts (`x²`), and Greek names (`mu`, `pi`).
2. **`parser.ts`** is a Pratt parser supporting implicit multiplication (`2x`, `a(b + c)`), postfix `!`, `%`, `°`, `|x|`, `log_b(x)`, `sin^2(x)`, points, lists `{...}`, matrices `[[...]]`, vectors `⟨...⟩`, piecewise expressions, and chained relations.
3. **`evaluator.ts`** compiles ASTs to JS closures once so graph sampling never walks the tree. Name lookup order: locals, sheet variables, constants, built-ins, then single-letter splitting (`nt` -> `n*t`). Unknown names trigger a "Did you mean" suggestion.
4. **`builtins.ts`, `more.ts`, `compat.ts`** define all built-in functions plus Desmos/TI compatibility forms (`total`, `nDeriv`, `L[2]`, `[1...10]`, `normaldist(0, 1).cdf(1)`).
5. **`values.ts`** defines value types (number, complex, list, point, vector, matrix, distributions, polygon, record, text) and broadcasting arithmetic.
6. **`numeric.ts`** implements special functions: erf/erfc, inverse normal (Acklam + Halley refinement), incomplete gamma/beta, and log-space binomial terms.
7. **`document.ts`** evaluates sheets in dependency order with cycle detection, runs regressions through `regress.ts` and `fit.ts` (QR for linear models, Levenberg-Marquardt for nonlinear), and classifies lines into values, sliders, graphs, distributions, or tables.
8. **`hvac.ts` and `refrigerants-data.ts`** hold moist-air, load, duct, and refrigerant functions. `scripts/build-hvac-data.py` generates the refrigerant tables and `test/hvac-vectors.json` from CoolProp and PsychroLib.
9. **`format.ts`** formats numbers (12 significant digits), exact forms (`3/8`, `√3/2`, `π/6`), percents, and plain copyable text.

### Exact arithmetic

Graphs and built-ins run on IEEE doubles, then exact math upgrades displayed results when supported:

1. **`real.ts`** implements BigInt ball arithmetic (`m*2^e` with an error radius `r*2^e`) for basic ops, roots, integer powers, exp, ln, trig, `atan`, `π`, and `ln 2`.
2. **`exact.ts`** represents numbers as exact BigInt rationals, rational multiples of `π`, or balls, keeping arithmetic exact (`0.1 + 0.2 = 3/10`, `sin(30°) = 1/2`) and printing only proven decimal digits.
3. **`precise.ts`** evaluates supported AST nodes using the same name resolution as `compile()`. If a ball is too wide, it retries at 128, 320, 800, and 2000 bits.
4. **`document.ts`** runs exact math after float evaluation succeeds (or on large factorials/`nCr`), stores the exact value on `RowResult.precise`, and updates the float `value` to the nearest double.

Guardrails keep typing responsive: rationals stop at 65,472 bits (staying under Hermes's 65,536-bit mobile limit), loops stop at 20,000 terms, and exact evaluation times out at 40 ms. Results are memoized by expression and dependency fingerprint.

## Adding a function

1. Add `def('name', { min, max, usage, fn })` in `src/engine/builtins.ts` (or `more.ts`) using the arg helpers (`num`, `nums`, `whole`, `prob`, `pos`) and `fail('plain sentence')`.
2. Set `prob: true` on probability functions so Percent display applies.
3. Add tests in `test/`.
4. To expose it on the keypad and in Find (`Ctrl+K`), add a key in `src/ui/keypad.ts` and place it on a tab page in `src/ui/thumbindex.ts`. `test/keypad.test.ts` and `test/thumbindex.test.ts` enforce coverage and bank rules.

## Web app and shared UI

- **Canvas layout (`src/ui/canvas.ts`, `canvaswide.ts`, `cascade.ts`, `src/app/canvas.ts`).** Computes dependency wires (`sheetWires`), places blocks on the wide 2D canvas (`flowLayout` / `wideLayout` with collision settling and saved drag positions), and lays out the single-column Cascade stack on narrow windows (`<= 760 px`) with non-crossing wire lanes (`gutterLanes`). Also defines the first-run welcome example and its isolated mini-graph.
- **Wire tags and Steps (`src/ui/wiretags.ts`, `wireplace.ts`, `unfold.ts`, `src/app/wiretags.ts`, `unfold.ts`).** Shows live values and deltas on wires during slider drags or hover, and breaks a line into intermediate sub-expression steps (`parseSpanned` + `evaluateParts`) when you open Steps.
- **Figure and psychrometric blocks (`src/ui/figures.ts`, `readouts.ts`, `ports.ts`, `psych.ts`, `blockcontrols.ts`, `src/app/figures.ts`, `psych.ts`).** Renders interactive SVG blocks for `unitcircle`, `tangent`, `riemann`, `normalcdf`, 2x2 matrices, histograms/scatter plots, and combined psychrometric charts. Dragging handles rewrites the line or drives its sliders. Named record results expose wire ports (like `A.h`).
- **Composer and rows (`src/app/composer.ts`, `composermirror.ts`, `rows.ts`, `rowviews.ts`, `sheet.ts`).** One `doc` holds lines and settings. Line views are created once and updated in place so typing never drops focus; the composer mirrors typed text as typeset math (`src/ui/composerline.ts`).
- **Graph (`src/app/graph.ts`).** Samples curves per pixel, uses marching squares for implicit curves, uses coarser cells while panning/zooming (sharpening 150 ms after rest), and caches markers per view.
- **Motion and notifications (`src/ui/presence.ts`, `feedback.ts`, `src/app/motion.ts`).** Shared presence state machines and notification lifetimes across platforms. Web keys expose `data-key` and `data-action` attributes for styling independently of accessibility labels.
- **Keyboard and scripting.** Each UI region is one Tab stop with roving arrow-key navigation; Esc returns to the composer. `window.slopculator` exposes the same operations to scripts.

### Performance

Re-evaluating the whole sheet stays around 60 µs for the 25-line benchmark (`test/perf.bench.ts`) because unchanged work is cached:

- `parse` and `lineWarnings` memoize by line text (`engine/memo.ts`); immutable ASTs cache fingerprints in `WeakMap`s.
- Graph items reuse previous compiled functions and sampled curves when their dependency fingerprint hasn't changed (`sameGraphItem`).
- During graph sampling, `fail()` throws a shared quiet error to avoid allocating stack traces on undefined regions like `ln(x)` for `x <= 0`.
- Expressions touching `ans` skip cross-line caching since `ans` depends on line position (`test/reuse.test.ts`).

To benchmark locally:

```sh
npx vite build --ssr test/perf.bench.ts --outDir node_modules/.perf --logLevel error && node node_modules/.perf/perf.bench.js
```

## Stack and checks

Vanilla TypeScript, Vite 8 (single-file bundle), [tsc-rs](https://github.com/pingdotgg/ts-rust), and vitest.

```sh
npm test            # unit tests
npm run verify      # lint, typecheck, test, build, Chrome e2e
```
