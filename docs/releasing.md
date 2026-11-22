# Releasing

## Branches

| Branch | Role | How it moves |
| --- | --- | --- |
| `main` | Active development (always passes CI) | Pull requests |
| `release` | Shipped version; every commit is tagged | Fast-forward merges from `main` |

Branch feature work from `main` and open PRs back to `main`. Branch hotfixes from `release`, merge to `release`, then merge back into `main`.

Recommended branch protection on both branches: require PRs, require CI checks, block force pushes, and restrict direct pushes on `release`.

## Version numbers

The version lives in `package.json` and `package-lock.json`.
`npm run build` fails if any manifest disagrees with `package.json`.

Git tags are `v` plus the version (like `v0.2.3-alpha` or `v1.0.0`). Tags with a hyphen are marked as prereleases by the workflow.

## Cutting a release

1. On `main` via PR, move `[Unreleased]` in `CHANGELOG.md` under the new version and date, bump the version manifests, and run `npm run verify`.
2. Fast-forward `release` to `main` and push the tag:

   ```sh
   git fetch origin
   git checkout release 2>/dev/null || git checkout -b release origin/main
   git merge --ff-only origin/main
   git tag -a v0.2.5-alpha -m "0.2.5-alpha"
   git push origin release v0.2.5-alpha
   ```

3. `.github/workflows/release.yml` builds the single-file web app on the tag push and attaches it to a draft GitHub release.
4. Paste the changelog section into the draft release notes and publish. To mark a hyphenated tag as a regular release, clear the pre-release checkbox or run `gh release edit <tag> --prerelease=false`.
5. Cloudflare Pages automatically builds and deploys `slopculator.com` from `release` (see [hosting.md](hosting.md)).

### Platform status

Public releases ship the web bundle for now.

## CI

`.github/workflows/ci.yml` runs `lint`, `typecheck`, `test`, and `build` on PRs and pushes to `main` (skipping doc-only changes). The Chrome walkthrough (`npm run e2e`) runs locally via `npm run verify` or on demand via manual workflow dispatch.
