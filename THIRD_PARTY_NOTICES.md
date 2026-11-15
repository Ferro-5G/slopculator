# Third-party notices

Slopculator's own code is under the MIT License (see [LICENSE](LICENSE)). The builds include the following third-party software and fonts under their own licenses.

## Bundled in the web app (`dist/index.html`)

| Component | License | Notes |
| --- | --- | --- |
| IBM Plex Sans, IBM Plex Sans Condensed, IBM Plex Mono (via @fontsource) | SIL Open Font License 1.1 | Latin and Greek subsets are embedded in the single-file build. Copyright IBM Corp. "Plex" is a reserved font name. |
| Geist Sans, Geist Mono (via @fontsource) | SIL Open Font License 1.1 | Latin subsets are embedded in the single-file build. Copyright 2023 Vercel, made in collaboration with basement.studio. Exponent glyphs drawn from Geist Mono are added to the fonts bundled in the apps and to `src/assets/Superscripts.woff2`. |

## HVAC data and equations

`src/engine/hvac.ts` follows PsychroLib (MIT, copyright The PsychroLib Contributors) for moist-air properties, using equations and coefficients from the 2017 ASHRAE Handbook of Fundamentals, chapter 1. `src/engine/refrigerants-data.ts` holds values computed with CoolProp (MIT, copyright Ian Bell and others). Saturation pressures for R-448A, R-449A, and R-454B are scaled to published tables from Honeywell and Chemours. Neither library is bundled; `scripts/build-hvac-data.py` uses them to generate the data and test values.


## Build tools (not shipped)

Vite, vitest, tsc-rs, TypeScript and playwright-core are used only to build and test.

Full license texts come with each package in `node_modules`. Check this list against the lockfiles before each release.
