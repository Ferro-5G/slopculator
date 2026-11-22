# Contributing

## Setup

Needs Node 22 or newer:

```sh
npm install
npm run dev
```

## Checks

```sh
npm run lint           # scripts/lint.mjs: error reading, timers, layer imports
npm run typecheck      # tsc-rs
npm test               # vitest
npm run build          # dist/index.html
npm run e2e            # drives dist/index.html in Chrome
npm run verify         # runs all of the above in order
```

CI runs `lint`, `typecheck`, `test`, and `build` on pull requests (`e2e` runs on manual dispatch). Run `npm run verify` locally before asking for review.

## Branches and pull requests

Branch from `main` and open one pull request per change against `main`. `release` only moves when cutting a release (see [docs/releasing.md](docs/releasing.md)).

Write commit messages and PR descriptions plainly: what changed and why. Add visible changes under `[Unreleased]` in `CHANGELOG.md`.

## Code guidelines

- Keep `src/engine/` dependency-free and DOM-free so it runs in the browser, Node, and on phones.
- The web app uses no UI framework; views are created once and updated in place.
- Error messages should be plain sentences, like `fail('Division by zero')`.
- See [docs/architecture.md](docs/architecture.md) for how to add a function (a `def(...)`, tests, and keypad/thumb-index entries if it belongs on the keys).
- Single quotes, two-space indentation, and match surrounding code.

## Reporting bugs

Open an issue with the exact lines you typed, what you expected, and what happened. Modes matter (`sin(30)` in Deg vs. Rad is a different case). For security issues, see [SECURITY.md](SECURITY.md).
