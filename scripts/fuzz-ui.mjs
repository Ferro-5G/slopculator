#!/usr/bin/env node
// Runs Bombadil property-based UI fuzzing against the built web app (dist/index.html).
// Usage:
//   npm run build && node scripts/fuzz-ui.mjs [--time 20s] [--trace .shots/bombadil.bin]
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const distPath = resolve('dist/index.html');
if (!existsSync(distPath)) {
  console.error(`Missing ${distPath}. Run "npm run build" first.`);
  process.exit(1);
}

const timeLimit = option('--time', '20s');
const specPath = resolve(option('--spec', 'scripts/bombadil.spec.ts'));
const traceArg = option('--trace', null);
const tempDir = traceArg ? null : mkdtempSync(join(tmpdir(), 'slopculator-bombadil-'));
const tracePath = traceArg ? resolve(traceArg) : join(tempDir, 'trace.bin');
const url = pathToFileURL(distPath).href;

const bin = resolve('node_modules/.bin/bombadil');
const cmdArgs = [
  'browser', 'test',
  '--headless',
  '--exit-on-violation',
  '--time-limit', timeLimit,
  '--output-path', tracePath,
  '--output-path-overwrite',
  url,
  specPath,
];

try {
  const res = spawnSync(bin, cmdArgs, { stdio: 'inherit' });
  process.exitCode = res.status ?? 1;
} finally {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}
