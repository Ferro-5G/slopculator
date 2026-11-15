# Contributing

## Setup

```sh
npm install
npm run dev
```

Node 22 or newer.

## Checks

```sh
npm run lint           # scripts/lint.mjs: error reading, timers, layer imports
npm run typecheck      # tsc-rs
npm test               # vitest
npm run build          # dist/index.html
npm run e2e            # drives dist/index.html in Chrome (needs Google Chrome installed)
npm run verify         # all of the above, in order
```

CI runs the same list on every pull request. A pull request should pass it before review.

## Branches and pull requests

Branch from `main` and open a pull request against `main`. Keep each pull request to one change. `release` only moves when a release is cut; see [docs/releasing.md](docs/releasing.md).

Write commit messages and pull request descriptions in plain sentences: what changed and why. If the change is visible, add a line to the `[Unreleased]` section of `CHANGELOG.md`.

## Code

- The engine (`src/engine/`) has no dependencies and no DOM. Keep it that way; it runs in the browser, in Node, and on phones.
- The web app has no UI framework. Views are created once and updated in place.
- Error messages are plain sentences (ex., `fail('Division by zero')`)
- [docs/architecture.md](docs/architecture.md) explains how the pieces fit and how to add a function. A new function needs a `def(...)`, a test, and, if it belongs on the keypad, a key in `src/ui/keypad.ts` with a home in `src/ui/thumbindex.ts`.
- No formatter is configured. Single quotes, two-space indent, and otherwise match the file you are in.

## Reporting bugs

Open an issue with the line you typed, what you expected, and what you got. For a wrong answer, the exact text matters: `sin(30)` in Deg mode is a different bug from `sin(30)` in Rad mode. For a security problem, see [SECURITY.md](SECURITY.md).
