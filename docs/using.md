# Using the app

The web app and the Windows app are the same page, so everything here applies to both. [Functions](functions.md) lists what you can type, and the [guide](guide.md) has worked examples.

## Lines

Type one calculation per line. The answer appears beside it.

- `a = 3` defines a variable and gives it a slider. `f(x) = x^2` defines a function you can call, and the graph draws it.
- `ans` is the answer of the line above. With Line letters on, line 1 is also `A`, line 2 is `B`, and later lines can use them.
- Anything with an `x` is drawn on the graph: `y = 2x + 1`, `x = 3`, `x^2 + y^2 = 16`, `y > x^2`.
- Start a line with `#` to make a heading.
- Pasting several lines makes several lines.

Write math the way you would on paper. `2x`, `3(4 + 5)`, `sin 30`, `√16`, `|x|`, `5!` and `x²` all work. Brackets close themselves, and typing the closing bracket steps over it. Select text and type `(` to wrap it.

## Help while you type

- Type the start of a function name and matches appear. Tab finishes the name.
- Inside a call, the line underneath shows the function's inputs, including for functions you defined. Tab moves to the next input.
- A line you haven't finished, like `2*` or `normalcdf(`, shows a grey "Unfinished" note and no red error. The error shows only if you leave the line that way.
- A line can't start with `×`, `÷` or `^`. Type `*100` and the line offers **Use ans × 100**. Enter takes the offer.

## When a line looks wrong

The app points out lines that are wrong or that may not mean what you intended, and offers a fix you can click. From the keyboard, Tab goes from the line to its fix, and Ctrl+Enter applies it when there is only one.

| You type | What happens |
| --- | --- |
| `normcdf(1)` | "Did you mean normalcdf?" with a one-click fix. Only close spellings are suggested, so `mi` never becomes `min`. |
| `-3^2` or `1/2x` | The answer stands, with a **Check this** note and a rewrite that says which reading you get. |
| `2 3` | Read as 2 × 3, with both readings offered: **Use 2 * 3** or **Use 23**. `1 000 000` is a million. |
| `tax * 2` | "tax isn't defined. Define it on its own line, like tax = 5". |
| `1,250` | Read as two numbers, with **Use 1250** offered. |
| `5 mi to km` | Worked out as `convert(5, "mi", "km")`. `72 F to C` and `5 mi in km` work too. |
| `5 ft + 3 in` | "Put both in one unit", with **Use 5 + convert(3, "in", "ft")**. |
| `3 m + 2 s` | Says that a length and a time can't be added. |
| `percentile(0.95)` | Offers **Use invNorm(0.95)**, the normal percentile. `percentile(list, p)` is the percentile of a list. |

## Percent

`80 + 15%` is 92, which is 80 plus 15% of 80, and `80 − 15%` is 68. A chain goes left to right, so `80 + 15% + 10%` is 101.2. The line says what it did: "15% of 80 added".

Multiplying and dividing treat a percent as a number, so `80 × 15%` is 12 and `15%` on its own is 0.15.

To make `%` mean "divide by 100" everywhere, so that `80 + 15%` is 80.15, set **80 + 15% =** to 80.15 in Modes. Each sheet keeps its own choice.

## Answers

- Click an answer to copy it as plain text.
- **Dec** and **Exact** switch between decimals and exact forms such as 3/8, √3/2 and π/6.
- **Round** sets the decimal places for every answer and for copying, from Auto to 15.
- **Percent** shows probabilities as percents.
- A huge answer shows as 3.97698764 × 10¹⁹⁹⁷. Set **Huge answers** to Every digit in Modes to see them all in a box that scrolls. Copying always takes every digit.

## Sheets, undo and history

Your work saves as you type. Once a sheet has a name (File → Save), every edit goes into it, so opening another sheet never loses anything. File also has New sheet, Open, Duplicate, Rename, and Export and Import, which move a sheet as a JSON file. If you pick a name another sheet has, the app asks before replacing it.

**Undo** (Ctrl+Z) reaches back as far as you like. Typing comes back a word at a time. A moved or deleted line, a clear, a one-click fix, a slider drag, New sheet, Open and Import are each one step. Ctrl+Shift+Z redoes. After a clear, the message's Undo button does the same thing and stays for 10 seconds.

**History** (Ctrl+Alt+Y) keeps every finished line and its full-precision answer through edits, clears and restarts.

## Finding a function

Find (Ctrl+K, or the Find button) searches function names, the words on their keys, and the words people use for them. "percentile" finds invNorm, "area between" finds normalcdf, and "miles to km" finds convert. It takes whole phrases too: "chance of exactly 4" finds binompdf.

Choosing a function puts it in your line with the caret inside the brackets. The keypad tab that holds it glows for a moment, so you know where it lives. Find also runs commands, such as changing the theme or opening an example.

## The keypad

The number pad never changes. The digits are in the middle, the operators run down the right edge, and enter is at their foot. Over the pad are x, y, π, e, % and ans, then five tabs: Math, Stats, Chance, Matrix and HVAC.

- A tab opens a page of tiles over your lines, never over the keys. Each tile shows what it works out, like P(X = k) or area → z, with the function's name underneath. Point at a tile or key and the line under the keypad says what it does.
- Click a tile and the function goes into your line. Grey names show the inputs still to type, as in `binompdf(10, 0.3, k)`, and each one disappears as you type it. The line shows no error until the inputs it needs are in.
- The 2 × 2 and 3 × 3 matrix tiles put in a grid of empty cells. Type a number, then comma or Next to move to the next cell.
- The page closes with ✕, its tab, a tile, Esc, or any key on the pad, which still types.
- Hold ← or → to keep moving the caret. Hold ⌫ to clear the line. AC clears every line, and Undo brings them back.

**Keypad** in the top bar hides the keys, and the app remembers.

## The graph

Drag to pan, scroll to zoom, and hover to trace a curve. Shift+drag zooms into the box you draw. The buttons at the side zoom, fit every curve, square the axes, go home and save a picture.

Each curve is named on the plot in its own color. Its zeros, highs and lows, y-intercept and crossings are marked with dots. Point near a dot and the readout snaps to it, like "zero (1.2247, 0)". Click to pin the label.

A slider line gets its slider under the line. Dragging it moves every curve that uses the variable. A slider for a whole number steps by 1 and runs from 0 to twice the number.

With the keyboard in the graph, the arrows pan, + and − zoom, F fits, S squares the axes, 0 resets, P saves a PNG, C copies the image, [ and ] step through the marked points, Enter pins one, and Delete clears the pins.

## The top bar

The top bar holds the modes you change most: Deg or Rad, Dec or Exact, Pop or Sample (population or sample standard deviation), the Percent, Line letters and Complex switches, and Round. **Modes** holds the rest, plus any the bar has no room for on a narrow window. To the right are Keypad, Graph, Appearance, Find, File and ? (every shortcut).

Drag the line between the notebook and the graph to resize them.

## On a phone or a narrow window

Under 760 px wide the app shows one pane at a time, Calculate or Graph, switched at the bottom.

- The keypad keeps the phone's own keyboard down. The keyboard button at the bottom right brings it back.
- The modes and Appearance are in the Modes sheet, behind the sliders button at the top.
- Clear all is in File, and its Undo stays for 10 seconds.
- Long-press a line's number for its menu. File → Reorder lines puts ↑ and ↓ on every line until you tap Done.
- On Graph, a chip for each plotted line sits over the graph tools, with a slider for each variable the curves use.
- File → Share as text sends the sheet to another app where the browser can share.
- Add the page to your home screen and it opens full screen.

## Keyboard shortcuts

Everything works without a mouse. Each area is one Tab stop: the top bar, the line tools, your line, the keypad and the graph. Arrow keys move inside an area, and Esc brings you back to your line.

On a Mac, read Ctrl as ⌘ and Ctrl+Alt as Ctrl+Option. The app shows shortcuts the Mac way there.

| Keys | Do |
| --- | --- |
| Enter, ↑/↓ | New line, move between lines |
| Alt+↑/↓ | Move the line itself |
| Alt+Shift+↑/↓ | Duplicate the line above or below |
| Ctrl+Shift+Backspace | Delete the line |
| Ctrl+Alt+Backspace | Clear every line |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+K (or Ctrl+/) | Find functions, commands, themes, keypad tabs and examples |
| Ctrl+Alt+K / G | Jump into the keypad / graph; press again to come back |
| Ctrl+Alt+Shift+K / G | Show or hide the keypad / graph |
| Ctrl+Alt+1…5 | Open a keypad tab: Math, Stats, Chance, Matrix, HVAC |
| Ctrl+Alt+← / → | Turn the open tab's pages |
| Ctrl+Alt+N | Add a normal curve |
| Ctrl+S / Ctrl+Alt+O | Save the sheet / open one |
| Ctrl+Alt+Shift+N | New sheet |
| Ctrl+Alt+Y | History |
| Ctrl+Alt+D / E / M / P / L | Deg or Rad, Exact, Sample SD, Percent, Line letters |
| Ctrl+Alt+T | Next theme |
| Ctrl+Alt+H | Every shortcut |

## Looks and themes

Appearance, beside Find, has two looks. **Modern** is a plain notebook beside the plot with one accent color. **Retro** draws the app as lab hardware, with green-bar printer paper and sculpted keycaps.

A small sample at the top of Appearance shows your choices as you make them.

- **Mode** is System, which follows your computer, or Light or Dark.
- **Pure black when dark** puts Dark on true black.
- **High contrast** draws black and white with an outline on every control.
- **Color** sets the accent: the caret, the line you're typing, enter and the operators.
- **Motion** can be Full, Reduced or Off.

There is one more set of colors, and it isn't in the menu until you've earned it. The code is older than this calculator. Enter it the calculator's way: the number pad's arrows, then B A.

## Accessibility

- Screen readers hear each line's answer after you pause typing, and copies, deletes and errors as they happen. They hear what the line shows, not the parser's wording.
- Each line is labeled by its number and letter, and the graph describes what it shows and how to move it.
- Focus is always visible. Reduce Motion in your system settings turns off the animations.
- High contrast marks errors with a symbol as well as a color.
