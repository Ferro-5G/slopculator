# Changelog

Notable changes, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.5-alpha] - 2026-11-22

- The graph block now has a full-width top drag bar and an `Auto` button to send it back to automatic layout. Small clicks no longer pin a block by accident, dragging follows the pointer 1:1 and snaps on drop, `Reset layout` in the top bar resets every moved block, and `Reset position` in a line's menu resets one block.
- The desktop left dock keeps a fixed width, hides unsent drafts from the sheet list, supports right-clicking list rows, and scrolls to a block when you click it.
- On phones, tapping a block selects it in place, highlights its wires, and opens `Edit`, `Copy`, `Hide` or `Show`, `Delete`, and `⋯` above the input instead of jumping straight into edit mode. Scrolling over a block cancels the tap. Tapping `Edit` or tapping the block a second time opens it in the input while keeping an `Editing` pin in its slot with wires still attached.
- Fixed an 8 px wire and graph alignment shift, moved key hints above the input bar so they never sit behind it, lifted autocomplete and toasts clear of the deck bar and action pills, clamped long live answers clear of `ENTER`, kept `Fit all` visible on narrower desktop windows, stopped right-clicking a block from opening edit mode, and moved y-axis tick labels clear of crossing markers.
- Fixed the Retro look's duplicate header name and dark `123` pill, and tightened copy across the landing page, examples, privacy policy, and docs.

## [0.2.4-alpha] - 2026-11-22

- Turning Aurora Glow off now leaves a plain dot-grid and static composer border; turning it on restores the tab-colored canvas glow, rim, and Enter light.
- Dragging blocks, graphs, or psychrometric charts keeps the canvas camera steady; clearing lines over a pinned graph hides empty-canvas starters; the graph shows a top drag handle; and editing a block puts Cancel in its own pill with a dashed `Editing` placeholder.
- Cleaner wire routing from blocks below a target, line-letter badges on value and slider blocks, click-to-insert on output/readout ports, click-to-pin on wires, and hover highlights for connected blocks and wires.
- Steps fixes: parser spans on chained postfixes and bare calls (`3!!`, `5!%`, `sin 2a`), Exact fractions and rounding in step answers, subscripted logs, lazy conditional branches (`piece`, `if`), multi-wire port spreading, Tab focus, and click/tap-to-copy on web and mobile.
- Replaced the 14 UI sound clips with shorter damped taps, detents, chimes, and double-knock errors across web and mobile.
- Updated repository docs, landing page copy, phone screenshot, and privacy policy.

## [0.2.3-alpha] - 2026-11-21

- Desktop sidebar layout: sent lines stack above the composer on the left, keypad underneath, canvas beside them.
- Desktop Modern look refresh: floating top bar, updated empty-state mark, rounded keycaps, and unclipped 4-row function deck.
- Pressing Escape now closes File, Modes, and Appearance popovers and returns focus. Fixed toast overlap, shading redraws, and graph sizing during point drags.
- Shorter landing page at `slopculator.com`.

## [0.2.2-alpha] - 2026-11-21

- Keyboard Glow, on its own switch beside Aurora Glow in Appearance: keys softly take on the open tab's color, and the canvas's atmosphere continues behind the keypad.
- Switching to the system keyboard (`ABC`) keeps the deck bar in place at the same height, with `ABC` beside `123` and `AC`, instead of swapping in a separate row above the composer.
- Desktop polish: tab labels stay visible while the active pill slides across them, hiding the keypad re-centers the composer and any open toast, the composer's glow is even on dark and light themes, the sheet title keeps a clean divider beside the logo, and Retro shows its wordmark and graph toolbar icons again.
- Appearance controls (`Mode` and `Number pad` Left | Right) read clearly in dark and light, `Help` and `History` match the frosted dialogs with a close button on `Help`, and the landing page shows the canvas screenshots.

## [0.2.1-alpha] - 2026-11-21

- Function tabs open in place: Math, Stats, Chance, Matrix and HVAC swap the keypad for that tab's keys, with a 123 pill to come back, the tab's pages along the top, and its builder first. The canvas stays in view the whole time.
- Builders for what's awkward to type: a guided builder for calculus, the normal curve, data lists, probability and HVAC, each with a live preview of the line and its answer, and better Shape and Vector builders. Matrices go through the Matrix builder (with 2 × 2, 3 × 3 and 4 × 4 sizes, Identity and Clear), including from a `Build matrix…` chip inside `det()`, `inv()`, `rref()` and the other matrix functions.
- A new look: deeper dark and warmer light colors, frosted blocks and composer, Deg and Rad on one sliding switch, and lines that fade out under the top bar and the composer instead of stopping at a hard edge. A sent line glides from the composer into its block.
- Aurora Glow, in Appearance: the canvas and the composer take the open tab's color. The light runs the whole way round the composer, so both ends of it match.
- Pride colors on Modern are now light rather than paint: the flag in neon glows round the canvas's edges and the composer, Enter wears it, and a stripe of it runs under the tabs. The keys keep their theme's colors, and the logo stays the logo.
- History has its own button beside File. File no longer holds Clear all (AC and Ctrl+Alt+Backspace clear every line, and Undo brings them back), and the first run's example is back under Examples as **Welcome example**.
- On a 390 px phone screen all five tabs fit beside 123 and AC. Below 390 px, Find becomes a magnifier so the top bar fits.
- The canvas no longer zooms out on its own when you click something outside it, a slider sits beside the curve it drives instead of across the canvas, a value block drags by its answer without copying it, and the top bar's controls are one height.

## [0.2.0-alpha] - 2026-11-18

- Deg and Rad keep one size when you switch between them.
- A dot reads a row of a table of results, as `P.x` reads a point: `A.h` and `A.Tdp` of a moist-air state from `psych`, `stats(L).s`, `quartiles(L).Q1`, `linreg(xs, ys).r2` and `coil(…).tons`.
- Figure blocks: a line that is `unit circle(θ)`, `tangent(f, p)`, `riemann(g, a, b, n)`, `normalcdf(a, b, μ, σ)` or a 2×2 matrix draws its own picture in its block, with points you can drag (the circle's point, the tangent point, the bounds, the basis vectors) that rewrite the line or move the slider it reads. △ and = switch a block between the figure and its numbers. New functions `tangent(f, p)` and `riemann(f, a, b, n)` (with `"left"`, `"right"` or `"mid"`), and `unit circle(θ)` reads as `unitcircle(θ)`.
- The composer sets what you type as math as you type it (12*7 reads 12 × 7, names in italic), stays one row, and shows the answer, a curve's sparkline or an error on the right.
- Values on wires: while a slider is held, each wire shows the value it carries and how far it moved, lit where the change reaches; point at a wire to see its full value. **Steps** on a line opens its working, each part with its own value, and shows where a failing line goes wrong.
- A `/` reads what follows it the way Desmos does: a product written without a sign stays under the fraction, so `1/2x` is 1/(2x), `6/2(1+2)` is 1 and `(-b + √d)/2a` is over 2a. A written `*` ends it: `1/2*x` is x/2 and `4/3*πr^3` is a sphere's volume. Lines saved before may give a different answer; the **Check this** note on them offers the other reading.
- A new layout: the canvas and the composer. Each line is a block on a canvas you can pan and zoom, wired to the lines it uses, with the graph as one block you can move and resize; on a phone the canvas stays a canvas: each block is only as wide as its line, a line that uses another steps to its right, and the wires drop straight down the open space beside them, so they rarely cross. The composer at the foot is where every line is typed: it shows the answer as you type, lights up when the line works out, and holds the function tabs, AC and enter. Click a block to edit it there; typing a name that's already defined offers to update it. Dragging a slider sends a pulse down its wires. A first run starts with an example you can edit or clear, and the app is dark unless you choose otherwise.
- On desktop, opening a function page (Math, Stats, Chance, Matrix, HVAC) over a short notebook no longer gives the notebook a scrollbar. The line being typed still moves up above the page when the page would cover it.
- Regression: `y1 ~ m x1 + b` on a line fits `m` and `b` to the data, shows them with R², draws the fit and defines them for other lines. Any model works (`y1 ~ a x1^2 + b x1 + c`, `y1 ~ a b^x1`), and `y ~ mx + b` reads a table's `x` and `y` columns.
- Lines copied out of Desmos work as they are, LaTeX and all: `\frac{1}{2}`, `\sqrt[3]{8}`, `\left(1+2\right)\cdot3`, `x_{1}`, `\sum_{n=1}^{10}n`.
- Desmos lists: ranges `[1...10]` and `[1, 3, ..., 9]`, items `L[2]`, `[n^2 for n = [1...5]]`, `x^2 with x = 3`, and `+ 1` or `^2` on every number of a `[ ]` list. `P.x` reads a point, and `normaldist(0, 1).cdf(1)` a distribution.
- Calculus in notation: `f'(2)`, `d/dx x^3`, `sum_{n=1}^{10} n^2`, `int_0^3 t^2 dt`, and `∑ ∏ ∫`. They are drawn that way too.
- A TI's keys: `5 → A`, `3ᴇ5`, `⁻5`, `³√8`, `[[1, 2][3, 4]]`, `nDeriv`, `fnInt`, `iPart`, `fPart`, `randInt`, `randNorm`, `randBin` and more.
- Now 296 functions, 38 of them new, under the names other calculators and code use: `pow`, `hypot`, `sind`, `asinh`, `clamp`, `if`, `random`, `quantile`, `spearman`, and others. `≠`, `!=`, `and`, `or`, `½`, `0x1F` and `a := 5` are read.
- A function or constant typed in another case (`Sqrt(16)`, `PI`, `Ans`) is read as itself, where it used to be an error with a hint.
- Fixed 22 wrong answers and failures an engine audit found. Among them: `(ab)^2` squares the whole product, `1 or 0 and 0` is 1, `ln(0.1 + 0.2 - 0.3)` fails as `ln(0)` does, `tand(90)` is undefined, `normaldist(0, 1).cdf(8, 9)` and `binomdist(…).inversecdf` give the right tails, `0x20000000000001` keeps its last digit, `quadreg` fits years, `inv` and `eigen` handle entries far apart in size, `10 m^2 to ft^2` converts, a regression fits 200,000 points, and `gcd({})`, `acsc(0.5)` and `asec(0.5)` explain themselves plainly.
- New sounds. The key clicks, the switch, the copy and error sounds and the chime are now short recordings of real taps, wood and glass, in place of the synthesized ones. They are the same on the web and on phones.

## [0.1.2-alpha] - 2026-11-16

- slopculator.com's landing page is shorter: the name, a screenshot, and three short columns in place of six sections.

## [0.1.1-alpha] - 2026-11-15

- On slopculator.com, the logo in the app's header goes back to the home page. Before, clicking the word Slopculator beside it opened Save.
- The privacy policy mentions the error reports a browser may send Cloudflare when it can't reach the site.

## [0.1.0-alpha] - 2026-11-15

The first public version.

### Calculator

- Lines that share: `a = 3` gets a slider, `f(x) = x^2` can be called and is graphed, `ans` is the line above, and line letters (`A`, `B`, …) refer to earlier answers.
- Exact answers: `0.1 + 0.2` is 3/10, `sin(30°)` is 1/2, whole numbers keep every digit (`2^64`, `25!`), and roots, logs and trig show only digits that are proven.
- Math typed the way it's written: `2x`, `3(4 + 5)`, `sin 30`, `√16`, `|x|`, `5!`, `x²`. Missing closing brackets are filled in, and a line that may not mean what you intended (`-3^2`, `1/2x`) gets a one-click rewrite.
- Functions, 258 of them: statistics and regressions; normal, binomial, t, χ², F, Poisson and geometric distributions; matrices and vectors; derivatives, integrals, sums and `solve`; number theory, geometry, finance, unit and base conversion; and moist-air, refrigerant, duct and fan functions for HVAC.
- Search any function by name or meaning (Ctrl+K, ⌘K on a Mac). History keeps every finished line and its full-precision answer.
- A matrix answer bigger than 20 × 20 shows its top-left corner and says how big the whole matrix is. Copying it still gets every entry.

### Graph

- `y = …`, `x = …`, implicit curves, inequalities, points, polygons, vectors, piecewise and domain restrictions, with zeros, extrema and intersections marked.
- A shaded normal curve with its probability, sliders under the graph, Fit and 1:1, and export as PNG or SVG.

### Platforms

- Web: one HTML file that works offline, on a computer or a phone. Added to a phone's home screen, it opens full screen. A hosted build is a small website: a landing page, the app at `/app`, the privacy policy, and security headers built to match (see [docs/hosting.md](docs/hosting.md)), and a link ending in `#q=…` adds lines to the open sheet.
- Privacy: nothing is collected. Sheets stay in the browser and the page makes no network requests. The policy is under File > Privacy and in [PRIVACY.md](PRIVACY.md).
- Two looks: Modern (Light, Dark, OLED black, High contrast, six accent colors) and Retro (printer paper and sculpted keycaps).
- Motion can be Full, Reduced or Off, and anything that animates can be interrupted or reversed partway.
<!-- private -->
- Windows: the same page in a Tauri app, built from source with `npm run app:build`. This release doesn't include it.
<!-- /private -->

### Known gaps

- Results below 1e-14 round to 0.
- `integral` can miss a spike much narrower than a hundredth of its range, such as a normal curve with σ = 0.001 integrated from 0 to 1. Put the bounds close around the spike. The t, χ², F and Poisson functions lose accuracy at df or λ around 1e12 and above.
- A line that takes more than 2 seconds, or a sheet that takes more than 6 in all, stops with an error instead of freezing the page.
<!-- private -->
- The Windows app isn't in this release. A build from source isn't code-signed, so SmartScreen warns before its installer runs.
<!-- /private -->
- iOS and Android apps are in development and not part of this release.

[Unreleased]: https://github.com/Ferro-5G/slopculator/compare/v0.2.4-alpha...HEAD
[0.2.4-alpha]: https://github.com/Ferro-5G/slopculator/compare/v0.2.3-alpha...v0.2.4-alpha
[0.2.3-alpha]: https://github.com/Ferro-5G/slopculator/compare/v0.2.2-alpha...v0.2.3-alpha
[0.2.2-alpha]: https://github.com/Ferro-5G/slopculator/compare/v0.2.1-alpha...v0.2.2-alpha
[0.2.1-alpha]: https://github.com/Ferro-5G/slopculator/compare/v0.2.0-alpha...v0.2.1-alpha
[0.2.0-alpha]: https://github.com/Ferro-5G/slopculator/compare/v0.1.2-alpha...v0.2.0-alpha
[0.1.2-alpha]: https://github.com/Ferro-5G/slopculator/compare/v0.1.1-alpha...v0.1.2-alpha
[0.1.1-alpha]: https://github.com/Ferro-5G/slopculator/compare/v0.1.0-alpha...v0.1.1-alpha
[0.1.0-alpha]: https://github.com/Ferro-5G/slopculator/releases/tag/v0.1.0-alpha
