# Page API

The web page exposes `window.slopculator`, so scripts and AI agents can use the calculator without clicking. Run `slopculator.help()` in the browser console for the full list.

```js
slopculator.evaluate('normalcdf(350, 500, 400, 50)')   // { ok: true, result: '0.81859461412', ... }
slopculator.addLine('zscore(180, 280, 40)')            // adds a line, returns its result
slopculator.lines()                                    // every line with result or error
slopculator.setSettings({ deg: false, theme: 'oled' })
slopculator.usage('invNorm')                           // how to call it
slopculator.graph.png()                                // data URL of the graph
```

Opening `index.html#q=normalcdf(-inf,-2.5)&q=zscore(180,280,40)` adds those lines. Every control has a label, so accessibility-tree tools like Playwright can drive the page by role and name. `scripts/e2e.mjs` does exactly that.
