# Releasing

This repository publishes from the `Publish npm package` GitHub Actions workflow
when a `v*` tag is pushed. Local commands below are maintainer preparation
steps, not agent permission to publish, tag, change secrets, or change account
settings.

## Preconditions

- `main` is clean and pushed.
- Bun is available locally for development, tests, and packaging. The published
  CLI runs on Node.js `>=20.0.0`.
- GitHub Actions has access to an `NPM_TOKEN` secret that can publish the
  `ohrisk` package.
- The npm registry does not already contain the release version.
- GitHub Actions billing is available for the automated publish workflow.

## Local Gate

Run the release-ready local gate before tagging:

```bash
bun run verify:release
```

This runs the full Bun test suite, builds the Node-compatible CLI bundle,
verifies the npm package contents with a dry-run pack, then installs the packed
tarball into a temporary npm consumer project and runs the packaged `ohrisk`
bin through Node.js.

## Automated Publish

After updating `package.json`, `src/cli/version.ts`, `CHANGELOG.md`, and this
file's example tag when needed, push `main`, then push a version tag matching
`package.json`:

```bash
git tag v0.158.13
git push origin v0.158.13
```

The publish workflow verifies that the tag version matches `package.json`, runs
the local release gate, publishes the package to npm when that exact version is
not already present, verifies the npm registry result, and creates a GitHub
Release from the matching `CHANGELOG.md` section.

## Manual Recovery

If GitHub Actions is unavailable, a maintainer may perform the same sequence
locally after confirming npm authentication:

```bash
npm whoami
npm publish --access public
npm view ohrisk version
npm view ohrisk dist.tarball
```

After manual recovery, create or update the matching GitHub Release using the
notes from `CHANGELOG.md`.
