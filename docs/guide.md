# Worked examples

Examples for Algebra 2 (units 7 to 13) and HVAC field work. Type each line as shown and click any answer to copy it. `test/guide.test.ts` checks every answer below against the engine. See [Functions](functions.md) for the complete list.

## Quick setup

- **Deg | Rad** in the top bar sets the angle unit for trig (most homework uses degrees).
- **Standard deviation** in Modes switches `sd` and `var` between **Population** (`÷ n`, default) and **Sample** (`÷ n − 1`). `sdp` and `sds` always pick one explicitly.
- **Round** in Modes sets decimal places (Auto to 15) for display and copying.
- **Line letters** (`Ctrl+Alt+L`) names lines `A`, `B`, `C`... so later lines can write `A/50`.
- **Find** (`Ctrl+K` / `⌘K`) searches functions by name or description.

## Draggable sliders and points

Any assignment like `a = 2` gets a slider. Build a point from two sliders and you can drag the point directly on the graph:

```
h = 1
k = -2
y = (x - h)^2 + k
(h, k)
```

Grab the ringed point `(h, k)` to move the parabola and both sliders together. Search "drag" in Find (`Ctrl+K`) to load this example.

## Unit 7: Exponents and logarithms

| Problem | Type | Answer |
| --- | --- | --- |
| log base 2 of 8 | `log_2(8)` or `log(2, 8)` | 3 |
| Change of base, log₃ 81 | `ln(81)/ln(3)` | 4 |
| $1000 at 5% compounded monthly for 10 years | `compound(1000, 0.05, 12, 10)` | 1647.00949769 |
| Same, compounded continuously | `continuous(1000, 0.05, 10)` | 1648.72127070 |
| Doubling time (monthly) | `solve(1000(1 + 0.05/12)^(12t) = 2000, t)` | 13.8916... years |

You can also write the formula with variables: `P = 1000`, `r = 0.05`, `n = 12`, `t = 10`, then `P(1 + r/n)^(nt)`.

## Unit 8: Rational functions

Graph `y = 1/(x - 2) + 3`. The curve breaks cleanly at the vertical asymptote. Hover the curve to read zeros and intersections, and click a dot to pin its coordinates.

## Unit 9: Sequences and series

| Problem | Type | Answer |
| --- | --- | --- |
| First terms of aₙ = 2n + 1 | `seq(2n + 1, n, 1, 4)` | {3, 5, 7, 9} |
| Sum of n² from 1 to 10 | `sum(n^2, n, 1, 10)` | 385 |
| Define and evaluate a sequence | `a(n) = 3·2^(n − 1)`, then `a(5)` | 48 |

## Unit 10: Conics

Type conic equations directly: `x^2 + y^2 = 25`, `x^2/9 + y^2/4 = 1`, `x^2/9 - y^2/4 = 1`, `y = (x - 1)^2 + 2`. Use **1:1** on the graph toolbar so circles stay round (on phones, **Home** restores equal axes after a Fit).

## Unit 11: Probability and statistics

### Counting

| Problem | Type | Answer |
| --- | --- | --- |
| Choose 3 of 8 | `nCr(8, 3)` | 56 |
| Arrange 2 of 5 | `nPr(5, 2)` | 20 |
| 3 shirts, 4 pants, 5 hats | `count(3, 4, 5)` | 60 |

### Lists

Define `L = {2, 4, 4, 4, 5, 5, 7, 9}`, then `mean(L)` = 5, `sdp(L)` = 2, `median(L)` = 4.5, and `fivenum(L)` for box-plot numbers.

### Normal distribution

```
μ = 400
σ = 50
normaldist(μ, σ)
```

Turn on **Cumulative probability** under the curve and enter Min and Max. For `P(350 < X < 500)`, the shaded probability is **0.8186**.

| Problem | Type | Answer |
| --- | --- | --- |
| z-score of 180 (μ = 280, σ = 40) | `zscore(180, 280, 40)` | −2.5 |
| Area left of z = −2.5 | `normalcdf(-inf, -2.5)` | 0.0062 |
| P(350 < X < 500), μ = 400, σ = 50 | `normalcdf(350, 500, 400, 50)` | 0.8186 |
| Same by empirical rule | `empirical(400, 50, 350, 500)` | 0.815 |
| 90th percentile (μ = 100, σ = 15) | `invNorm(0.9, 100, 15)` | 119.22 |
| z for middle 95% | `zcrit(0.95)` | 1.96 |

The empirical rule and exact CDF differ slightly (`0.815` vs. `0.8186`); use whichever the problem asks for.

### Binomial

| Problem | Type | Answer |
| --- | --- | --- |
| Exactly 6 heads in 7 flips | `binompdf(7, 0.5, 6)` | 0.0546875 (7/128) |
| At most 3 successes (n = 10, p = 0.3) | `binomcdf(10, 0.3, 3)` | 0.6496 |
| At least 4 | `binomge(10, 0.3, 4)` | 0.3504 |
| Mean and SD | `binomstats(10, 0.3)` | 3, 1.4491 |

### Expected value and proportions

- `EV({0, 1, 2}, {0.25, 0.5, 0.25})` = 1 (warns if probabilities don't sum to 1). Use `netgain({values}, {probs}, cost)` when a game has an entry cost, or add a table with `x` and `P` columns.
- `moe(400)` = 0.05 (`1/√n`), `phat(45, 100)` = 0.45, and `sep(0.45, 100)` gives standard error `√(p(1 − p)/n)`.

## Unit 12: Matrices and vectors

| Problem | Type | Answer |
| --- | --- | --- |
| Determinant | `det([[1, 2], [3, 4]])` | −2 |
| Inverse | `inv([[1, 2], [3, 4]])` | [[−2, 1], [1.5, −0.5]] |
| Solve AX = B | `linsolve([[2, 1], [1, 3]], [3, 5])` | ⟨0.8, 1.4⟩ |
| Magnitude of ⟨3, 4⟩ | `mag(⟨3, 4⟩)` | 5 |
| Dot product | `dot([1, 2, 3], [4, 5, 6])` | 32 |
| Rotate (1, 0) by 90° | `rotation(90) * (1, 0)` | (0, 1) |
| Reflect (2, 3) over x-axis | `reflectx * (2, 3)` | (2, −3) |

Use the **Matrix**, **Vector**, and **Shape** builders on the keypad if you don't want to type brackets. `polygon((0,0), (2,0), (1,2))` draws a shape, and `dilation(2) * polygon(...)` draws its scaled image.

## Unit 13: Trigonometry

| Problem | Type | Answer |
| --- | --- | --- |
| sin 30° (Deg mode) | `sin(30)` | 0.5 |
| sin π/6 (Rad mode) | `sin(pi/6)` | 0.5 |
| 30° in either mode | `sin(30°)` | 0.5 |
| Inverse sine | `asin(0.5)` | 30 |
| Arc length (r = 10, θ = 90°) | `arclen(10, 90)` | 15.708 |
| Sector area (r = 2, θ = 180°) | `sector(2, 180)` | 6.2832 |
| Exact unit circle | `unitcircle(60)` with **Exact** on | (1/2, √3/2) |
| Amplitude and period | `trigform(2, 3, 1, 0)` | amplitude 2, period 120° |
| Tangent period and asymptote | `tanform(1, 2, 0, 0)` | period 90°, asymptote at 45° |
| All solutions in a range | `solve(sin(x) = 0.5, x, 0, 360)` | {30, 150} |

For an interactive wave, define `a = 2`, `b = 3`, `c = 1`, `d = 0`, and `y = a sin(b(x − c)) + d`. In Rad mode, the x-axis ticks count in `π`.

## HVAC

The **HVAC** keypad tab (Refrig, Air, Psych, Ducts, Water) holds about 70 functions. Defaults are US units (°F, ft, CFM, psig, Btu). Pass `"SI"` as the last argument for metric (°C, m, L/s, kPa, kJ/kg), or set `units = "SI"` once and pass `units`.

### Moist air

Relative humidity accepts `50`, `50%`, or `0.5` (values `<= 1` count as fractions). Optional altitude in ft adjusts for air pressure.

| Problem | Type | Answer |
| --- | --- | --- |
| State at 75 °F, 50% RH | `psych(75, 50)` | wet bulb 62.55, dew point 55.12, 64.65 gr/lb, 28.107 Btu/lb |
| Same at 5280 ft | `psych(75, 50, 5280)` | wet bulb 61.72, 78.77 gr/lb, 30.314 Btu/lb |
| From a sling reading | `psychwb(75, 62.6)` | 50.17% RH |
| Enthalpy only | `enthalpy(75, 50)` | 28.1066 Btu/lb |
| Dew point only | `dewpoint(75, 50)` | 55.12 °F |
| Metric enthalpy | `enthalpy(24, 50, "SI")` | 47.8146 kJ/kg |
| Mixed return + outdoor air | `mixair(800, 75, 50, 200, 95, 40)` | 78.89 °F, 48.38% RH |
| Outdoor air percent | `oapercent(79, 75, 95)` | 20% |

`psychdp`, `psychw`, and `psychh` start from dew point, humidity ratio, or enthalpy (zeroed at dry air 0 °F / 0 °C). To plot a psychrometric chart, graph `y = grains(x, 100)`, `y = grains(x, 50)`, and `y = grains(x, 25)` and click **Fit**.

### Loads and coils

| Problem | Type | Answer |
| --- | --- | --- |
| Sensible heat (1200 CFM, 20 °F) | `sensibleheat(1200, 20)` | 25,920 Btu/h |
| Latent heat (1200 CFM, 10 grains) | `latentheat(1200, 10)` | 8,160 Btu/h |
| Total heat (1200 CFM, 5 Btu/lb) | `totalheat(1200, 5)` | 27,000 Btu/h |
| CFM for 36,000 Btu/h at 20 °F | `airflow(36000, 20)` | 1666.67 CFM |
| Coil by dry bulb and %RH | `coil(1200, 75, 50, 55, 90)` | 31,135 Btu/h, 2.59 tons, SHR 0.824, 0.61 gal/h |
| Coil by wet bulb | `coilwb(1200, 75, 62.55, 55, 53.2)` | ~2.6 tons |
| Water heat (10 GPM, 12 °F) | `waterheat(10, 12)` | 60,000 Btu/h |

The 1.08, 0.68, 4.5, and 500 factors assume standard air and water (pass altitude as the third input on air functions to adjust). `coil` uses full state enthalpy, so it differs slightly from standard-air shortcuts.

### Refrigerants

Supported: R-12, R-22, R-123, R-134a, R-32, R-290, R-404A, R-407C, R-410A, R-448A, R-449A, R-454B, R-507A, R-513A, R-600a, R-717, R-744, R-1233zd, R-1234yf, and R-1234ze (`"R-410A"`, `"r410a"`, and `"410A"` all work).

| Problem | Type | Answer |
| --- | --- | --- |
| Pressures at 40 °F | `ptchart("R410A", 40)` | 118.79 psig bubble, 118.36 psig dew |
| Saturation temps at 70 psig | `sattemp("R407C", 70)` | 33.55 °F bubble, 44.54 °F dew, 10.99 °F glide |
| Superheat (118 psig, 50 °F suction) | `superheat("R410A", 118, 50)` | 10.16 °F |
| Subcooling (340 psig, 95 °F liquid) | `subcool("R410A", 340, 95)` | 9.61 °F |
| Fixed-orifice target superheat | `targetsuperheat(62, 85)` | 10.5 °F |
| Saturated properties | `refprops("R134a", 40)` | 24.87 and 108.78 Btu/lb, latent 83.91 |
| Refrigeration cycle | `refcycle("R454B", 45, 105, 10, 10, 70)` | COP 4.682, EER 15.98, 0.751 kW/ton, 168.1 °F discharge |

Superheat uses dew temperature and subcooling uses bubble temperature (important on blends with glide). Gauge pressures assume sea level; pass altitude in ft at the end to adjust. `refcycle` ignores line losses, counts suction superheat as useful cooling, and zeros enthalpy at saturated liquid -40 °F. Always check the equipment's charging chart before charging a system.

### Ducts, fans, pipes, and units

| Problem | Type | Answer |
| --- | --- | --- |
| Round duct (1000 CFM, 0.1 in. w.c./100 ft) | `ductsize(1000, 0.1)` | 13.65 in |
| Velocity in 14 in duct | `ductvel(1000, 14)` | 935 FPM |
| Friction loss in 14 in duct | `ductloss(1000, 14)` | 0.088 in. w.c./100 ft |
| Round equivalent of 18 × 10 duct | `eqdia(18, 10)` | 14.51 in |
| Velocity from 0.1 in. w.c. Pitot | `velfromvp(0.1)` | 1266 FPM |
| Fan laws (900 to 1080 rpm) | `fanlaws(1000, 0.5, 0.25, 900, 1080)` | 1200 CFM, 0.72 in., 0.432 BHP |
| Fan power at 60% efficiency | `fanpower(1000, 0.8, 60)` | 0.21 BHP |
| Pump power (30 GPM, 40 ft, 65%) | `pumppower(30, 40, 65)` | 0.47 BHP |
| Copper pipe loss (10 GPM, 1.025 in ID) | `pipeloss(10, 1.025, 150)` | 6.2 ft per 100 ft |
| Gas meter clocking (1 ft³ in 36 s) | `gasinput(1, 36)` | 100,000 Btu/h |

`ductloss` and `ductsize` assume galvanized duct and standard air. `convert` also handles HVAC pressure (`"psi"`, `"inHg"`, `"in. w.c."`, `"ftH2O"`, `"mTorr"`), power (`"Btu/h"`, `"MBH"`, `"TR"`, `"hp"`, `"ton"`), energy (`"Btu"`, `"therm"`, `"kWh"`), flow (`"CFM"`, `"L/s"`, `"GPM"`), `"Btu/lb"`, `"gr/lb"`, `"fpm"`, and temperature deltas (`"dF"`, `"dC"`).
