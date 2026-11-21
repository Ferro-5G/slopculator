# Page API

The web page exposes `window.slopculator`, so scripts and AI agents can use the calculator without clicking. Run `slopculator.help()` in the browser console for the full list.

```js
slopculator.evaluate('normalcdf(350, 500, 400, 50)')   // { ok: true, result: '0.81859461412', ... }
slopculator.addLine('zscore(180, 280, 40)')            // adds a line, returns its result
slopculator.lines()                                    // every line with result or error (not the composer's empty new line)
slopculator.setSettings({ deg: false, theme: 'oled' })
slopculator.usage('invNorm')                           // how to call it
slopculator.graph.png()                                // data URL of the graph
```

Opening `index.html#q=normalcdf(-inf,-2.5)&q=zscore(180,280,40)` (on the website, `/app#q=…`) adds those lines to the open sheet as one step that Undo takes back. A link adds at most 50 lines of up to 1,000 characters each, and leaves out any line that would redefine a built-in function or a name the sheet already defines. Only the part after `#` is read, since browsers never send it to the server; a `?q=` query does nothing. Every control has a label, so accessibility-tree tools like Playwright can drive the page by role and name. `scripts/e2e.mjs` does exactly that.
