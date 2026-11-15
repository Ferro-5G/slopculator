# Guide

Worked examples for Algebra 2, units 7 to 13, and for HVAC field work. Type each line as shown and the answer appears on the right. Click any answer to copy it as plain text for an answer box.

The answers below are the ones Slopculator prints, and `test/guide.test.ts` checks every one of them against the engine. [docs/functions.md](functions.md) lists every function.

## Before you start

- **Deg or Rad** in the top bar decides how trig reads angles. Most homework is in degrees.
- **Pop / Sample** decides whether `sd` and `var` divide by n or n − 1. Acellus uses population (÷ n) unless a lesson says sample. `sdp` and `sds` always mean population and sample.
- **Round** is a slider from Auto through 15 decimal places, for every answer and for copying. Set it to what the question asks for.
- **A=line** (Ctrl+Alt+L) names lines A, B, C… so later lines can use earlier answers: `A/50`.
- **Ctrl+/** finds any function by name or by what it does.

## Exploring with sliders

Any line like `a = 2` gets a slider. Curves that use `a` move as you drag it. Write a point from two sliders and you can drag the point itself:

```
h = 1
k = -2
y = (x - h)^2 + k
(h, k)
```

The point (h, k) gets a ring on the graph. Grab it and the vertex, the parabola, and both sliders move together. The same trick works for any family of curves: `y = a(x - h)^2 + k`, `y = a sin(b(x - c)) + d`, `y = a·b^x`. Search "drag" in Ctrl+/ for this example.

## Unit 7: Exponents and logarithms

| Problem | Type | Answer |
| --- | --- | --- |
| log base 2 of 8 | `log_2(8)` or `log(2, 8)` | 3 |
| Change of base, log₃ 81 | `ln(81)/ln(3)` | 4 |
| $1000 at 5% compounded monthly for 10 years | `compound(1000, 0.05, 12, 10)` | 1647.00949769 |
| Same, compounded continuously | `continuous(1000, 0.05, 10)` | 1648.72127070 |
| How long until it doubles (monthly)? | `solve(1000(1 + 0.05/12)^(12t) = 2000, t)` | 13.8916… years |

You can also write the formula yourself with variables: `P = 1000`, `r = 0.05`, `n = 12`, `t = 10`, then `P(1 + r/n)^(nt)`. `nt` multiplies, and the power applies only to the parentheses.

## Unit 8: Rational functions

Graph with `y = 1/(x - 2) + 3`. The graph breaks cleanly at the vertical asymptote. Click the line, then hover the curve: the zeros and intersections with other curves get markers you can read exactly. Click a marker to pin its coordinates.

## Unit 9: Sequences and series

| Problem | Type | Answer |
| --- | --- | --- |
| First terms of aₙ = 2n + 1 | `seq(2n + 1, n, 1, 4)` | {3, 5, 7, 9} |
| Sum of n² for n = 1 to 10 | `sum(n^2, n, 1, 10)` | 385 |
| Define a sequence to reuse | `a(n) = 3·2^(n − 1)`, then `a(5)` | 48 |

## Unit 10: Conics

Type the equation as given and it graphs: `x^2 + y^2 = 25`, `x^2/9 + y^2/4 = 1`, `x^2/9 - y^2/4 = 1`, `y = (x - 1)^2 + 2`. Use **1:1** (square axes) so circles look round. On a phone there's no 1:1 key: the graph starts with equal axes, and **Home** brings them back after a Fit.

## Unit 11: Probability and statistics

### Counting

| Problem | Type | Answer |
| --- | --- | --- |
| Choose 3 of 8 | `nCr(8, 3)` | 56 |
| Arrange 2 of 5 | `nPr(5, 2)` | 20 |
| 3 shirts, 4 pants, 5 hats | `count(3, 4, 5)` | 60 |

### Lists

`L = {2, 4, 4, 4, 5, 5, 7, 9}`, then `mean(L)` = 5, `sdp(L)` = 2, `median(L)` = 4.5, `fivenum(L)` for a box plot.

### Normal distribution

The usual setup:

```
μ = 400
σ = 50
normaldist(μ, σ)
```

Tick **Cumulative probability** under the curve and fill in Min and Max. The shaded area and its probability show up on the graph and in the line. For P(350 < X < 500) that's **0.8186**.

| Problem | Type | Answer |
| --- | --- | --- |
| z-score of 180 when μ = 280, σ = 40 | `zscore(180, 280, 40)` | −2.5 |
| Area left of z = −2.5 | `normalcdf(-inf, -2.5)` | 0.0062 |
| P(350 < X < 500), μ = 400, σ = 50 | `normalcdf(350, 500, 400, 50)` | 0.8186 |
| Same by the empirical rule | `empirical(400, 50, 350, 500)` | 0.815 |
| Score at the 90th percentile, μ = 100, σ = 15 | `invNorm(0.9, 100, 15)` | 119.22 |
| z for 95% in the middle | `zcrit(0.95)` | 1.96 |

The empirical rule and the exact CDF differ slightly (0.815 vs 0.8186). Use whichever the question asks for.

### Binomial

| Problem | Type | Answer |
| --- | --- | --- |
| Exactly 6 heads in 7 flips | `binompdf(7, 0.5, 6)` | 0.0546875 (7/128) |
| At most 3 successes, n = 10, p = 0.3 | `binomcdf(10, 0.3, 3)` | 0.6496 |
| At least 4 | `binomge(10, 0.3, 4)` | 0.3504 |
| Mean and SD | `binomstats(10, 0.3)` | 3, 1.4491 |

### Expected value

`EV({0, 1, 2}, {0.25, 0.5, 0.25})` = 1. If the probabilities don't add to 1, Slopculator warns you. For a game with a cost, `netgain({values}, {probs}, cost)`.

Or click **+ table**, put outcomes in the `x` column and probabilities in a `P` column, and the table shows E(X) and ΣP.

### Margin of error and proportions

`moe(400)` = 0.05 (the course's 1/√n). `phat(45, 100)` = 0.45. `sep(0.45, 100)` is the standard error √(p(1 − p)/n).

## Unit 12: Matrices and vectors

| Problem | Type | Answer |
| --- | --- | --- |
| Determinant | `det([[1, 2], [3, 4]])` | −2 |
| Inverse | `inv([[1, 2], [3, 4]])` | [[−2, 1], [1.5, −0.5]] |
| Solve AX = B | `linsolve([[2, 1], [1, 3]], [3, 5])` | ⟨0.8, 1.4⟩ |
| Magnitude of ⟨3, 4⟩ | `mag(⟨3, 4⟩)` | 5 |
| Dot product | `dot([1, 2, 3], [4, 5, 6])` | 32 |
| Rotate (1, 0) by 90° | `rotation(90) * (1, 0)` | (0, 1) |
| Reflect (2, 3) over the x-axis | `reflectx * (2, 3)` | (2, −3) |

**Any size…** on the Matrix tab opens a grid if typing brackets is a pain, and **Vector…** on its Vectors page does the same for a vector. The **2 × 2** and **3 × 3** tiles put empty cells in the line: Tab, Enter, or a comma moves to the next one, and ↑/↓ move by row. `polygon((0,0), (2,0), (1,2))` draws a shape, or use **Shape…** on the Math tab's Graph page to fill in its corners one at a time, and `dilation(2) * polygon(…)` draws its image.

## Unit 13: Trigonometry

| Problem | Type | Answer |
| --- | --- | --- |
| sin 30° (Deg mode) | `sin(30)` | 0.5 |
| sin π/6 in Rad mode | `sin(pi/6)` | 0.5 |
| 30° from either mode | `sin(30°)` | 0.5 |
| Inverse sine | `asin(0.5)` | 30 (range shows under the answer) |
| Arc length, r = 10, θ = 90° | `arclen(10, 90)` | 15.708 (θ is converted to radians for you) |
| Sector area, r = 2, θ = 180° | `sector(2, 180)` | 6.2832 |
| Exact unit circle values | `unitcircle(60)` with **Exact** on | (1/2, √3/2) |
| Amplitude, period, shift | `trigform(2, 3, 1, 0)` | amplitude 2, period 120° |
| Tangent period, asymptotes | `tanform(1, 2, 0, 0)` | period 90°, asymptote at 45° |
| Every solution in a range | `solve(sin(x) = 0.5, x, 0, 360)` | {30, 150} |

To graph a transformed wave with sliders: `a = 2`, `b = 3`, `c = 1`, `d = 0`, then `y = a sin(b(x − c)) + d`. Drag the sliders and watch it change. In Rad mode the x-axis counts in π.

## HVAC

The Air, Refrig, and Flow tabs hold about 70 HVAC functions. Everything is in US units: °F, ft, CFM, psig, Btu. Add `"SI"` as the last input for °C, m, L/s, kPa, and kJ/kg, as in `enthalpy(24, 50, "SI")`. A sheet can set it once with `units = "SI"`, then `enthalpy(24, 50, units)`.

### Moist air

Relative humidity can be `50`, `50%`, or `0.5`. A value of 1 or less counts as a fraction, so `1` means 100%. Add altitude in ft as the next input where a function takes it, because thinner air changes humidity ratio, wet bulb, volume, and density.

| Problem | Type | Answer |
| --- | --- | --- |
| Everything at 75 °F, 50% RH | `psych(75, 50)` | wet bulb 62.55, dew point 55.12, 64.65 gr/lb, 28.107 Btu/lb |
| The same at 5280 ft | `psych(75, 50, 5280)` | wet bulb 61.72, 78.77 gr/lb, 30.314 Btu/lb |
| From a sling reading | `psychwb(75, 62.6)` | 50.17% RH |
| Enthalpy alone | `enthalpy(75, 50)` | 28.1066 Btu/lb |
| Dew point alone | `dewpoint(75, 50)` | 55.12 °F |
| Metric | `enthalpy(24, 50, "SI")` | 47.8146 kJ/kg |
| Return air with outdoor air | `mixair(800, 75, 50, 200, 95, 40)` | 78.89 °F, 48.38% RH |
| Percent outdoor air from temperatures | `oapercent(79, 75, 95)` | 20% |

`psychdp`, `psychw`, and `psychh` start from dew point, humidity ratio, and enthalpy. Enthalpy here is zero for dry air at 0 °F, or 0 °C in SI, as on a psychrometric chart.

For a psychrometric chart, graph `y = grains(x, 100)`, `y = grains(x, 50)`, and `y = grains(x, 25)`, then press **fit**.

### Loads and coils

| Problem | Type | Answer |
| --- | --- | --- |
| Sensible heat, 1200 CFM, 20 °F | `sensibleheat(1200, 20)` | 25,920 Btu/h |
| Latent heat, 1200 CFM, 10 grains | `latentheat(1200, 10)` | 8,160 Btu/h |
| Total heat, 1200 CFM, 5 Btu/lb | `totalheat(1200, 5)` | 27,000 Btu/h |
| CFM for 36,000 Btu/h at 20 °F | `airflow(36000, 20)` | 1666.67 CFM |
| A coil, by dry bulb and %RH | `coil(1200, 75, 50, 55, 90)` | 31,135 Btu/h, 2.59 tons, SHR 0.824, 0.61 gal/h |
| The same by wet bulb readings | `coilwb(1200, 75, 62.55, 55, 53.2)` | about 2.6 tons |
| Water, 10 GPM, 12 °F | `waterheat(10, 12)` | 60,000 Btu/h |

The 1.08, 0.68, 4.5, and 500 factors are for standard air and water. A third input on the air functions is altitude, which scales the factor by air pressure. `coil` works from each state's actual enthalpy, so it won't match the factors exactly.

### Refrigerants

Tables cover R-12, R-22, R-123, R-134a, R-32, R-290, R-404A, R-407C, R-410A, R-448A, R-449A, R-454B, R-507A, R-513A, R-600a, R-717, R-744, R-1233zd, R-1234yf, and R-1234ze. `"R-410A"`, `"r410a"`, and `"410A"` all work.

| Problem | Type | Answer |
| --- | --- | --- |
| Pressures at 40 °F | `ptchart("R410A", 40)` | 118.79 psig bubble, 118.36 psig dew |
| Temperatures at 70 psig, with the glide | `sattemp("R407C", 70)` | 33.55 °F bubble, 44.54 °F dew, 10.99 °F glide |
| Superheat: 118 psig, 50 °F suction line | `superheat("R410A", 118, 50)` | 10.16 °F |
| Subcooling: 340 psig, 95 °F liquid line | `subcool("R410A", 340, 95)` | 9.61 °F |
| Fixed-orifice target | `targetsuperheat(62, 85)` | 10.5 °F |
| Saturated properties | `refprops("R134a", 40)` | 24.87 and 108.78 Btu/lb, latent 83.91 |
| A cycle | `refcycle("R454B", 45, 105, 10, 10, 70)` | COP 4.682, EER 15.98, 0.751 kW/ton, 168.1 °F discharge |

Superheat reads the dew column and subcooling reads the bubble column, which matters on a blend with glide. Gauge pressures assume sea level. Add altitude in ft as the last input to correct them.

`refcycle` takes evaporating (dew) and condensing (bubble) temperatures, superheat, subcooling, and compressor isentropic efficiency. It leaves out line losses, and it counts all the suction superheat as useful cooling. Enthalpy in `refprops` and `refcycle` is zero for saturated liquid at -40 °F in both unit systems, so SI values differ by a constant from tables that use 200 kJ/kg at 0 °C. Differences between states are the same.

`targetsuperheat` is the common field formula. The unit's own charging chart comes first.

### Ducts, fans, and pipes

| Problem | Type | Answer |
| --- | --- | --- |
| Round duct for 1000 CFM at 0.1 in. w.c./100 ft | `ductsize(1000, 0.1)` | 13.65 in |
| Velocity in a 14 in round duct | `ductvel(1000, 14)` | 935 FPM |
| Friction in that duct | `ductloss(1000, 14)` | 0.088 in. w.c./100 ft |
| Round equal of an 18 × 10 duct | `eqdia(18, 10)` | 14.51 in |
| Pitot reading of 0.1 in. w.c. | `velfromvp(0.1)` | 1266 FPM |
| Fan from 900 to 1080 rpm | `fanlaws(1000, 0.5, 0.25, 900, 1080)` | 1200 CFM, 0.72 in., 0.432 BHP |
| Fan power at 60% efficiency | `fanpower(1000, 0.8, 60)` | 0.21 BHP |
| Pump: 30 GPM, 40 ft, 65% | `pumppower(30, 40, 65)` | 0.47 BHP |
| Copper, 10 GPM, 1.025 in inside | `pipeloss(10, 1.025, 150)` | 6.2 ft per 100 ft |
| Clocking a gas meter, 1 ft³ in 36 s | `gasinput(1, 36)` | 100,000 Btu/h |

`ductloss` and `ductsize` assume galvanized duct and standard air.

### Units

`convert` also handles pressure (`"psi"`, `"inHg"`, `"in. w.c."`, `"ftH2O"`, `"mTorr"`), power (`"Btu/h"`, `"MBH"`, `"TR"`, `"hp"`), energy (`"Btu"`, `"therm"`, `"kWh"`), flow (`"CFM"`, `"L/s"`, `"GPM"`), `"Btu/lb"`, `"gr/lb"`, `"fpm"`, and ΔT (`"dF"`, `"dC"`). `"ton"` means a ton of cooling when the other unit is power: `convert(36000, "Btu/h", "ton")` is 3. Pressure converts by scale only, so psig to kPa gives kPa gauge.

## When something goes wrong

- **A red message** under a line says what's wrong: division by zero, `nCr` with a non-whole number, a singular matrix, or `√` of a negative outside Complex mode.
- **A typo** like `normcdf` gets a **Use normalcdf** button that fixes it.
- **Unexpected answers in trig** usually mean the Deg/Rad switch is wrong.
- **Ctrl+Alt+Z** brings back a deleted line or a cleared sheet.
