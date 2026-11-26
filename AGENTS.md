# Working in this repository

Slopculator is one calculator engine with several front ends. Read [docs/architecture.md](docs/architecture.md) for how the pieces fit and how to add a function, and [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branches and code style. This file is what those two don't say.

## What lives where

```
src/engine/   the math, with no dependencies and no DOM
src/ui/       logic every front end shares, with no DOM
src/app/      the web app
site/         the website around the hosted app: landing page, /privacy, their stylesheet and screenshots
test/         vitest, plus scripts/e2e.mjs for the built app in Chrome
mobile/       the phone app, in checkouts that have it; it has its own AGENTS.md
```

## Which layer may import which

- `src/engine` imports nothing outside itself.
- `src/ui` imports only itself and `src/engine`, and uses no browser or Node globals.
- Platforms (`src/app`, and `mobile` where it exists) import shared code. Shared code never imports a platform.

`@engine` is `src/engine` and `@shared` is `src/ui`. `npm run lint` checks these.

## Parity

A feature or behavior reaches every front end together, unless the platform is the reason it differs. Shared rules go in `src/ui`, not per platform. If you are about to write the same rule a second time for another platform, move it to `src/ui` first.

## Dangers

- A slider's range comes from its value (`wholeAwareRange`). Take the range when a drag starts and hold it until release, or the track moves under the finger.
- The browser suite reads `dist/index.html`. Rebuilding `dist` while it runs swaps the app under the remaining checks.
- The engine also runs on phones, where the JavaScript engine has a lower BigInt limit (65,536 bits) than Node. Keep exact arithmetic inside the limits in `src/engine/exact.ts`.

## How to verify

| When | Run |
| --- | --- |
| Any change | `npm run lint`, `npm run typecheck`, `npm test` |
| Anything visible on the web or desktop | `npm run build`, then `npm run e2e` (or `npm run cli -- ...` / `npm run fuzz:ui` / `npm run perf:ui`) |
| Before asking for review | `npm run verify`, which is the list CI runs |

The browser suite and native builds are heavy, so run one at a time. See [docs/feature-map.md](docs/feature-map.md) for feature names and CLI verification recipes, and [docs/statecharts.md](docs/statecharts.md) for interactive state machines.

`npm run lint` enforces these rules beyond the shared layers above:

- Failures are read through `readError` and `isWarningNote` in `src/engine/errors.ts`, never by testing their wording.
- `console.log` is disallowed in `src/` and `mobile/src/`.
- Files outside `mobile/` and `src-tauri/` cannot statically import from those directories (`src/`, `test/`, and `site/` cannot import from them at all).
- Inside `mobile/src/`, `state/` and `lib/` stay below `components/` and `app/`, and `components/` does not import from `app/`.
- Stray Markdown files outside `docs/` and the repo root docs fail lint.
- A file can't gain a `setTimeout`/`sleep`, `requestAnimationFrame`, or `useEffect` (in `mobile/src/`) past its number in `scripts/lint-baseline.json` or `mobile/lint-baseline.json`. Wait on a real condition, derive state during render, or run work in an event handler. If one is truly needed, say why in a comment at the call and raise the number.
- When a file loses one, the lint lowers its number. Commit that change.
