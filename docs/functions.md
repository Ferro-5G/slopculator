# Functions

Every built-in, grouped by area. To search by name or by what a function does: press Ctrl+/ in the app, or type a name on the keypad and read the hint.

Most functions also sit on a keypad tab. Point at a key and the strip under the keypad explains it.

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

## Normal distributions

| Type | Get |
| --- | --- |
| `normalcdf(z)` | P(Z ≤ z) |
| `normalcdf(a, b)` | P(a ≤ Z ≤ b) |
| `normalcdf(a, b, μ, σ)` | P(a ≤ X ≤ b), with `-inf` for an open end |
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
- In a graph, `y = deriv(x^3, x)` and `y = integral(t, t, 0, x)` draw the derivative and the area function.

## Matrices, vectors, and transforms

- Matrices: `[[1,2],[3,4]]`, `det inv transpose identity rref linsolve`, `A^-1`, `A^n`, `trace`, `rank`, `eigen` (2×2 and 3×3; complex eigenvalues need Complex mode), `augment(A, B)`. A grid editor lives on the Matrix tab.
- Vectors: `⟨3, 4⟩` or `[3, 4]`, `dot cross mag unit angle`.
- Transforms: `rotation(θ)`, `reflectx`, `reflecty`, `reflectyx`, `dilation(k)`, `apply(M, points)`, `polygon(...)`.
- Geometry: `distance(p, q)`, `midpoint(p, q)`, `slope(p, q)`, `area` and `perimeter` of a polygon or a list of points, `circlearea(r)`, `circumference(r)`.

## Trigonometry

Trig follows the Deg/Rad switch. `sin … cot`, `asin … acot` (the range shows under the answer), `atan2`, `30°` from either mode, `torad todeg arclen sector unitcircle period trigform tanform`. In radian mode, trig graphs count the x-axis in π. Working (in Modes, on unless you turn it off) adds the angle unit under trig answers, substituted formulas, the unit circle drawing and asymptote lines. It changes no answer. The notes that say what a function did to reach its answer stay either way.

## Complex numbers

Turn on Complex mode (the a+bi mode pill) to allow results with i. `re`, `im`, `conj`, `arg` (follows Deg/Rad), `polar`.

## Number theory and polynomials

- `isprime(n)` (1 or 0), `factor(360)` shows 360 = 2³ · 3² · 5 with a row per prime, `divisors`, `totient`, `gcd`, `lcm`, `quot`, and `rem`. `rem(-7, 3)` is −1, while `mod(-7, 3)` is 2. Exact up to 2^53 − 1.
- `roots(1, -6, 11, -6)` or `roots({1, -6, 11, -6})` finds every root of any degree, highest power first. Complex roots show in Complex mode; otherwise a note says how many there are. `polyval({1, -3, 2}, 5)` evaluates.

## Text, bases, and units

- `hex(255)` is "FF", with `bin`, `oct`, and `base(n, b)` for bases 2 to 36. `dec("ff", 16)` and `dec("0b101")` read digits back.
- `convert(5, "mi", "km")` covers length, mass, time, volume, area, speed, temperature (°C, °F, K), data (kB and KiB, bits and bytes), angle, pressure, power, energy, volume flow, Btu/lb, humidity ratio, density, ΔT, and R-value. Converting between kinds, like miles to kilograms, is an error. `"ton"` means a ton of cooling when the other unit is power.

## Graphing

- `y = …`, `x = …`, inequalities with shading, implicit curves like `x^2 + y^2 = 25`, points and point lists, domain restrictions `y = x^2 {x > 0}`, piecewise `{x < 0: -x, x}`, normal curves, and binomial sticks.
- Select a curve and the graph marks its zeros, max/min, y-intercept, and intersections with other curves. Hover one to read it, and click any point to pin its coordinates.
- Write `(h, k)` from two sliders and drag the point on the graph. The sliders and every curve that uses them follow.
- Shaded normal curves show the probability on the graph and the z-scores beside the answer. ±1σ, ±2σ, and ±3σ buttons shade the empirical-rule bands.
- With several curves on screen, each is labeled with its line.

## HVAC

The Air, Refrig, and Flow tabs cover field and design work. Inputs are US units, and `"SI"` as the last input switches a function to metric. [docs/guide.md](guide.md#hvac) has worked examples.

- Moist air: `psych(75, 50)` gives wet bulb, dew point, %RH, humidity ratio, grains, enthalpy, volume, density, and pressure, with altitude as an optional third input. `psychwb`, `psychdp`, `psychw`, and `psychh` start from another property. `enthalpy`, `wetbulb`, `dewpoint`, `humratio`, `grains`, `specvol`, and `airdensity` return one number, work over lists, and graph. The equations are from the 2017 ASHRAE Handbook of Fundamentals.
- Loads: `sensibleheat`, `latentheat`, `totalheat`, `airflow`, `temprise`, `shratio`, `coil`, `coilwb`, `mixair`, `mixtemp`, `oapercent`, `bypassfactor`, `waterheat`, `waterflow`, `uaheat`, `uvalue`, `airchanges`, `achflow`, and `ventair`.
- Refrigerants: `superheat`, `subcool`, `ptchart`, `sattemp`, `pbubble`, `pdew`, `tbubble`, `tdew`, `refprops`, and `refcycle` for 20 refrigerants, including R-410A, R-454B, R-32, and R-22. Blends have separate bubble and dew points.
- Efficiency: `eertocop`, `seertocop`, `hspftocop`, `coptoeer`, `coptokwton`, `kwtontocop`, `carnotcop`.
- Air and water flow: `ductvel`, `ductloss`, `ductsize`, `ductdia`, `eqdia`, `rectduct`, `velpressure`, `velfromvp`, `fanlaws`, `fanpower`, `pumppower`, `pipevel`, `pipeloss`, `valvecv`, `valveflow`.
- Field numbers: `gasinput`, `elecpower`, `voltimbalance`, `targetsuperheat`.

Moist-air results match PsychroLib, and refrigerant tables match CoolProp. R-448A, R-449A, and R-454B pressures match the manufacturers' tables. These are engineering numbers: check them against the equipment's own charging chart before charging a system.

## Errors and limits

Errors stop the line with a reason: division by zero, `nCr` with non-whole numbers, a singular matrix, `√` of a negative outside Complex mode. A typo like `normcdf` gets "Did you mean normalcdf?" with a one-click fix.

Each line has a budget of 2 seconds and 10 million values. A line that goes past it, like a recursive function with no memo or a `seq` inside a `seq`, stops with a message instead of freezing the app.
