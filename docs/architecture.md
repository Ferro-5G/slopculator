# How Slopculator is put together

One engine, several front ends. The engine is plain TypeScript with no dependencies and no DOM, so the same code computes every answer wherever it runs. A phone app shares it too; it isn't in this repository yet, which is why `src/ui` holds logic no web page needs.

```
src/engine/        the math: lexer → parser → compiled closures → values, plus exact results (real, exact, precise)
src/ui/            what every front end shares, with no DOM: keypad data, typesetting, search, plot math, palettes, SVG plots
src/ui/keypad.ts   keypad layout (pure data)
src/ui/sounds.ts   the UI sounds' cues and variants (the recordings are in src/assets/sounds)
src/app/           the web app's UI (no framework)
src/app/canvas.ts  the canvas: blocks, wires, pan and zoom, the phone's column
src/app/composer.ts the composer: the line being typed, enter, editing a block
src/app/graph.ts   canvas graph for the web app
src/app/sound.ts   plays the sound recipes with Web Audio
src/main.ts        loads the fonts and styles and starts src/app
test/              vitest unit tests; npm run e2e drives the built app in Chrome
```

## The engine

1. **`lexer.ts`** turns text into tokens. A line that holds a backslash first goes through **`latex.ts`**, which rewrites LaTeX (`\frac{1}{2}`, `\left(`, `x_{1}`) as plain text. It normalizes `×`, `÷`, `−`, `≤`, superscripts (`x²` → `x^2`), and names (`mu` → `μ`, `pi` → `π`).
2. **`parser.ts`** is a Pratt parser. It handles implicit multiplication (`2x`, `a(b + c)`), postfix `!`, `%`, and `°`, `|x|`, `log_b(x)`, `sin^2(x)`, points `(a, b)`, lists `{…}`, matrices `[[…]]`, vectors `⟨…⟩`, piecewise `{x < 0: -x, x}`, and chained relations.
3. **`evaluator.ts`** compiles the syntax tree to JavaScript closures once. Graphs call those closures hundreds of times per frame, so evaluation never walks the tree again. It also resolves names: locals, then sheet variables, then constants, then built-ins, then letter splitting (`nt` → n·t when both exist). Unknown names get a "Did you mean" hint.
4. **`builtins.ts`** and **`more.ts`** hold the functions, and **`compat.ts`** the names and forms other calculators use (`total`, `nDeriv`, `L[2]`, `[1...10]`, `normaldist(0, 1).cdf(1)`). Each entry gives its argument count, a function or a lazy compiler (for things like `sum`, `solve`, `integral` that bind a variable), and a usage string.
5. **`values.ts`** defines the value types (number, complex, list, point, vector, matrix, distributions, polygon, record, text) and the arithmetic that broadcasts over them.
6. **`numeric.ts`** has the special functions: erf/erfc by series and continued fraction, inverse normal (Acklam plus Halley steps), incomplete gamma and beta, binomial terms in log space.
7. **`document.ts`** evaluates a whole sheet. A regression line (`y1 ~ m x1 + b`) is planned by **`regress.ts`**, which finds its unknowns and data, and solved by **`fit.ts`** (least squares: QR when the model is linear in its unknowns, Levenberg–Marquardt otherwise). It registers definitions in any order (variables, functions, table columns, line letters), evaluates each line lazily with cycle detection, and classifies lines as values, sliders, graphs (`y = …`, `x = …`, implicit curves, inequalities), distributions, or tables.
8. **`hvac.ts`** holds moist-air, load, duct, and refrigerant functions, and `refrigerants-data.ts` holds the refrigerant tables. `scripts/build-hvac-data.py` generates that file and `test/hvac-vectors.json` from CoolProp and PsychroLib, so the tests compare against those libraries at points off the table grid.
9. **`format.ts`** prints values: 12 significant digits, exact forms (`3/8`, `√3/2`, `π/6`), percent, and plain ASCII for copying. Every formatter takes an optional exact value and prints from it when given.

### Exact results

Graphs and every built-in run on doubles. A displayed result also gets an exact value when exact math covers the line:

1. **`real.ts`** is ball arithmetic on BigInt: a midpoint m·2^e and a radius r·2^e that provably contain the true value. It has + − × ÷, √, integer powers, and exp, ln, sin, cos, atan, π and ln 2 in fixed point with counted error bounds.
2. **`exact.ts`** holds an exact number as a rational (BigInt n/d), a rational multiple of π, or a ball. Arithmetic stays rational or π-rational while it can, so `0.1 + 0.2` is 3/10 and `sin(30°)` is 1/2. It also rounds to the nearest double and to decimal digits, giving only digits the ball proves.
3. **`precise.ts`** walks the same syntax tree as `compile()`, resolving names the same way through `resolveId`, `resolveCall`, and `rewritePower` from `resolve.ts`. It covers literals, + − × ÷ ^, `!`, `%`, `°`, roots, exp and logs, trig and hyperbolic functions, `nCr`, `nPr`, `mod`, `gcd`, `lcm`, rounding, `sum`/`prod`, `mean`, `min`, `max`, `det`, `inv`, `transpose`, user functions, and lists, points, vectors, and matrices of these. Anything else gives up (null), and the line keeps its double. A result with balls that are too wide is recomputed at 128, 320, 800, then 2000 bits.
4. **`document.ts`** runs it only after the float path succeeds (or reports a factorial or nCr "too large"), checks that the shapes match, then puts the exact value on `RowResult.precise` and replaces `value` with its nearest double, so graphs and other lines use the corrected number. Variables get the same treatment through `Env.improve`.

Limits keep a keystroke fast: rationals past 65,472 bits (Hermes, the phone app's JavaScript engine, throws at 65,536), loops past 20,000 terms, and expressions past 40 ms give up. Results are memoized by the expression and every definition it reaches, so unchanged lines cost a lookup when a slider moves. `RowResult.precise` holds bigints, so it is not JSON.

## Adding a function

1. Add a `def('name', { min, max, usage, fn })` to `builtins.ts` (or `more.ts`). Use the helpers `num`, `nums`, `mapNum`, `whole`, `prob`, and `pos` for argument checking, and `fail('plain sentence')` for errors.
2. If it returns a probability, set `prob: true` on its `def` so the % display applies.
3. Add tests next to similar ones in `test/`. Check against a known closed form to 10+ digits where that makes sense.
4. To put it on the keypad, add `fn('name', 'what it does', 'short sub-label')` to a bank in `src/ui/keypad.ts`, then give that key a tile on a page in `src/ui/thumbindex.ts`, which is how it appears on every platform's keys. `test/thumbindex.test.ts` fails until the key has a home, and `test/keypad.test.ts` enforces the bank rules: at least five keys a bank, no key repeated, every function key explained.

Lines on every platform can use it as soon as it's defined. Step 4 is what puts it in the command palette and Find.

## The web app

The screen is a canvas and a composer. `src/ui/canvas.ts` decides, for every front end, which lines feed which (`sheetWires`), where blocks go on a wide canvas (`flowLayout`: sliders and the lines that draw in a column on the left, the graph in the middle, values on the right, dragged blocks kept where they were put), how wires route round blocks (`routeWire`), how blocks that collide move apart (`settleBlocks`, with the example's frame as one block), the order of a phone's column and the lanes its wires take, what the composer's enter does (`composerIntent`), and the first run's example, which draws on a small graph of its own (`EXAMPLE_GRAPH`) and never on the sheet's. `src/ui/canvaswide.ts` puts those parts together for a wide canvas the one way every front end uses: when a window is wide (`NARROW_QUERY`, which the stylesheets' `(--phone)` reads too), where every block and open tray goes (`wideLayout`, which keeps blocks still while the pointer holds something, and lays a sheet that won't fit at 100% out again in taller columns, keeping whichever the home view shows largest), the home view, each wire's route and drag snapping. `src/ui/cascade.ts` is the phone's column, Cascade: each block a pill as wide as its line (`cascadeColumn`; graphs, figures, charts and tables span), stepped right by how deep it sits among the blocks above it that it reads (`cascadeDepths`), room above a block a tagged wire feeds (`cascadeGaps`), and each wire's route (`cascadeWires`): straight down through an open lane beside the blocks it passes, else down the open canvas on the right (a slider is at most `sliderMax` of the column, so there is some) or left of stepped blocks and into its target from above, the sides chosen so wires whose spans interleave keep apart, and the left margin only as the last resort. While a slider is held, `cascadeTagSpots` puts each tag on its wire in open canvas, `heldLit` lights what the slider reaches and `heldTraces` names the curves the graph traces where they started. `CASCADE_RADIUS` is the one corner radius blocks, the graph and the composer share; a wide canvas steps a dependent right in its column the same way (`flowLayout`'s `step`). `src/ui/wiretags.ts` decides what each wire's tag shows (the value it carries at 4 significant figures, a list as its range and a sparkline) and what a slider drag does to the tags: the wires it reaches, each value's change since the drag began, and how long that stays after release. Tags show only during a drag and on the wire pointed at. `src/ui/wireplace.ts` places them on a wide canvas: a tag on the run into its block, and where wires into an open line's steps start and end. `src/ui/unfold.ts` builds a line's steps (Unfold): the parts of its tree with values of their own, from `parseSpanned` (a fresh tree that knows where each part was typed), each worked out by the engine where the line sits (`evaluateParts` in `document.ts`), with where the line first goes wrong and which steps read each name. A line's own top operation is the line, so it is never a step. `src/app/canvas.ts` draws that: each row's view is a block, positioned on a world that pans and zooms on a wide window (`row.at`, and the graph block's `doc.ui.graphBlock`) or stacked in the sheet's order on a narrow one, as Cascade lays the column out, with the wires in one SVG layer. `src/app/wiretags.ts` draws the wires' tags (in a layer over the blocks: on the run into a block on a wide canvas, on its wire in open canvas in a narrow column) and `src/app/unfold.ts` the Steps button and each open line's tray; the canvas reserves a tray's room under its line through `flowLayout`'s `below`. `src/ui/figures.ts` decides figure blocks: which lines draw a picture of their own (`unit circle(θ)`, `tangent(f, p)`, `riemann(f, a, b, n)`, `normalcdf(a, b, μ, σ)`, a 2×2 matrix), their math (worked out by the engine where the line sits, through `evaluateFigureParts`), each picture as marks in draw order, and what a handle's drag or an arrow key writes back (the line's own numbers or a slider it reads). Stats blocks are figures too: a list of four or more numbers draws a histogram (`histogramBins`: Freedman–Diaconis, never coarser than Sturges, on round edges) with a box plot, its mean and ±s, and paired data (a fit `y1 ~ m x1 + b`, `linreg(xs, ys)` or a list of points) draws a scatter with its fit; the lists a fit reads (`pairedRows`) stay plain values and flow above it. `src/ui/readouts.ts` lists the named results such a block shows beside its figure, and `src/ui/ports.ts` gives each result a port: a line that reads one result (`A.h`, `mean(data)`, a fit's `m`) is wired from that port (`Wire.fromPort`), routes out of the block's right edge at the port's height (`routeWire`'s `outY`), and its tag carries that one number (`portValue`). `src/ui/psych.ts` is the psychrometric chart: a sheet's named moist-air states (`A = psych(…)`) sit in one chart block, the way curves share the graph, in the states' own units (°C with g/kg, or °F with grains); the layout flows the block where its first state goes and routes the states' wires as the block (`hosts`). It draws with the engine's moist-air equations (`moistAir` in `hvac.ts`) and turns a state's drag into its line or sliders (`dragPsych`). `src/app/psych.ts` draws it, with each state's own view moved into the block beside the chart. `src/ui/blockcontrols.ts` is the one model for a block's corner controls (the figure/numbers switch, Steps, Riemann's rule), and `src/app/figures.ts` draws the marks as SVG. `src/app/composermirror.ts` draws the composer's line as math over its field, from `src/ui/composerline.ts` (which also decides the composer's state, its edge light and what shows on its right). `src/app/composer.ts` holds the view of the line being typed: the draft (always the sheet's last row) or a block loaded to edit. Every line editor works there unchanged, because it's the same view, moved; `rebuildRows` puts the composer's line in the composer and the rest on the canvas, and a focus guard in `focusRow` loads a line into the composer before it takes focus.

`src/app/sheet.ts` keeps one `doc` (lines and settings) and re-evaluates the whole sheet on each change, which takes about 60 µs for the 25-line sheet in `test/perf.bench.ts`. Line views (`src/app/rows.ts`, `src/app/rowviews.ts`) are created once and updated in place so typing never loses focus. The graph (`src/app/graph.ts`) samples curves per pixel, uses marching squares for implicit curves, and caches markers per view.

### What keeps a keystroke cheap

Re-evaluating everything stays simple because the work that doesn't change is cached by what it was built from:

- **Text → tokens, tree, warnings.** `parse` and `lineWarnings` are memoized by the line's text (`engine/memo.ts`, a two-generation cache), so only the edited line is tokenized and parsed. Trees are never mutated after parsing, so the exact layer caches their fingerprints and name lists per tree in `WeakMap`s.
- **Graph functions.** `document.ts` keys each graph line by its tree, every definition it reaches (the same fingerprint the exact memo uses), and the settings, and hands back the previous function object when that key repeats. `graph.update()` sees the same items (`sameGraphItem`), keep the drawn scene, and skip markers; a changed curve is the only one re-sampled.
- **Sampling.** The graph keeps sampled runs, contour segments, and shaded spans per function until the view or size changes. While the view moves (drag, wheel, glide), contours and fills use cells twice as wide and the scene is drawn straight onto the canvas; 150 ms after it rests they are redrawn sharp. Zeros, extrema, and intersections are recomputed once the view rests; until then the old ones (in graph units) stay put.
- **Closures.** Compiled code reads a variable once per sheet evaluation, calls one-number built-ins without an argument array (`Builtin.fast1`), and does number arithmetic inline. Inside graph sampling `fail()` throws one shared error (`quiet` in `errors.ts`), because building messages and stack traces cost more than the math for curves like `ln(x)` that fail on half the screen. `Env.getVar` turns that off while it computes, since its message is kept.
- **Never `ans`.** What `ans` means depends on how far the sheet has been evaluated, not only on text. A fingerprint that reaches it (directly, through a variable, or through letter splitting like `tan` → t·a·n while `ans` is mid-computation) is null, so neither the graph cache nor the exact memo keeps it. `test/reuse.test.ts` holds the cases.
- **Loading.** `vite.config.ts` drops the `.woff` font fallbacks, which no supported browser loads, and the first two forced layouts run on the next animation frame.

Ctrl+Alt+1…5 opens the composer's five tabs; Ctrl+Alt+0 fits every block in view, and Ctrl+Alt+= and Ctrl+Alt+− zoom the canvas.

Keyboard design: each area is one Tab stop with arrow keys inside (`roving()`), and Esc returns to the line. `window.slopculator` exposes the same operations to scripts and agents.

Motion uses independent presence, scroll and graph machines. Shared presence transitions live in `src/ui/presence.ts`; the browser adapter lives in `src/app/motion.ts`.

### UI conventions

- `src/ui/feedback.ts` owns notification lifetimes for every front end.
- Web keys expose `data-key` for their glyph identity and `data-action` for their action. Style these attributes; accessibility labels can change without changing appearance.

## Stack

TypeScript with no UI framework. Vite 8 bundles the web app into one file, [tsc-rs](https://github.com/pingdotgg/ts-rust) type-checks it, and vitest runs the tests. The engine has no runtime dependencies.

## Speed

A 25-line sheet recomputes in about 60 µs per keystroke. Expressions compile once to JavaScript closures, so a graph sample costs 30 to 70 ns, and a full-width curve redraws in under 0.1 ms. `npx vite build --ssr test/perf.bench.ts --outDir node_modules/.perf --logLevel error && node node_modules/.perf/perf.bench.js` prints the numbers on your machine.

## Checks

```sh
npm test            # unit tests (engine, keypad rules, guide examples)
npm run verify      # lint, typecheck, tests, build, browser walkthrough
```

CI runs the same list on every pull request. See [docs/releasing.md](releasing.md).
