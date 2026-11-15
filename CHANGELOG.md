# Changelog

Notable changes, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1-alpha] - 2026-11-15

- On slopculator.com, the logo in the app's header goes back to the home page. Before, clicking the word Slopculator beside it opened Save.
- The privacy policy mentions the error reports a browser may send Cloudflare when it can't reach the site.

## [0.1.0-alpha] - 2026-11-15

The first public version.

### Calculator

- Lines that share: `a = 3` gets a slider, `f(x) = x^2` can be called and is graphed, `ans` is the line above, and line letters (`A`, `B`, …) refer to earlier answers.
- Exact answers: `0.1 + 0.2` is 3/10, `sin(30°)` is 1/2, whole numbers keep every digit (`2^64`, `25!`), and roots, logs and trig show only digits that are proven.
- Math typed the way it's written: `2x`, `3(4 + 5)`, `sin 30`, `√16`, `|x|`, `5!`, `x²`. Missing closing brackets are filled in, and a line that may not mean what you intended (`-3^2`, `1/2x`) gets a one-click rewrite.
- 258 functions: statistics and regressions; normal, binomial, t, χ², F, Poisson and geometric distributions; matrices and vectors; derivatives, integrals, sums and `solve`; number theory, geometry, finance, unit and base conversion; and moist-air, refrigerant, duct and fan functions for HVAC.
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

### Known gaps

- Results below 1e-14 round to 0.
- `integral` can miss a spike much narrower than a hundredth of its range, such as a normal curve with σ = 0.001 integrated from 0 to 1. Put the bounds close around the spike. The t, χ², F and Poisson functions lose accuracy at df or λ around 1e12 and above.
- A line that takes more than 2 seconds, or a sheet that takes more than 6 in all, stops with an error instead of freezing the page.
- iOS and Android apps are in development and not part of this release.

[Unreleased]: https://github.com/Ferro-5G/slopculator/compare/v0.1.1-alpha...HEAD
[0.1.1-alpha]: https://github.com/Ferro-5G/slopculator/compare/v0.1.0-alpha...v0.1.1-alpha
[0.1.0-alpha]: https://github.com/Ferro-5G/slopculator/releases/tag/v0.1.0-alpha
