# Changelog

Notable changes, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

No version has been released yet. The first release moves this section under its version number and date (see [docs/releasing.md](docs/releasing.md)).

## [Unreleased]

The first public version.

### Calculator

- Lines that share: `a = 3` gets a slider, `f(x) = x^2` can be called and is graphed, `ans` is the line above, and line letters (`A`, `B`, …) refer to earlier answers.
- Exact answers: `0.1 + 0.2` is 3/10, `sin(30°)` is 1/2, whole numbers keep every digit (`2^64`, `25!`), and roots, logs and trig show only digits that are proven.
- Math typed the way it's written: `2x`, `3(4 + 5)`, `sin 30`, `√16`, `|x|`, `5!`, `x²`. Missing closing brackets are filled in, and a line that may not mean what you intended (`-3^2`, `1/2x`) gets a one-click rewrite.
- 258 functions: statistics and regressions; normal, binomial, t, χ², F, Poisson and geometric distributions; matrices and vectors; derivatives, integrals, sums and `solve`; number theory, geometry, finance, unit and base conversion; and moist-air, refrigerant, duct and fan functions for HVAC.
- Search any function by name or meaning (Ctrl+K, ⌘K on a Mac). History keeps every finished line and its full-precision answer.

### Graph

- `y = …`, `x = …`, implicit curves, inequalities, points, polygons, vectors, piecewise and domain restrictions, with zeros, extrema and intersections marked.
- A shaded normal curve with its probability, sliders under the graph, Fit and 1:1, and export as PNG or SVG.

### Platforms

- Web and Windows motion has explicit presence states, safe reversal and immediate settling when Motion is reduced or off.
- Windows: both looks and graph colors load under the packaged app's content security policy.
- Web: one HTML file that works offline. It can be hosted as a static page (see the README).
- Windows (Tauri).
- Two looks: Modern (Light, Dark, OLED black, High contrast, six accent colors) and Retro (printer paper and sculpted keycaps).

### Known gaps

- Results below 1e-14 round to 0.
- `integral` can miss a spike much narrower than a hundredth of its range, such as a normal curve with σ = 0.001 integrated from 0 to 1. Put the bounds close around the spike. The t, χ², F and Poisson functions lose accuracy at df or λ around 1e12 and above.
- The Windows installer is not code-signed, so SmartScreen warns before it runs.
- iOS and Android apps are in development and not part of this release.
