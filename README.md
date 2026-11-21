# Slopculator

[![CI](https://github.com/Ferro-5G/slopculator/actions/workflows/ci.yml/badge.svg)](https://github.com/Ferro-5G/slopculator/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A keyboard-first calculator and grapher. Type expressions one per line, read each answer on the right, and anything with an `x` is drawn on the graph. One TypeScript engine with no dependencies computes every answer.

![Slopculator in the Modern look: a sheet of lines on the left, the graph on the right](docs/images/modern.png)

It was built for Algebra 2 homework (Acellus units 7 to 13) and grew past it: exact arithmetic, statistics and distributions, matrices, calculus, regressions, unit conversion, and HVAC engineering. 296 functions in all.

## Quick start

With Node 22 or newer:

```sh
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # dist/index.html, one file that works offline
```

`dist/index.html` makes no network requests. Open it in any browser, or add it to a phone's home screen.

## Platforms

| Platform | How | More |
| --- | --- | --- |
| Web | Download the page from the [latest release](https://github.com/Ferro-5G/slopculator/releases/latest), or `npm run build` and open `dist/index.html` | [Using the app](docs/using.md) |

iOS and Android apps are in development and aren't in this repository yet.

## Hosting the web app

`npm run build` makes `dist/index.html`, a single file with no network requests, so any static host can serve it as `index.html`. For a real site, build with its address:

```sh
SITE_URL=https://calc.example.com/ npm run build
```

That makes a small website: a landing page at `/`, the app at `/app`, the privacy policy at `/privacy`, a social preview image, `sitemap.xml`, `robots.txt`, and a `_headers` file of security headers whose script hash matches the build. Upload everything in `dist/`. [docs/hosting.md](docs/hosting.md) covers Cloudflare Pages, the settings to leave off, and custom domains.

## What it does

- **Lines that share.** `a = 3` gets a slider. `f(x) = x^2` can be called and is graphed. `ans` is the line above, and line letters (`A`, `B`, …) refer to earlier answers.
- **Exact results.** `2^64` keeps every digit, `0.1 + 0.2` is 3/10, and roots, logs, and trig show only digits that are proven.
- **Statistics.** Normal, binomial, t, χ², F, Poisson, and geometric distributions. Regressions. A normal curve on the graph with its shaded probability.
- **Graphing.** `y = …`, `x = …`, implicit curves, inequalities, points, piecewise, and domain restrictions. Hover to trace. Zeros, extrema, and intersections are marked.
- **Matrices, vectors, calculus, number theory, geometry, finance, unit and base conversion.**
- **HVAC.** Psychrometrics with altitude, loads and coils, 20 refrigerants, ducts, fans, pumps, and pipes. Checked against PsychroLib and CoolProp.
- **Keyboard first.** Every control works without a mouse and has a label for screen readers. Two looks, Modern and Retro, each in Light, Dark, OLED black, and High contrast.

Every function is listed in [docs/functions.md](docs/functions.md).

## Documentation

| | |
| --- | --- |
| [Guide](docs/guide.md) | Worked homework examples, unit by unit, and HVAC field problems |
| [Functions](docs/functions.md) | Every function, by area |
| [Using the app](docs/using.md) | Keyboard shortcuts, phones, themes, accessibility |
| [Page API](docs/page-api.md) | Driving the web page from scripts and AI agents |
| [Architecture](docs/architecture.md) | How the engine and its front ends fit together |
| [Releasing](docs/releasing.md) | Branches, version numbers, and how a release is cut |
| [Hosting](docs/hosting.md) | Serving the web app, its headers, and Cloudflare Pages |
| [Changelog](CHANGELOG.md) | What changed in each version |
| [Roadmap](docs/roadmap.md) | What comes next |

## Contributing

Bug reports and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup and the checks to run. `npm run verify` runs all of them.

## Privacy

Slopculator collects nothing. Your sheets stay in your browser, and the page makes no network requests. The full policy is in [PRIVACY.md](PRIVACY.md) and under File > Privacy in the app.

## License

MIT. See [LICENSE](LICENSE). Bundled fonts and libraries keep their own licenses, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
