/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
// With their extensions, as in the modules these import: Node loads this file and what it imports as written.
import { DESKTOP_QUERY, PHONE_QUERY } from './src/app/breakpoints.ts';
import { paletteCss } from './src/ui/webtokens.ts';
import { escapeHtml, PRIVACY_INTRO, privacyHtml } from './src/ui/privacy.ts';

/**
 * Every manifest carries its own copy of the version, so a mismatch stops the build. A platform directory (src-tauri,
 * mobile) is compared only when it is in the checkout. iOS doesn't accept a prerelease suffix, so its two copies leave it off.
 */
function checkVersions(): void {
  const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
  const { version } = JSON.parse(read('./package.json')) as { version: string };
  const copies: Record<string, string | undefined> = {};
  const expected: Record<string, string> = {};
  if (existsSync(fileURLToPath(new URL('./src-tauri/tauri.conf.json', import.meta.url)))) {
    copies['src-tauri/tauri.conf.json'] = (JSON.parse(read('./src-tauri/tauri.conf.json')) as { version: string }).version;
    copies['src-tauri/Cargo.toml'] = /^version = "(.+)"$/m.exec(read('./src-tauri/Cargo.toml'))?.[1];
    expected['src-tauri/tauri.conf.json'] = expected['src-tauri/Cargo.toml'] = version;
  }
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

/** The headers every response of a hosted copy carries, from docs/hosting.md. `script` is the app's module script. */
function siteHeaders(script: string): string {
  const hash = createHash('sha256').update(script).digest('base64');
  const csp = [
    "default-src 'none'", `script-src 'sha256-${hash}'`, "style-src 'unsafe-inline'", 'font-src data:', 'img-src data:',
    "connect-src 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'", "frame-ancestors 'none'",
  ].join('; ');
  const off = ['accelerometer', 'autoplay', 'camera', 'display-capture', 'encrypted-media', 'fullscreen', 'geolocation', 'gyroscope', 'hid',
    'idle-detection', 'magnetometer', 'microphone', 'midi', 'payment', 'picture-in-picture', 'publickey-credentials-get', 'screen-wake-lock',
    'serial', 'usb', 'xr-spatial-tracking', 'clipboard-read'].map((f) => `${f}=()`);
  return [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    `  Permissions-Policy: ${[...off, 'clipboard-write=(self)', 'web-share=(self)'].join(', ')}`,
    '  Strict-Transport-Security: max-age=63072000; includeSubDomains',
    '  Cross-Origin-Opener-Policy: same-origin',
    '  Cross-Origin-Resource-Policy: same-origin',
    '  X-Frame-Options: DENY',
    // Cloudflare's Network Error Logging. Pages sends it on custom domains even with the domain's switch off. The
    // privacy policy discloses it in case these lines don't remove it.
    '  ! Nel',
    '  ! Report-To',
    '',
  ].join('\n');
}
const moduleScript = (html: string) => /<script type="module"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];

/** The fonts the website uses, inlined, since the content security policy only lets fonts come from data: URLs. */
function siteFonts(): string {
  const faces: [string, string, number][] = [['Geist Sans', 'geist-sans', 400], ['Geist Sans', 'geist-sans', 500], ['Geist Sans', 'geist-sans', 600], ['Geist Sans', 'geist-sans', 700], ['Geist Mono', 'geist-mono', 400]];
  return faces.map(([family, pkg, weight]) => {
    const data = readFileSync(resolve('node_modules/@fontsource', pkg, 'files', `${pkg}-latin-${weight}-normal.woff2`)).toString('base64');
    return `@font-face { font-family: '${family}'; font-weight: ${weight}; font-style: normal; font-display: swap; src: url(data:font/woff2;base64,${data}) format('woff2'); }`;
  }).join('\n');
}
const dataUrl = (file: string, type: string) => `data:${type};base64,${readFileSync(resolve(file)).toString('base64')}`;
/** Fills a page in site/ : each {{name}} becomes vars[name], and a name with no value stops the build. */
function sitePage(file: string, vars: Record<string, string>): string {
  return readFileSync(resolve('site', file), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    if (!(name in vars)) throw new Error(`site-meta: site/${file} wants {{${name}}}`);
    return vars[name];
  });
}

/**
 * For a hosted copy: `SITE_URL=https://example.com/ npm run build` makes a website. The landing page (site/index.html)
 * becomes index.html, the app moves to app.html (served at /app), and the build adds /privacy, the social preview
 * image, a sitemap and a `_headers` file (Cloudflare's format) whose script hash matches this build's app.
 * Without SITE_URL the build stays the single app file that works from anywhere.
 */
function siteMeta(): Plugin {
  const raw = process.env.SITE_URL;
  const site = raw ? new URL(raw.endsWith('/') ? raw : `${raw}/`).href : null;
  let outDir = 'dist';
  return {
    name: 'site-meta',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml(html) {
      if (!site) return html;
      return html.replace('</head>', `    <link rel="canonical" href="${site}app" />\n    <meta name="slopculator-home" content="./" />\n    <meta property="og:url" content="${site}app" />\n    <meta property="og:image" content="${site}preview.png" />\n  </head>`);
    },
    generateBundle() {
      if (!site) return;
      this.emitFile({ type: 'asset', fileName: 'preview.png', source: readFileSync(resolve('docs/images/modern.png')) });
      const urls = [site, `${site}app`, `${site}privacy`].map((u) => `<url><loc>${u}</loc></url>`).join('');
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n` });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\nSitemap: ${site}sitemap.xml\n` });
    },
    // After the single-file plugin has inlined the script, so the hash is of what the app actually runs.
    closeBundle() {
      if (!site) return;
      const app = readFileSync(resolve(outDir, 'index.html'), 'utf8');
      const script = moduleScript(app);
      if (script === undefined) throw new Error('site-meta: no module script in index.html to hash');
      writeFileSync(resolve(outDir, '_headers'), siteHeaders(script));
      renameSync(resolve(outDir, 'index.html'), resolve(outDir, 'app.html'));
      const icon = /<link rel="icon"[^>]*>/.exec(readFileSync(resolve('index.html'), 'utf8'))?.[0] ?? '';
      const shared = { icon, logo: /href="([^"]*)"/.exec(icon)?.[1] ?? '', fonts: siteFonts(), css: readFileSync(resolve('site/site.css'), 'utf8') };
      const version = (JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }).version;
      writeFileSync(resolve(outDir, 'index.html'), sitePage('index.html', {
        ...shared,
        head: `<link rel="canonical" href="${site}" />\n    <meta property="og:url" content="${site}" />\n    <meta property="og:image" content="${site}preview.png" />`,
        version: `v${version}`,
        desktop: dataUrl('site/app-desktop.webp', 'image/webp'),
        phone: dataUrl('site/app-phone.webp', 'image/webp'),
      }));
      writeFileSync(resolve(outDir, 'privacy.html'), sitePage('privacy.html', {
        ...shared,
        head: `<link rel="canonical" href="${site}privacy" />`,
        intro: escapeHtml(PRIVACY_INTRO),
        policy: privacyHtml(),
      }));
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
