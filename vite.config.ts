/// <reference types="vitest/config" />
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
// With their extensions, as in the modules these import: Node loads this file and what it imports as written.
import { DESKTOP_QUERY, PHONE_QUERY } from './src/app/breakpoints.ts';
import { paletteCss } from './src/ui/webtokens.ts';

/**
 * Every manifest carries its own copy of the version, so a mismatch stops the build. The mobile app is only compared
 * when its directory is in the checkout. iOS doesn't accept a prerelease suffix, so its two copies leave it off.
 */
function checkVersions(): void {
  const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
  const { version } = JSON.parse(read('./package.json')) as { version: string };
  const copies: Record<string, string | undefined> = {
    'src-tauri/tauri.conf.json': (JSON.parse(read('./src-tauri/tauri.conf.json')) as { version: string }).version,
    'src-tauri/Cargo.toml': /^version = "(.+)"$/m.exec(read('./src-tauri/Cargo.toml'))?.[1],
  };
  const expected: Record<string, string> = { 'src-tauri/tauri.conf.json': version, 'src-tauri/Cargo.toml': version };
  if (existsSync(fileURLToPath(new URL('./mobile/package.json', import.meta.url)))) {
    copies['mobile/package.json'] = (JSON.parse(read('./mobile/package.json')) as { version: string }).version;
    copies['mobile/app.json'] = (JSON.parse(read('./mobile/app.json')) as { expo: { version: string } }).expo.version;
    expected['mobile/package.json'] = expected['mobile/app.json'] = version.split('-')[0];
  }
  const wrong = Object.keys(copies).filter((file) => copies[file] !== expected[file]);
  if (wrong.length) {
    throw new Error(`Version mismatch with package.json ${version}: ${wrong.map((file) => `${file} has ${copies[file]}, expected ${expected[file]}`).join('; ')}`);
  }
}
checkVersions();

/**
 * @fontsource lists a .woff fallback after every .woff2. Every browser and webview the app runs in loads the
 * .woff2, so the fallback is never fetched, but the single-file build would inline it anyway: about 500 KB.
 */
function woff2Only(): Plugin {
  return {
    name: 'woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@fontsource') || !id.endsWith('.css')) return null;
      return { code: code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, ''), map: null };
    },
  };
}

/** The stylesheets write @media (--phone) and (--desktop); this fills in the queries from one place. */
function sharedBreakpoints(): Plugin {
  return {
    name: 'shared-breakpoints',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0].endsWith('.css') || !code.includes('@media (--')) return null;
      return { code: code.replaceAll('@media (--phone)', `@media ${PHONE_QUERY}`).replaceAll('@media (--desktop)', `@media ${DESKTOP_QUERY}`), map: null };
    },
  };
}

/** A look's stylesheet writes @palette; where its colors go; this fills them in from the palettes both platforms draw. */
function sharedColors(): Plugin {
  return {
    name: 'shared-colors',
    enforce: 'pre',
    transform(code, id) {
      const look = /\/(modern|retro)\.css(\?|$)/.exec(id)?.[1] as 'modern' | 'retro' | undefined;
      if (!look || !code.includes('@palette;')) return null;
      return { code: code.replace('@palette;', paletteCss(look)), map: null };
    },
  };
}

/**
 * For a hosted copy: `SITE_URL=https://example.com/ npm run build` adds the canonical address, the social preview
 * image and a sitemap. Without it the build stays a file that works from anywhere, the desktop app included.
 */
function siteMeta(): Plugin {
  const raw = process.env.SITE_URL;
  const site = raw ? new URL(raw.endsWith('/') ? raw : `${raw}/`).href : null;
  return {
    name: 'site-meta',
    transformIndexHtml(html) {
      if (!site) return html;
      return html.replace('</head>', `    <link rel="canonical" href="${site}" />\n    <meta property="og:url" content="${site}" />\n    <meta property="og:image" content="${site}preview.png" />\n  </head>`);
    },
    generateBundle() {
      if (!site) return;
      this.emitFile({ type: 'asset', fileName: 'preview.png', source: readFileSync(resolve('docs/images/modern.png')) });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${site}</loc></url></urlset>\n` });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\nSitemap: ${site}sitemap.xml\n` });
    },
  };
}

/**
 * The mobile app is a separate directory, mobile/, that a checkout may not have. When it's there its tests run with
 * these: the aliases from mobile/tsconfig.json (the one table of them; metro.config.js reads it too) and the native
 * packages the tests stub, which live in mobile/node_modules, so from a test their names would resolve nowhere.
 */
const MOBILE_TSCONFIG = fileURLToPath(new URL('./mobile/tsconfig.json', import.meta.url));
const STUBBED_PACKAGES: Record<string, string> = {
  'react-native': 'react-native/index.js',
  'react-native-reanimated': 'react-native-reanimated/lib/module/index.js',
  'expo-sqlite/kv-store': 'expo-sqlite/kv-store.js',
  '@shopify/react-native-skia': '@shopify/react-native-skia/lib/module/index.js',
};
function mobileTests(): { include: string[]; alias: { find: RegExp; replacement: string }[] } {
  if (!existsSync(MOBILE_TSCONFIG)) return { include: [], alias: [] };
  const mobile = dirname(MOBILE_TSCONFIG);
  const { paths } = (JSON.parse(readFileSync(MOBILE_TSCONFIG, 'utf8')) as { compilerOptions: { paths: Record<string, string[]> } }).compilerOptions;
  return {
    include: ['mobile/test/**/*.test.ts'],
    alias: [
      ...Object.entries(paths)
        .sort(([a], [b]) => b.length - a.length)
        .map(([from, [to]]) => ({ find: new RegExp(`^${from.slice(0, -1).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`), replacement: resolve(mobile, to.slice(0, -1)) + '/' })),
      ...Object.entries(STUBBED_PACKAGES).map(([name, file]) => ({ find: new RegExp(`^${name}$`), replacement: resolve(mobile, 'node_modules', file) })),
    ],
  };
}
const mobile = mobileTests();

export default defineConfig({
  base: './',
  plugins: [sharedBreakpoints(), sharedColors(), woff2Only(), siteMeta(), viteSingleFile()],
  build: { assetsInlineLimit: 100_000_000 },
  test: {
    include: ['test/**/*.test.ts', ...mobile.include],
    alias: mobile.alias,
  },
});
