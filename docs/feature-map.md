# Feature map

Every user-facing feature in Slopculator, how a user reaches it, and what proves it works. Use this vocabulary when writing tests, bug reports, or verification scripts.

## Sheet and composer

- **Composer** (`.composer .expr`). The active input at the bottom of the sheet. Typing mirrors typeset math above or beside the field (`src/ui/composerline.ts`), and `Enter` commits the line and starts a new one. Proof: `window.slopculator.lines()` includes the expression and its evaluated result.
- **Line editing and math fixes** (`.rows .row`, `button.fix`, `.warn-dot`). Clicking a block re-opens it in the composer. Mistake warnings (`src/engine/diagnostics.ts`) show `!` chips with one-click `Use ...` fixes (`Ctrl+Enter` applies a single fix). Proof: clicking the fix rewrites the line and removes the warning.
- **Steps / Unfold** (`src/app/unfold.ts`, `src/ui/unfold.ts`). Expands a line into intermediate sub-expression values via `parseSpanned` and `evaluateParts`. Proof: opening Steps renders each intermediate expression and its value without changing the line's answer.
- **Tables and regressions** (`File -> Add a table` or `y1 ~ m x1 + b`). Multi-column tables feed regressions (`src/engine/regress.ts`, `src/engine/fit.ts`) and plot points. Proof: table columns evaluate and regression lines report fitted parameters and R^2.

## Canvas, wires, and layout

- **Wide 2D Canvas and narrow Cascade** (`src/app/canvas.ts`, `src/ui/canvas.ts`, `src/ui/canvaswide.ts`, `src/ui/cascade.ts`). Windows wider than 760 px lay blocks out on a 2D canvas with draggable positions and dependency wires; windows `<= 760 px` switch to a single-column Cascade stack with non-crossing gutter wire lanes. Proof: blocks never overlap after settle and wires connect defining lines to dependent lines.
- **Wire tags** (`src/app/wiretags.ts`, `src/ui/wiretags.ts`). Hovering a line or dragging a slider shows live values and deltas along outgoing wires. Proof: `.wire-tag` updates synchronously during a slider drag.
- **First-run welcome example** (`src/app/example.ts`). Fresh profiles open with an isolated example sheet (`slopculator:first-run` suppresses it once seen). Proof: clearing storage and loading shows the welcome frame without overwriting saved sheets.

## Graphing, figures, and sliders

- **2D Graph pane** (`.graph-pane`, `src/app/graph.ts`, `src/app/graphpane.ts`). Appears automatically when a line plots a curve (`y = x`), implicit relation (`x^2 + y^2 = 25`), region (`y > x^2 - 4`), points, vector, or distribution. Supports wheel/pinch zoom, pan, coast, point dragging, `graph.fit()`, `graph.reset()`, PNG/SVG export, and copy image. Proof: `window.slopculator.graph.view()`, `graph.names()`, and `graph.png()`.
- **Sliders** (`a = 2`, `.slider-row input[type=range]`, graph sliders in `.graph-sliders`). Auto-range comes from `wholeAwareRange` (`src/ui/slider.ts`) and stays locked while the slider has focus during a drag. Proof: dragging past the midpoint updates dependent lines and curves without shifting `min` or `max` until release.
- **Interactive SVG figures and psychrometrics** (`src/app/figures.ts`, `src/app/psych.ts`, `src/ui/figures.ts`, `src/ui/psych.ts`). `unitcircle`, `tangent`, `riemann`, `normalcdf`, 2x2 matrices, histograms/scatter plots, and moist-air psychrometric charts render interactive handles and wire ports (`A.h`). Proof: dragging a handle rewrites the source line and updates dependent outputs.

## Keypad, Find, and Modes

- **Keypad and Thumb Index** (`src/app/keypad.ts`, `src/app/thumb.ts`, `src/ui/keypad.ts`, `src/ui/thumbindex.ts`). Categorized function tabs (`data-key`, `data-action`) with keyboard toggle (`Ctrl+Alt+Shift+K`). Proof: pressing a key inserts its template at the caret and `test/keypad.test.ts` + `test/thumbindex.test.ts` pass.
- **Find palette** (`.head-find`, `Ctrl+K`, `dialog.palette`). Searches built-in functions, commands, examples, and combine actions. Proof: typing a query filters results and `Enter` runs or inserts the selected item.
- **Modes sheet and Appearance** (`src/app/settings.ts`, `src/app/theme.ts`, `src/app/motion.ts`). Controls Degrees/Radians, Exact, Complex, Sample/Pop, Percent, Decimal places, Line names, Theme, Look, Motion (`Full` / `Reduced` / `Off`), and Sound. Modal presence transitions expose `data-presence` (`closed | opening | open | closing`) and hold background `inert` until `closed`. Proof: toggling a mode updates `window.slopculator.settings()` and recomputes affected lines.

## Persistence, sharing, and multi-tab safety

- **Saved sheets and History** (`File` menu, `Ctrl+Alt+S`, `Ctrl+Alt+O`, `Ctrl+Alt+Y`, `dialog.history-dialog`). Saves named sheets in `localStorage`, exports/imports `.json`, copies plain text, and stores evaluated history entries. Proof: saving, reloading, and reopening restores exact lines and settings.
- **URL fragment links** (`index.html#q=...`, [docs/page-api.md](page-api.md)). Appends up to 50 lines from `#q=` as one undoable step, then clears the hash so reload never loops. Proof: opening with `#q=2+2` appends `2+2` and strips `#q=` from `location.hash`.
- **Undo/Redo and two-tab sync** (`src/app/edits.ts`, `src/ui/undo.ts`, `src/app/sheet.ts`, `src/app/file.ts`). Typing bursts coalesce into steps, clear/delete/paste/combine are atomic undo steps, and saving in one tab updates other open tabs while closing stale dialogs and clearing stale undo stacks. Proof: `scripts/audit-e2e.mjs` and the `two tabs:` check in `scripts/e2e.mjs`.


## Driving the built web app from the terminal

Build once with `npm run build`, then use `scripts/app-cli.mjs` instead of writing throwaway Playwright snippets:

```sh
node scripts/app-cli.mjs doctor
node scripts/app-cli.mjs eval "sin(30) + 1/2"
node scripts/app-cli.mjs state --seed "a = 2" --seed "y = a x"
node scripts/app-cli.mjs run --type "1/3 + 1/6" --press Enter --shot .shots/check.png
```
