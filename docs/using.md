# Using Slopculator

Everything below works on desktop and phones except where noted. See [Functions](functions.md) for the full function list and [Guide](guide.md) for worked examples.

## Typing and the canvas

Type an expression in the composer and press Enter.

- On desktop, sent lines stack in the left sidebar and appear as connected blocks on the canvas. Click a line in either place to edit it; hover a sidebar line to highlight its block.
- On phones and narrow windows (`<= 760 px`), blocks stack in a single column with connecting wires in the left gutter.
- `a = 3` defines a variable with a slider. `f(x) = x^2` defines a reusable function and plots it.
- `ans` refers to the line above. With **Line letters** on (Modes), line 1 is `A`, line 2 is `B`, and so on.
- Anything with `x` plots automatically: `y = 2x + 1`, `x = 3`, `x^2 + y^2 = 16`, `y > x^2`.
- Start a line with `#` to add a heading.
- Pasting multiple lines adds them as one undoable step.
- `y1 ~ m x1 + b` fits a regression to lists `x1` and `y1`, plots the curve, and defines `m` and `b`. For a table with `x` and `y` columns, write `y ~ mx + b`.
- Lines copied from Desmos or written in TI syntax mostly work as-is (see [functions.md](functions.md#other-calculator-syntax)).

Write math naturally: `2x`, `3(4 + 5)`, `sin 30`, `√16`, `|x|`, `5!`, and `x²` all parse as written. Brackets auto-close, and selecting text then typing `(` wraps it.

## Typing hints and inline fixes

- Typing a function name shows completions; press Tab to accept.
- Inside a call, the strip below shows parameter slots. Press Tab to step to the next slot.
- Incomplete lines like `2*` or `normalcdf(` show a grey "Unfinished" note instead of a red error until you leave the line.
- Starting a line with `*`, `/`, or `^` offers to continue from `ans` (press Enter to accept).
- When a line has a typo or ambiguity, click the suggested fix (or press Tab then Enter; Ctrl+Enter applies a single fix):

| You type | What happens |
| --- | --- |
| `normcdf(1)` | Suggests `normalcdf` (only close spellings match) |
| `-3^2` or `1/2x` | Keeps the answer with a **Check this** toggle for the alternate grouping (`1/2x` parses as `1/(2x)` like Desmos; write `1/2*x` for `(1/2)x`) |
| `2 3` | Evaluates as `2 × 3` and offers `2 * 3` or `23` (`1 000 000` reads as a million) |
| `tax * 2` | Tells you `tax` is undefined and shows how to define it |
| `1,250` | Offers `1250` |
| `5 mi to km` | Evaluates as `convert(5, "mi", "km")` (`72 F to C` and `5 mi in km` work too) |
| `5 ft + 3 in` | Offers `5 + convert(3, "in", "ft")` |
| `3 m + 2 s` | Reports that length and time cannot be added |
| `percentile(0.95)` | Offers `invNorm(0.95)` for a normal percentile (`percentile(list, p)` is for lists) |

## Percents

`80 + 15%` is `92` (adds 15% of 80) and `80 − 15%` is `68`. Chains run left to right (`80 + 15% + 10% = 101.2`). Multiplication and division treat `%` as `/ 100` (`80 × 15% = 12`).

To make `%` always mean `/ 100` (`80 + 15% = 80.15`), set **Adding a percent** to **As a number** in Modes. Each sheet saves its own choice.

## Answers

- Click any answer to copy it as plain text.
- **Answers** (in Modes) switches between **Decimal** and **Exact** (`3/8`, `√3/2`, `π/6`).
- **Round** sets decimal places for display and copying (Auto through 15).
- **Percent probabilities** displays probabilities as percentages.
- Huge numbers display in scientific notation by default; switch **Huge answers** to **Every digit** in Modes to scroll every digit. Copying always includes every digit.

## Sheets, undo, and history

Work saves automatically in your browser. Once you name a sheet (**File -> Save**), edits save straight into it. **File** also handles New, Open, Duplicate, Rename, Copy sheet as text, Export/Import JSON, and Graph PNG/SVG export (plus Share as text on touch devices).

- **Undo / Redo** (`Ctrl+Z` / `Ctrl+Shift+Z`) covers typing, moves, deletes, fixes, slider drags, clears, and sheet switches. Clearing a sheet also shows a 10-second Undo button.
- **History** (`Ctrl+Alt+Y`) keeps every finished calculation with full precision across clears and reloads.

## Find and the keypad

Press `Ctrl+K` (`⌘K` on Mac) or click **Find** to search functions by name or what they do (like "percentile", "area between", or "miles to km"), run commands, or insert examples. Picking a function highlights the keypad tab where it lives.

The keypad sits below the composer with **123** and five category tabs: **Math**, **Stats**, **Chance**, **Matrix**, and **HVAC**.

- Clicking a tab swaps the number pad for that category's tiles and builders without covering the canvas. Click **123**, the active tab, a tile, or press Esc to return.
- On desktop, hovering a key or tile shows a short hint above the keypad.
- Matrix tiles (`2 × 2`, `3 × 3`) insert empty cells; press comma or Enter to advance. Larger matrices, shapes, vectors, calculus, distributions, and HVAC tools also have builders at the top of their tabs.
- Hold `←` or `→` to repeat caret movement; hold `⌫` to clear the line. **AC** clears the sheet.
- Click **Keypad** in the desktop top bar to hide or show the keypad.

## Graphing

Any plotted expression creates a graph block on the canvas. On desktop, drag its top bar to move it and its bottom-right corner to resize it.

- Drag to pan, scroll to zoom, Shift+drag to box-zoom, and hover to trace.
- Zeros, extrema, y-intercepts, and intersections show dots; hover to snap and click to pin coordinates.
- Dragging a slider updates wired curves and blocks live, showing values along the wires. Whole-number sliders step by 1 from 0 to twice their value.
- Graph toolbar buttons zoom, Fit, square axes (`1:1`), reset Home, and export PNG.
- Keyboard controls when the graph has focus: arrows pan, `+`/`−` zoom, `F` fits, `S` squares axes, `0` resets, `P` saves PNG, `C` copies PNG, `[` and `]` step through marked points, Enter pins, Delete clears pins.

## Phone and narrow windows

Below `760 px`, the layout switches to a single column above the docked composer and keypad.

- The deck bar adds **ABC** (to toggle the phone keyboard) and **AC**.
- The top bar holds **Deg | Rad**, **Modes** (which includes Appearance), **Find**, **File**, and **History**.
- Long-press a block for its menu, including **Reorder lines** (adds `↑`/`↓` buttons until you tap **Done**).
- Add the page to your phone's home screen to open it full screen.

## Keyboard shortcuts

Every area is one Tab stop (top bar, line tools, composer, keypad, graph), with arrow keys inside and Esc returning to the composer. On Mac, read `Ctrl` as `⌘` and `Ctrl+Alt` as `Ctrl+Option`.

| Keys | Action |
| --- | --- |
| Enter, ↑ / ↓ | New line, move between lines |
| Alt+↑ / ↓ | Reorder line |
| Alt+Shift+↑ / ↓ | Duplicate line above or below |
| Ctrl+Shift+Backspace | Delete line |
| Ctrl+Alt+Backspace | Clear sheet |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+K (or Ctrl+/) | Find functions, commands, examples |
| Ctrl+Alt+K / G | Jump to keypad / graph (again to return) |
| Ctrl+Alt+Shift+K / G | Show or hide keypad / graph |
| Ctrl+Alt+1...5 | Open keypad tab (Math, Stats, Chance, Matrix, HVAC) |
| Ctrl+Alt+← / → | Switch pages in the open tab |
| Ctrl+Alt+N | Add a normal curve |
| Ctrl+S / Ctrl+Alt+O | Save / open sheet |
| Ctrl+Alt+Shift+N | New sheet |
| Ctrl+Alt+Y | History |
| Ctrl+Alt+D / E / M / P / L | Deg/Rad, Exact, Sample SD, Percent, Line letters |
| Ctrl+Alt+T | Next theme |
| Ctrl+Alt+H | Shortcuts list |

## Looks and accessibility

Open **Appearance** (sliders icon on desktop, or inside Modes on phones) to switch between **Modern** and **Retro**, pick System/Light/Dark, enable Pure black (OLED) or High contrast, choose an accent color, adjust Aurora/Keyboard Glow, or set Motion (Full, Reduced, Off).

There is also a hidden color theme unlocked with the classic code on the number pad arrows followed by B A.

Screen readers announce answers after a typing pause, label every line and graph, respect system Reduce Motion, and pair High contrast errors with symbols.
