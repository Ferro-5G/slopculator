// The Markdown at the root and in docs/: every relative link and image points at a file that exists, and the pages
// that count the functions agree with the engine.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { functions } from './sheet';

const root = fileURLToPath(new URL('../', import.meta.url));
const pages = [
  ...readdirSync(root).filter((f) => f.endsWith('.md')),
  ...readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`),
];

describe('documentation links', () => {
  it.each(pages)('%s links to files that exist', (page) => {
    const text = readFileSync(join(root, page), 'utf8').replace(/```[\s\S]*?```/g, '');
    const missing = [...text.matchAll(/\]\(([^)\s]+)\)/g)]
      .map((m) => m[1])
      .filter((to) => !/^(?:[a-z]+:|#)/i.test(to))
      .filter((to) => !existsSync(resolve(root, dirname(page), decodeURIComponent(to.split('#')[0]))));
    expect(missing).toEqual([]);
  });
});

describe('the function count', () => {
  it.each(['README.md', 'CHANGELOG.md'])('%s says how many functions there are', (page) => {
    const said = [...readFileSync(join(root, page), 'utf8').matchAll(/\b(\d{3}) functions\b/g)].map((m) => Number(m[1]));
    expect(said.length).toBeGreaterThan(0);
    expect(new Set(said)).toEqual(new Set([functions().length]));
  });
});
