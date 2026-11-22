# Functions

Every built-in function, grouped by area. Press `Ctrl+K` (`⌘K` on Mac) in the app to search by name or what a function does.

## Arithmetic, variables, and finance

- Operators: `+ − × ÷ ^ √ ∛ nthroot |x| ! %`, `floor`, `ceil`, `round(x, n)`, `mod`, `π`, `e`, `1.5E3`.
- References: `ans` is the line above. With Line letters on, line 1 is `A`, line 2 is `B`, and so on.
- Definitions: `a = 3` defines a variable with a slider; `f(x) = x^2` defines a reusable graphed function.
- Natural syntax: `2x`, `nt`, `sin 30`, `sin30`, `sqrt 16`, `ln2`, `abs -5`, `10% of 50`, `7 mod 3`, `1 000 000`.
- Logs: `log`, `ln`, `log_2(8)`, `log2(8)`, `log₂(8)`, `log(b, x)`.
- Solving: `solve(1000(1.05)^t = 2000, t)`, or bounded `solve(sin(x) = 0.5, x, 0, 360)`.
- Finance: `simple(P, r, t)`, `compound(P, r, n, t)`, `continuous(P, r, t)`, `pmt(rate, n, loan)`, `fvannuity(rate, n, payment)`, `pvannuity`, `pctchange(old, new)`.

## Exact math

Integers keep every digit (`2^64`, `25!`, `nCr(100, 50)`), and typed decimals stay exact (`0.1 + 0.2 = 3/10`, `1e16 + 1 - 1e16 = 1`). Roots, exponentials, logs, and trig compute with extra precision and display only proven digits.

Turn on **Exact** (`Ctrl+Alt+E`) for fraction, root, and `π` outputs (`3/8`, `√3/2`, `π/6`). Graphs, statistics, distributions, and calculus run on doubles. See [architecture.md](architecture.md) for how exact math works.

## Counting, lists, and statistics

- Counting: `nCr`, `nPr` (also `8 choose 3`, `8C3`, `8P3`), `count(a, b, c)`.
- Lists: `{2, 5, 7}` with `mean` (`avg`), `median`, `mode`, `range`, `sdp`, `sds`, `varp`, `vars`, `fivenum`, `stats`. `sd` and `var` follow **Standard deviation** in Modes (Population by default).
- More list stats: `percentile(list, p)` (`p` in 0 to 100), `quartiles`, `gmean`, `hmean`, `wmean(values, weights)`, `mad`, `zscores`, `cumsum`, `dedupe`.
- Expected value: `EV({x}, {p})`, `netgain({values}, {probs}, cost)`, or tables with `x` and `P` columns.
- Proportions: `moe(n)`, `phat(successes, n)`, `sep(p, n)`.
- Regressions: `linreg`, `quadreg`, `expreg`, `powreg`, `lnreg`, `corr`, `covp`, `covs`, `cov`. Or write a model line like `y1 ~ m x1 + b` (or `y1 ~ a x1^2 + b x1 + c`) to fit, plot, and define the parameters.
- Random: `random()`, `random(n)`, `randInt(a, b)`, `randNorm(μ, σ)`, `randBin(n, p)`, `shuffle(list)`. Values stay steady while editing other lines and refresh on reload.

## Distributions

| Type | Result |
| --- | --- |
| `normalcdf(z)` / `normalcdf(a, b)` / `normalcdf(a, b, μ, σ)` | Normal area (use `-inf` / `inf` for open tails; renders a draggable shaded curve on its own line) |
| `invNorm(p)` / `invNorm(p, μ, σ)` | z or x with left-tail area `p` |
| `zscore(x, μ, σ)`, `x_from_z(z, μ, σ)` | Standardize or un-standardize |
| `normleft`, `normright`, `normbetween`, `normoutside` | Tail helpers |
| `empirical(μ, σ)` / `empirical(μ, σ, a, b)` | 68-95-99.7 rule cuts or slice area |
| `zcrit(0.95)` | Critical z (`1.96`) |
| `normaldist(μ, σ)` | Plotted normal curve with shading controls (`Ctrl+Alt+N`) |

- Binomial: `binompdf`, `binomcdf`, `binomge`, `binomgt`, `binomlt`, `binombetween`, `binomstats`, `binomdist`.
- Other: `tpdf`, `tcdf`, `invT`, `chi2pdf`, `chi2cdf`, `Fpdf`, `Fcdf`, `poissonpdf`, `poissoncdf`, `geompdf`, `geomcdf`, `uniformpdf`, `uniformcdf`.
- Special functions: `gamma`, `lgamma`, `beta(a, b)`, `erf`, `erfc`.

## Calculus

- Derivatives: `deriv(t^3, t, 2)` and `deriv2` (central differences + Richardson extrapolation).
- Integrals: `integral(t^2, t, 0, 3)` (adaptive Gauss-Kronrod, supports `-inf` and `inf`).
- Series: `sum(n^2, n, 1, 10)`, `prod`, `seq(2n + 1, n, 1, 4)`.
- Interactive blocks: `tangent(f, p)` plots `f` and its draggable tangent line; `riemann(f, a, b, n)` plots left/mid/right Riemann rectangles next to the integral.
- Plotted forms: `y = deriv(x^3, x)` and `y = integral(t, t, 0, x)`.
- Math notation: `f'(2)`, `f''(2)`, `d/dx x^3`, `sum_{n=1}^{10} n^2`, `prod_{n=1}^{5} n`, `int_0^3 t^2 dt`, plus `∑`, `∏`, `∫`.

## Matrices, vectors, and geometry

- Matrices: `[[1,2],[3,4]]`, `det`, `inv`, `transpose`, `identity`, `rref`, `linsolve`, `A^-1`, `A^n`, `trace`, `rank`, `eigen` (2x2 and 3x3), `augment(A, B)`. A standalone 2x2 matrix draws an interactive basis-vector transform grid.
- Vectors: `⟨3, 4⟩` or `[3, 4]`, `dot`, `cross`, `mag`, `unit`, `angle`.
- Transforms: `rotation(θ)`, `reflectx`, `reflecty`, `reflectyx`, `dilation(k)`, `apply(M, points)`, `polygon(...)`.
- Geometry: `distance`, `midpoint`, `slope`, `area`, `perimeter`, `circlearea`, `circumference`.

## Trigonometry and complex numbers

- Trig follows **Deg | Rad**: `sin`...`cot`, `asin`...`acot`, `atan2`, `30°`, `torad`, `todeg`, `arclen`, `sector`, `unitcircle` (or `unit circle(θ)` for an interactive diagram), `period`, `trigform`, `tanform`.
- Complex numbers (enable **Complex numbers** in Modes): `re`, `im`, `conj`, `arg`, `polar`.

## Number theory, polynomials, bases, and units

- Number theory (exact up to `2^53 − 1`): `isprime`, `factor`, `divisors`, `totient`, `gcd`, `lcm`, `quot`, `rem`.
- Polynomials: `roots(1, -6, 11, -6)`, `polyval({1, -3, 2}, 5)`.
- Bases: `hex`, `bin`, `oct`, `base(n, b)` (bases 2 to 36), `dec("ff", 16)`, `dec("0b101")`.
- Units: `convert(5, "mi", "km")` covers length, mass, time, volume, area, speed, temperature, data (kB/KiB), angle, pressure, power, energy, flow, Btu/lb, humidity ratio, density, ΔT, and R-value.

## Other calculator syntax

Most expressions copied from Desmos, TI calculators, or code work directly:

- Desmos LaTeX: `\frac{1}{2}`, `\sqrt[3]{8}`, `\left(1+2\right)\cdot3`, `x_{1}`, `\sum_{n=1}^{10}n`, `y_{1}\sim mx_{1}+b`.
- Desmos lists and dots: `[1...10]`, `[1, 3, ..., 9]`, `L[2]`, `L[2...4]`, `[n^2 for n = [1...5]]`, `x^2 with x = 3`, `P.x`, `normaldist(0, 1).cdf(1)`, `A.h`, `L.mean`, `total`, `quantile`, `quartile`, `spearman`, `join`, `repeat`, `unique`.
- TI syntax: `5 -> A`, `3ᴇ5`, `⁻5`, `³√8`, `[[1, 2][3, 4]]`, `[A]ᵀ`, `nDeriv`, `fnInt`, `iPart`, `fPart`, `int`, `logBASE`, `remainder`, `stdDev`, `variance`, `dim`, `geometpdf`, `χ²cdf`.
- Code aliases and operators: `pow`, `hypot`, `trunc`, `ceiling`, `sgn`, `cuberoot`, `binomial`, `ld`, `lg`, `sind`/`cosd`/`tand`, `degrees`/`radians`, `asinh`/`acosh`/`atanh`, `sech`/`csch`/`coth`, `clamp`, `if`, `first`/`last`/`reverse`, `!=`, `==`, `<>`, `and`/`or`/`xor`/`not`, `:=`, `½ ¼ ¾`, `0x1F`, `0b101`. Case-insensitive when not shadowed by a sheet variable.

Differences from Desmos: `count(a, b, c)` multiplies choices, `var`/`cov` follow Standard deviation (Population/Sample), `log(b, x)` takes base first, and `7 % 3` is 7% of 3 (use `mod`).

## Graphing

- Supports `y = ...`, `x = ...`, inequalities, implicit curves (`x^2 + y^2 = 25`), points, domain restrictions (`y = x^2 {x > 0}`), piecewise (`{x < 0: -x, x}`), normal curves, and binomial sticks.
- Selecting or hovering marks zeros, extrema, y-intercepts, and intersections; click to pin coordinates.
- Points built from two sliders (`(h, k)`) are draggable on the graph.

## HVAC

On the **HVAC** keypad tab (US units by default; pass `"SI"` at the end for metric). See [guide.md](guide.md#hvac) for examples.

- Moist air (2017 ASHRAE Handbook): `psych`, `psychwb`, `psychdp`, `psychw`, `psychh`, `enthalpy`, `wetbulb`, `dewpoint`, `humratio`, `grains`, `specvol`, `airdensity`. Named states expose fields like `A.Tdb`, `A.Twb`, `A.Tdp`, `A.RH`, `A.W`, `A.gr`, `A.h`, `A.v`, `A.rho`, `A.pv`, `A.p`.
- Loads and coils: `sensibleheat`, `latentheat`, `totalheat`, `airflow`, `temprise`, `shratio`, `coil`, `coilwb`, `mixair`, `mixtemp`, `oapercent`, `bypassfactor`, `waterheat`, `waterflow`, `uaheat`, `uvalue`, `airchanges`, `achflow`, `ventair`.
- Refrigerants (20 fluids, separate bubble/dew on blends): `superheat`, `subcool`, `ptchart`, `sattemp`, `pbubble`, `pdew`, `tbubble`, `tdew`, `refprops`, `refcycle`.
- Efficiency: `eertocop`, `seertocop`, `hspftocop`, `coptoeer`, `coptokwton`, `kwtontocop`, `carnotcop`.
- Air and water flow: `ductvel`, `ductloss`, `ductsize`, `ductdia`, `eqdia`, `rectduct`, `velpressure`, `velfromvp`, `fanlaws`, `fanpower`, `pumppower`, `pipevel`, `pipeloss`, `valvecv`, `valveflow`.
- Field: `gasinput`, `elecpower`, `voltimbalance`, `targetsuperheat`.

Checked against PsychroLib, CoolProp, and manufacturer tables (R-448A, R-449A, R-454B). Always verify against the unit's charging chart before charging a system.

## Limits

Each line has a 2-second / 10-million-value budget (6 seconds per sheet) so runaway expressions stop cleanly instead of freezing the tab.
