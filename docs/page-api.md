# Page API

The web app exposes `window.slopculator` for scripts and agents. Run `slopculator.help()` in the browser console for the full method list.

```js
slopculator.evaluate('normalcdf(350, 500, 400, 50)')   // { ok: true, result: '0.81859461412', ... }
slopculator.addLine('zscore(180, 280, 40)')            // adds a line, returns its result
slopculator.lines()                                    // every line with result or error
slopculator.setSettings({ deg: false, theme: 'oled' })
slopculator.usage('invNorm')                           // signature and usage
slopculator.graph.png()                                // graph PNG as a data URL
```

## Opening lines from a URL

Opening `index.html#q=normalcdf(-inf,-2.5)&q=zscore(180,280,40)` (or `/app#q=...` on the hosted site) appends those lines to the open sheet as one undoable step.

- Limit: 50 lines, 1,000 characters each.
- Lines that try to redefine a built-in function or an existing sheet variable are skipped.
- Only the `#` fragment is read (`?q=` is ignored), so browsers never send the math to a server.

Every UI control carries an accessible label, so tools like Playwright can drive the page by role and name (as `scripts/e2e.mjs` does).
