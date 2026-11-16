# Hosting the web app

The hosted copy is a small website: a landing page at `/`, the app at `/app` (the same single file the release ships), and the privacy policy at `/privacy`. Cloudflare Pages serves it. Any static host works if it can set response headers and serve `app.html` at `/app`.

## What a hosted build makes

`SITE_URL=https://your.domain/ npm run build` writes these to `dist/`:

| File | What it's for |
| --- | --- |
| `index.html` | The landing page, from `site/index.html` |
| `app.html` | The app, with a canonical link and a social preview pointing at `SITE_URL` |
| `privacy.html` | The privacy policy, from `site/privacy.html` and `src/ui/privacy.ts` |
| `_headers` | Security headers, in Cloudflare's format |
| `preview.png`, `sitemap.xml`, `robots.txt` | The link preview image and the files search engines read |

Without `SITE_URL` the build is only `index.html`, the app itself, which is the file the release ships.

The landing page and the privacy page have no script. Their fonts and screenshots are inlined, so the app's content security policy covers them too. `_headers` takes the policy's script hash from this exact `app.html`. A hash from another build blanks the app, so always deploy `_headers` with the `app.html` built next to it. Deploying `dist/` as a whole does that.

`npm run e2e` ends with `scripts/site-e2e.mjs`, which builds the site into `dist-site/`, serves it with its headers, and checks every page in Chrome for errors, policy violations, outside requests and sideways scrolling.

The screenshots in `site/` are WebP files of the app in Modern Dark, 1440×900 at 2× and 390×844 at 3×. Retake them when the app's look changes.

## Cloudflare Pages

1. In the Cloudflare dashboard, open Workers & Pages, create a Pages project and connect it to the GitHub repository.
2. Set the build:
   - Production branch: `release`, so the site changes only when a release is cut
   - Framework preset: None
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variables: `SITE_URL` set to the address people will use, with a trailing slash (your custom domain, such as `https://calc.example.com/`, or the project's `https://<project>.pages.dev/`), and `NODE_VERSION` set to `22`
3. With a custom domain, add it under the project's Custom domains. If the domain's DNS is on Cloudflare, the record is made for you.
4. Deploy. Then check that the headers arrived:

   ```sh
   curl -sI https://calc.example.com/app | grep -iE 'content-security|strict-transport|x-frame'
   ```

   Then open the site, click Open Slopculator, and type a line.

5. Under the project's settings, set preview branches to None, unless you want every branch built at its own address.

`SITE_URL` only goes into the build, so after changing it, deploy again (Deployments, then Retry deployment on the latest one).

Without Git, build locally and upload: `SITE_URL=https://calc.example.com/ npm run build && npx wrangler pages deploy dist --project-name slopculator`.

### Settings to leave off

The privacy policy promises no analytics and no scripts beyond the app. Each of these would break that promise, or rewrite the page so its script hash stops matching:

- Web Analytics, on the project's Metrics tab
- Zaraz
- On a custom domain's zone: Bot Fight Mode, Rocket Loader, Email Address Obfuscation, Client-side security, and any HTML minification or rewriting
- Real User Measurements on a custom domain. Cloudflare injects its analytics script into free domains by default, and the domain doesn't show up in Web Analytics until you add it. Open Web Analytics, add the domain (it says "automatic setup"), then open Manage site, choose Disable, and click Update.
- Network Error Logging, under the domain's Network settings. Pages still sends the `Nel` header on custom domains with that switch off. `_headers` can't remove it, because Cloudflare adds it after the site's own headers, so the privacy policy discloses it.

To check for injected scripts, fetch a page the way a browser does, since Cloudflare only injects into browser requests:

```sh
curl -s -A "Mozilla/5.0 Chrome/142" -H "Accept: text/html" https://calc.example.com/ | grep -c cloudflareinsights
```

### A custom domain

`SITE_URL` should be the custom domain, so the canonical links, preview image and sitemap point there. The `pages.dev` address keeps working as a second copy with its own saved sheets, since browsers keep storage per address. Search engines follow the canonical links to the custom domain. To send people there too, add a Bulk Redirect from the `pages.dev` address to the domain.

`Strict-Transport-Security` includes subdomains, so every subdomain of the domain you use must serve HTTPS. Use a domain or subdomain of its own: the page's storage belongs to the whole origin, and any other page on it could read saved sheets.

## Changing the privacy policy

The text lives in `src/ui/privacy.ts`. The app's File menu, the `/privacy` page and `PRIVACY.md` all come from it, and a test fails if `PRIVACY.md` falls behind. After editing, rewrite it:

```sh
node -e "import('./src/ui/privacy.ts').then(m=>require('fs').writeFileSync('PRIVACY.md', m.privacyMarkdown()))"
```

Update `PRIVACY_UPDATED` in the same change.
