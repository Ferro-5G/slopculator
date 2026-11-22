# Hosting the web app

A hosted build creates a small static site: the landing page at `/`, the app at `/app` (the same single-file bundle as the release), and the privacy policy at `/privacy`. Cloudflare Pages hosts `slopculator.com`, though any static host that supports response headers and clean URLs (`/app` -> `app.html`) works.

## Building the site

Run with `SITE_URL` set to your live URL (with a trailing slash):

```sh
SITE_URL=https://your.domain/ npm run build
```

Without `SITE_URL`, `npm run build` outputs only `dist/index.html` (the standalone offline app). With `SITE_URL`, `dist/` gets:

| File | Purpose |
| --- | --- |
| `index.html` | Landing page from `site/index.html` |
| `app.html` | The app, with canonical and Open Graph tags pointing at `SITE_URL` |
| `privacy.html` | Privacy policy built from `site/privacy.html` and `src/ui/privacy.ts` |
| `_headers` | Security headers in Cloudflare's format |
| `preview.png`, `sitemap.xml`, `robots.txt` | Link preview image and crawler files |

The landing and privacy pages run no scripts and inline their fonts and WebP screenshots so the app's strict CSP applies everywhere. `_headers` pins the exact SHA-256 hash of `app.html`'s module script, so always deploy `dist/` together.

`npm run e2e` runs `scripts/site-e2e.mjs` at the end to test the built site in Chrome under its real CSP headers. The screenshots in `site/` are Modern Dark WebPs (`1440x900` at 2x and `390x844` at 3x); retake them after major visual changes.

## Cloudflare Pages setup

1. In Cloudflare Dashboard -> Workers & Pages, create a Pages project connected to the GitHub repo.
2. Build settings:
   - Production branch: `release`
   - Framework preset: None
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variables: `SITE_URL=https://your.domain/` and `NODE_VERSION=22`
3. Attach your custom domain under Custom domains.
4. Deploy, then verify the security headers and open the app:

   ```sh
   curl -sI https://your.domain/app | grep -iE 'content-security|strict-transport|x-frame'
   ```

5. Set preview branches to None unless you want per-branch preview deploys.

Because `SITE_URL` is baked in at build time, redeploy after changing it. To deploy without Git:

```sh
SITE_URL=https://your.domain/ npm run build && npx wrangler pages deploy dist --project-name slopculator
```

### Cloudflare features to keep off

Leave these disabled so Cloudflare doesn't inject analytics or rewrite HTML (which breaks the CSP script hash):

- Web Analytics (Metrics tab)
- Zaraz
- Custom domain zone settings: Bot Fight Mode, Rocket Loader, Email Address Obfuscation, Client-side security, and HTML minification/rewriting
- Real User Measurements (RUM): Cloudflare enables this on free custom domains by default. Add the domain in Web Analytics, open Manage site, choose Disable, and save.
- Network Error Logging (zone Network settings): Pages still sends a `Nel` header on custom domains even with this off, which is why the privacy policy discloses it.

To verify no analytics script is being injected into browser responses:

```sh
curl -s -A "Mozilla/5.0 Chrome/142" -H "Accept: text/html" https://your.domain/ | grep -c cloudflareinsights
```

### Custom domain notes

Point `SITE_URL` at your custom domain and optionally add a Bulk Redirect from `*.pages.dev` to it (each origin keeps separate browser `localStorage`). Because `Strict-Transport-Security` includes subdomains, every subdomain must serve HTTPS. Give Slopculator its own domain or subdomain so other pages on the same origin can't read saved sheets.

## Updating the privacy policy

Edit `src/ui/privacy.ts`, bump `PRIVACY_UPDATED`, and regenerate `PRIVACY.md` (`test/privacy.test.ts` fails if they diverge):

```sh
node -e "import('./src/ui/privacy.ts').then(m=>require('fs').writeFileSync('PRIVACY.md', m.privacyMarkdown()))"
```
