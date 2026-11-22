# Functions

Every built-in, grouped by area. To search by name or by what a function does, press Ctrl+K (⌘K on Mac) or Ctrl+/ in the app.

Most functions also sit on a keypad tab. Point at a key or tile on desktop and the strip above the keypad explains it.

## Arithmetic and variables

- `+ − × ÷ ^ √ ∛ nthroot |x| ! %`, `floor ceil round(x, n) mod`, `π e`, `1.5E3`.
- `ans` is the line above. With line letters on, line 1 is also `A`, line 2 `B`, and so on.
- `a = 3` defines a variable and gets a slider. `f(x) = x^2` defines a function that can be called and graphed.
- `2x` and `nt` multiply. `P(1 + r/n)^(nt)`, `Pe^(rt)`, and `ax^2` raise only the last factor.
- One-input functions take their input without brackets, spaced or not: `sin 30`, `sin30`, `sqrt 16`, `ln2`, `abs -5`, `sin x cos x`.
- `10% of 50` is 5, `7 mod 3` is 1, and `1 000 000` is a million.
- Logs: `log`, `ln`, `log_2(8)`, `log2(8)`, `log₂(8)`, `log(b, x)`.
- Interest: `compound(P, r, n, t)`, `continuous(P, r, t)`, `solve(1000(1.05)^t = 2000, t)`. For the solutions in a range, `solve(sin(x) = 0.5, x, 0, 360)`; a note says so when they are packed too closely to find them all.
- Finance: `simple(P, r, t)` is P(1 + rt), `pmt(rate, n, loan)` is the payment per period, `fvannuity(rate, n, payment)` and `pvannuity` value a stream of payments, and `pctchange(old, new)` is in percent.

## Exact results

Whole numbers keep every digit: `2^64` is 18446744073709551616, and `25!`, `nCr(100, 50)`, and `9007199254740993` are exact. Decimals you type are exact too, so `1e16 + 1 - 1e16` is 1 and the 6×6 Hilbert determinant is 5.36729988736E-18, not 0. Square roots, `e^x`, logs, and trig are computed with extra precision and shown only to digits that are proven, so `e^100` is 2.68811714181614E43.

Exact mode (Ctrl+Alt+E) shows `3/8`, `√3/2`, and `π/6` instead of decimals. Graphs stay on fast doubles, and anything exact math doesn't cover (statistics, distributions, calculus) runs on doubles too. [docs/architecture.md](architecture.md) explains how it works.

## Counting, lists, and statistics

- Counting: `nCr`, `nPr` (also `8 nCr 3`, `8 choose 3`, `8C3`, `8P3`), `count(a, b, c)`.
- Lists: `{2, 5, 7}`, then `mean` (also `avg`), `median mode range sdp sds varp vars fivenum stats`. `sd` and `var` follow the Pop/Sample switch, which defaults to population (÷ n).
- More: `percentile(list, p)` with p from 0 to 100, `quartiles`, `gmean`, `hmean`, `wmean(values, weights)`, `mad` (mean absolute deviation), `zscores` (population SD), `cumsum`, `dedupe`.
- Expected value: `EV({x}, {p})` warns when the probabilities don't add to 1. `netgain({values}, {probs}, cost)` subtracts a cost. A table with an `x` column and a `P` column shows E(X) and ΣP.
- Proportions: `moe(n)` is 1/√n, `phat(successes, n)`, and `sep(p, n)` is √(p(1 − p)/n).
- Regression on two lists: `linreg(xs, ys)` gives a, b, r, and r² for y = ax + b. Also `quadreg`, `expreg` (y = a·b^x), `powreg` (y = a·x^b), and `lnreg` (y = a + b·ln x). `corr` is r. `covp` and `covs` are population and sample covariance, and `cov` follows the Pop/Sample switch.
- Regression as a line of its own: `y1 ~ m x1 + b` fits `m` and `b` to the lists `x1` and `y1`, shows them with R², draws the fit, and defines them, so `m` and `b` work on other lines. The unknowns are the names nothing else defines, and the model can be anything: `y1 ~ a x1^2 + b x1 + c`, `y1 ~ a b^x1`, `y1 ~ a sin(b x1) + c`. With a table whose columns are headed `x` and `y`, write `y ~ mx + b`.
- Random numbers: `random()` from 0 to 1, `random(5)` for a list, `randInt(1, 6)`, `randNorm(μ, σ)`, `randBin(n, p)`, `shuffle(list)`. A line keeps its numbers while you type on other lines; they are new each time the page loads.

## Normal distributions

| Type | Get |
| --- | --- |
| `normalcdf(z)` | P(Z ≤ z) |
| `normalcdf(a, b)` | P(a ≤ Z ≤ b) |
| `normalcdf(a, b, μ, σ)` | P(a ≤ X ≤ b), with `-inf` for an open end. On its own line its block draws the curve with the area shaded, and the bounds can be dragged |
| `invNorm(p)`, `invNorm(p, μ, σ)` | z (or x) with that much area to the left |
| `zscore(x, μ, σ)`, `x_from_z(z, μ, σ)` | (x − μ)/σ and μ + zσ |
| `normleft`, `normright`, `normbetween`, `normoutside` | the four tail shapes |
| `empirical(μ, σ)`, `empirical(μ, σ, a, b)` | cut points, or the 68–95–99.7 slice total between two cut points |
| `zcrit(0.95)` | 1.96 |
| `normaldist(μ, σ)` | the curve on the graph, with a Cumulative probability box and Min/Max fields |

Ctrl+Alt+N adds a normal curve. The CDF uses erf computed from its series and continued fraction to full double precision, not a lookup table. `invNorm` refines Acklam's approximation with Halley steps.

## Other distributions

- Binomial: `binompdf binomcdf binomge binomgt binomlt binombetween binomstats binomdist`.
- `tpdf(t, df)`, `tcdf(a, b, df)`, `invT(p, df)`, `chi2pdf`, `chi2cdf(a, b, df)`, `Fpdf`, `Fcdf(a, b, df1, df2)`, `poissonpdf(λ, k)`, `poissoncdf(λ, k)`, `geompdf(p, k)`, `geomcdf(p, k)`, `uniformpdf`, `uniformcdf`. The cdf functions also take a single bound for P(X ≤ x), as in `tcdf(2, 10)`.
- Special functions: `gamma`, `lgamma`, `beta(a, b)`, `erf`, `erfc`. Gamma uses the Lanczos approximation. The t, χ², and F distributions use the regularized incomplete gamma and beta functions.

## Calculus

- `deriv(t^3, t, 2)` is the slope at t = 2, and `deriv2` is the second derivative. Both use central differences with Richardson extrapolation and refuse corners like `|t|` at 0.
- `integral(t^2, t, 0, 3)` uses adaptive Gauss–Kronrod and takes `-inf` and `inf` as bounds.
- `sum(n^2, n, 1, 10)`, `prod`, and `seq(2n + 1, n, 1, 4)`.
- `tangent(f, p)` is the line touching f at x = p, with slope f′(p), for a function defined on the sheet (`f(x) = x^3 - 3x`) or a built-in one like `sin`. Its block draws f with the line and f′ under it, and its point can be dragged.
- `riemann(f, a, b, n)` adds n strips under f from a to b, each as tall as f at its middle; a fifth input `"left"` or `"right"` samples the strip's end instead. Its block draws the strips with the integral beside the sum.
- In a graph, `y = deriv(x^3, x)` and `y = integral(t, t, 0, x)` draw the derivative and the area function.
- The same in notation: `f'(2)` and `f''(2)`, `d/dx x^3`, `sum_{n=1}^{10} n^2`, `prod_{n=1}^{5} n`, and `int_0^3 t^2 dt` (or `∑`, `∏` and `∫`). A sum or a `d/dx` covers the product after it, and an integral runs to its `dx`.

## Matrices, vectors, and transforms

- Matrices: `[[1,2],[3,4]]`, `det inv transpose identity rref linsolve`, `A^-1`, `A^n`, `trace`, `rank`, `eigen` (2×2 and 3×3; complex eigenvalues need Complex mode), `augment(A, B)`. A grid editor lives on the Matrix tab. A line whose answer is a 2×2 matrix draws the plane carried through it: the grid, the basis vectors (drag their tips) and the unit square's image, whose area is the determinant.
- Vectors: `⟨3, 4⟩` or `[3, 4]`, `dot cross mag unit angle`.
- Transforms: `rotation(θ)`, `reflectx`, `reflecty`, `reflectyx`, `dilation(k)`, `apply(M, points)`, `polygon(...)`.
- Geometry: `distance(p, q)`, `midpoint(p, q)`, `slope(p, q)`, `area` and `perimeter` of a polygon or a list of points, `circlearea(r)`, `circumference(r)`.

## Trigonometry

Trig follows the Deg/Rad switch. `sin … cot`, `asin … acot` (the range shows under the answer), `atan2`, `30°` from either mode, `torad todeg arclen sector unitcircle period trigform tanform`. `unit circle(θ)` (or `unitcircle(θ)`) on its own line is a figure: the circle with cos θ and sin θ, beside their waves, with the point to drag. In radian mode, trig graphs count the x-axis in π. Working (in Modes, on unless you turn it off) adds the angle unit under trig answers, substituted formulas, the unit circle drawing and asymptote lines. It changes no answer. The notes that say what a function did to reach its answer stay either way.

## Complex numbers

Turn on Complex mode (the a+bi mode pill) to allow results with i. `re`, `im`, `conj`, `arg` (follows Deg/Rad), `polar`.

## Number theory and polynomials

- `isprime(n)` (1 or 0), `factor(360)` shows 360 = 2³ · 3² · 5 with a row per prime, `divisors`, `totient`, `gcd`, `lcm`, `quot`, and `rem`. `rem(-7, 3)` is −1, while `mod(-7, 3)` is 2. Exact up to 2^53 − 1.
- `roots(1, -6, 11, -6)` or `roots({1, -6, 11, -6})` finds every root of any degree, highest power first. Complex roots show in Complex mode; otherwise a note says how many there are. `polyval({1, -3, 2}, 5)` evaluates.

## Text, bases, and units

- `hex(255)` is "FF", with `bin`, `oct`, and `base(n, b)` for bases 2 to 36. `dec("ff", 16)` and `dec("0b101")` read digits back.
- `convert(5, "mi", "km")` covers length, mass, time, volume, area, speed, temperature (°C, °F, K), data (kB and KiB, bits and bytes), angle, pressure, power, energy, volume flow, Btu/lb, humidity ratio, density, ΔT, and R-value. Converting between kinds, like miles to kilograms, is an error. `"ton"` means a ton of cooling when the other unit is power.

## Written the way other calculators take it

Lines from Desmos, a TI or code mostly work as they are.

- Copied out of Desmos, a line is LaTeX, and it reads as it is: `\frac{1}{2}`, `\sqrt[3]{8}`, `\left(1+2\right)\cdot3`, `x_{1}`, `\sum_{n=1}^{10}n`, `y_{1}\sim mx_{1}+b`.
- Desmos lists: `[1...10]` and `[1, 3, ..., 9]` are ranges, `L[2]` is the second item and `L[2...4]` three of them, `[n^2 for n = [1...5]]` builds a list, and `x^2 with x = 3` swaps a value in. A `[ ]` of numbers takes `+ 1` and `^2` on each number. `total`, `quantile(list, 0.5)`, `quartile(list, 1)`, `spearman`, `join`, `repeat`, `unique`.
- A dot reads a part: `P.x` and `P.y` of a point, and `normaldist(0, 1).cdf(1)`, `.cdf(low, high)`, `.pdf(x)` and `.inversecdf(p)` of a normal or `binomialdist(n, p)`. On a table of results it reads a row: `A.h` of a moist-air state, `stats(L).s`, `quartiles(L).Q1`, `linreg(xs, ys).r2`, `coil(…).tons`. A function name after a dot works on what it hangs off, as Desmos reads `L.mean`; a row of the same name wins.
- A TI's keys: `5 → A` (or `5 -> A`) stores, `3ᴇ5`, `⁻5`, `³√8`, `[[1, 2][3, 4]]`, `[A]ᵀ`, and `nDeriv`, `fnInt`, `iPart`, `fPart`, `int`, `logBASE(x, b)`, `remainder`, `stdDev`, `variance`, `dim`, `geometpdf`, `χ²cdf`.
- From code and other calculators: `pow`, `hypot`, `trunc`, `ceiling`, `sgn`, `cuberoot`, `binomial`, `ld`, `lg`, `sind cosd tand`, `degrees radians`, `asinh acosh atanh` (also `arcsinh`), `sech csch coth`, `clamp(x, low, high)`, `if(condition, then, otherwise)`, `first last reverse`.
- Operators: `≠` and ` != `, `==`, `<>`, `and or xor not(…)`, `a := 5`, `½ ¼ ¾`, `0x1F`, `0b101`. A `$` is skipped, so `$5 + $3` is 8. `5!=120` is still five factorial equal to 120; put a space before `!=` to mean "not equal".
- A function or constant typed in another case is read as itself once no line defines that name: `Sqrt(16)`, `LOG(100)`, `PI`, `Ans`.

Some names mean something else here than in Desmos, and keep their meaning: `count(a, b, c)` multiplies choices, `var` and `cov` follow the Pop/Sample switch, `log(b, x)` takes the base first, and `7 % 3` is 7% of 3 (use `mod`).

## Graphing

- `y = …`, `x = …`, inequalities with shading, implicit curves like `x^2 + y^2 = 25`, points and point lists, domain restrictions `y = x^2 {x > 0}`, piecewise `{x < 0: -x, x}`, normal curves, and binomial sticks.
- Select a curve and the graph marks its zeros, max/min, y-intercept, and intersections with other curves. Hover one to read it, and click any point to pin its coordinates.
- Write `(h, k)` from two sliders and drag the point on the graph. The sliders and every curve that uses them follow.
- Shaded normal curves show the probability on the graph and the z-scores beside the answer. ±1σ, ±2σ, and ±3σ buttons shade the empirical-rule bands.
- With several curves on screen, each is labeled with its line.

## HVAC

The Air, Refrig, and Flow tabs cover field and design work. Inputs are US units, and `"SI"` as the last input switches a function to metric. [docs/guide.md](guide.md#hvac) has worked examples.

- Moist air: `psych(75, 50)` gives wet bulb, dew point, %RH, humidity ratio, grains, enthalpy, volume, density, and pressure, with altitude as an optional third input. `psychwb`, `psychdp`, `psychw`, and `psychh` start from another property. A named state's rows read by the chart's names: `A.Tdb`, `A.Twb`, `A.Tdp`, `A.RH`, `A.W` (humidity ratio), `A.gr` or `A.g` (grains or g/kg), `A.h`, `A.v`, `A.rho`, `A.pv`, `A.p`, so `q = A.h − B.h` is a coil's enthalpy drop. `enthalpy`, `wetbulb`, `dewpoint`, `humratio`, `grains`, `specvol`, and `airdensity` return one number, work over lists, and graph. The equations are from the 2017 ASHRAE Handbook of Fundamentals.
- Loads: `sensibleheat`, `latentheat`, `totalheat`, `airflow`, `temprise`, `shratio`, `coil`, `coilwb`, `mixair`, `mixtemp`, `oapercent`, `bypassfactor`, `waterheat`, `waterflow`, `uaheat`, `uvalue`, `airchanges`, `achflow`, and `ventair`.
- Refrigerants: `superheat`, `subcool`, `ptchart`, `sattemp`, `pbubble`, `pdew`, `tbubble`, `tdew`, `refprops`, and `refcycle` for 20 refrigerants, including R-410A, R-454B, R-32, and R-22. Blends have separate bubble and dew points.
- Efficiency: `eertocop`, `seertocop`, `hspftocop`, `coptoeer`, `coptokwton`, `kwtontocop`, `carnotcop`.
- Air and water flow: `ductvel`, `ductloss`, `ductsize`, `ductdia`, `eqdia`, `rectduct`, `velpressure`, `velfromvp`, `fanlaws`, `fanpower`, `pumppower`, `pipevel`, `pipeloss`, `valvecv`, `valveflow`.
- Field numbers: `gasinput`, `elecpower`, `voltimbalance`, `targetsuperheat`.

Moist-air results match PsychroLib, and refrigerant tables match CoolProp. R-448A, R-449A, and R-454B pressures match the manufacturers' tables. These are engineering numbers: check them against the equipment's own charging chart before charging a system.

## Errors and limits

Errors stop the line with a reason: division by zero, `nCr` with non-whole numbers, a singular matrix, `√` of a negative outside Complex mode. A typo like `normcdf` gets "Did you mean normalcdf?" with a one-click fix.

Each line has a budget of 2 seconds and 10 million values, and the whole sheet has 6 seconds. A line that goes past it, like a recursive function with no memo or a `seq` inside a `seq`, stops with a message instead of freezing the app.
