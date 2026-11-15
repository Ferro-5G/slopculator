# Working in this repository

Slopculator is one calculator engine with several front ends. Read [docs/architecture.md](docs/architecture.md) for how the pieces fit and how to add a function, and [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branches and code style. This file is what those two don't say.

## What lives where

```
src/engine/   the math, with no dependencies and no DOM
src/ui/       logic every front end shares, with no DOM
src/app/      the web app, which Tauri also wraps for Windows
src-tauri/    the Windows shell
test/         vitest, plus scripts/e2e.mjs for the built app in Chrome
mobile/       the phone app, in checkouts that have it; it has its own AGENTS.md
```

## Which layer may import which

- `src/engine` imports nothing outside itself.
- `src/ui` imports only itself and `src/engine`, and uses no browser or Node globals.
- Platforms (`src/app`, `src-tauri`, `mobile`) import shared code. Shared code never imports a platform.

`@engine` is `src/engine` and `@shared` is `src/ui`. `npm run lint` checks these.

## Parity

A feature or behavior reaches every front end together, unless the platform is the reason it differs. Shared rules go in `src/ui`, not per platform. If you are about to write the same rule a second time for another platform, move it to `src/ui` first.

## Dangers

- A slider's range comes from its value (`wholeAwareRange`). Take the range when a drag starts and hold it until release, or the track moves under the finger.
- The browser suite reads `dist/index.html`. Rebuilding `dist` while it runs swaps the app under the remaining checks.
- On Windows over SSH, the links in `.cargo\bin` fail. `node scripts/windows-dev.mjs windows-build` puts the toolchain's own `bin` (under `.rustup\toolchains`) first on `PATH`; do the same before running Cargo by hand.
- The engine also runs on phones, where the JavaScript engine has a lower BigInt limit (65,536 bits) than Node. Keep exact arithmetic inside the limits in `src/engine/exact.ts`.

## How to verify

| When | Run |
| --- | --- |
| Any change | `npm run lint`, `npm run typecheck`, `npm test` |
| Anything visible on the web or desktop | `npm run build`, then `npm run e2e` |
| Before asking for review | `npm run verify`, which is the list CI runs |

The browser suite and native builds are heavy, so run one at a time.

`npm run lint` enforces three things beyond the layers above:

- Failures are read through `readError` and `isWarningNote` in `src/engine/errors.ts`, never by testing their wording.
- A file can't gain a `setTimeout` or `sleep` past its number in `scripts/lint-baseline.json`. Wait on a real condition. If a timer is the right tool, say why in a comment at the call and raise the number.
- When a file loses a timer, the lint lowers its number. Commit that change.
