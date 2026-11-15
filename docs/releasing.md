# Releasing

## Branches

| Branch | What it is | Who pushes |
| --- | --- | --- |
| `main` | Development. Every pull request targets it. It should always pass CI, but it can be ahead of what users have. | Pull requests only |
| `release` | What users have. It only moves when a release is cut, and every commit on it is tagged. It doesn't exist until the first release. | Fast-forward merges from `main` |

Feature work branches from `main` and comes back by pull request. A hotfix for a shipped version branches from `release`, goes back to `release` by pull request, and is then merged into `main` so the fix is not lost.

Recommended branch protection for both branches, set in the repository's settings: require a pull request, require the CI check to pass, and no force pushes. On `release`, restrict who can push.

## Version numbers

The version lives in three places and must match:

- `package.json` (also `package-lock.json`)
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml` (also `Cargo.lock`)

`npm run build` stops if any of these manifests disagrees with `package.json`.

Tags are `v` plus the version in `package.json`: `v0.1.0-alpha.2`, `v0.1.0`. A prerelease is any tag with a hyphen, and the release workflow marks it as one.

## Cutting a release

1. **On `main`, by pull request:** move the `[Unreleased]` section of `CHANGELOG.md` under a heading for the new version and today's date, and bump the version numbers above. `npm run verify` must pass.
2. **Move `release` to that commit and tag it:**

   ```sh
   git fetch origin
   git checkout release 2>/dev/null || git checkout -b release origin/main
   git merge --ff-only origin/main
   git tag -a v0.1.0-alpha.2 -m "0.1.0-alpha.2"
   git push origin release v0.1.0-alpha.2
   ```

3. **The release workflow** (`.github/workflows/release.yml`) runs on the tag. It builds the single-file web app and attaches it to a draft GitHub release.
4. **Publish the draft.** Paste the version's changelog section into the notes, check the attachments, and publish. To publish a tag with a hyphen as a full release, as `v0.1.0-alpha` was, clear the pre-release box, or run `gh release edit <tag> --prerelease=false`. Pushing the tag again sets it back.
5. **The website follows `main`.** Cloudflare Pages builds `main` on every push, so the site already has the release. See [hosting.md](hosting.md).

### Not in the release

- **The Windows app.** Releases are web-only for now. `npm run app:build` still builds the app and an unsigned installer from source, and Windows SmartScreen warns before running that installer.
- **macOS and Linux apps.** The web app runs in any browser there.

## What CI runs

`.github/workflows/ci.yml` runs on every pull request and on every push to `main` and `release`: the lint, the typecheck, the unit tests, the production build, and the browser walkthrough (`npm run e2e`). That is the same list as `npm run verify`.
