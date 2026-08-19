# Releasing

This repository publishes the npm package and standalone executables from the
`Publish npm package` GitHub Actions workflow when a `v*` tag is pushed. Local
commands below are maintainer preparation steps, not agent permission to
publish, tag, change secrets, or change account settings.

## Preconditions

- `main` is clean and pushed.
- Bun is available locally for development, tests, npm packaging, and
  standalone executable compilation.
- The published npm CLI runs on Node.js `>=24.0.0`; the standalone release
  assets embed their runtime and do not require Node.js or Bun after download.
- GitHub Actions has access to an `NPM_TOKEN` secret that can publish the
  `ohrisk` package.
- The npm registry does not already contain the release version.
- GitHub Actions billing is available for the automated publish workflow.
- `CHANGELOG.md` contains a dated section for the exact `package.json` version;
  an `Unreleased` candidate heading is intentionally rejected.
- `git ls-remote --tags origin refs/tags/v1.15.1` prints no existing remote tag.

The initial macOS and Windows standalone assets are unsigned. Code-signing or
notarization certificates must not be added until their protected secrets,
owners, rotation, and revocation procedures are defined.

## Local Gate

Synchronize candidate and public documentation, extract the exact release notes,
run the release-ready local gate, then compile and execute the native standalone
binary before tagging:

```bash
bun run version:sync
bun run release:notes > release-notes.md
bun run verify:release
bun run build:standalone -- --native
```

`bun run verify:release` runs the scoped TypeScript typecheck for release
packaging scripts and report output writing, the full Bun test suite, builds the
Node-compatible CLI bundle, requires a fresh bundle to match the checked-in
Action bundle byte for byte, verifies the npm package contents with a dry-run
pack, then installs the packed tarball into a temporary npm consumer project and
runs the packaged `ohrisk` bin through Node.js.

`bun run build:standalone -- --native` compiles one executable for the current
runner, checks its executable format and architecture header, verifies
`ohrisk <version>`, and executes `ohrisk explain MIT --json`. The release-check
workflow runs this native build on Linux, Windows, and macOS without duplicating
the complete coverage suite.

Use repeatable explicit targets when inspecting a cross-build locally:

```bash
bun run build:standalone -- \
  --target linux-x64 \
  --target linux-arm64
```

With no `--target` or `--native`, the command builds all six release assets.
Generated executables and `SHA256SUMS` are written under
`release/standalone/`, which is ignored by Git.

## Automated Publish

After updating `package.json` and `CHANGELOG.md`, run `bun run version:sync` to
update candidate references such as this file's example tag. Then push `main`
and a version tag matching `package.json`:

```bash
git tag v1.15.1
git push origin v1.15.1
```

The tag workflow performs the irreversible work in this order:

1. Verify that the tag version matches `package.json`.
2. Run `bun run verify:release` and extract a dated, non-empty
   `CHANGELOG.md` section.
3. Create or refresh a draft GitHub Release.
4. Build Linux, macOS, and Windows executables for x64 and arm64 with the pinned
   Bun version.
5. Validate each file's executable format and architecture. Each runner also
   executes its native binary through the version and explain smoke checks.
6. Upload all six executables to the draft release.
7. Publish the npm package when that exact version is not already present, then
   verify the exact `package@version` registry metadata: version, tarball URL,
   and integrity.
8. Download the six attached executables again, generate deterministic
   `SHA256SUMS` from the release bytes, upload it, and publish the GitHub Release.

The postcheck does not depend on the mutable `latest` npm dist-tag. A build,
smoke, npm, or checksum failure leaves the GitHub Release in draft state. A
rerun replaces same-named assets and skips npm publication when the exact npm
version already exists, so an interrupted release can be completed without
creating another package version.

Public install and Action examples track the latest dated changelog release,
while this file tracks the candidate package version. This keeps `main`
documentation runnable while the next version is still marked `Unreleased`.

## Manual Recovery

If GitHub Actions is unavailable, a maintainer may publish npm after confirming
authentication and running the same local gate:

```bash
npm whoami
npm publish --access public --provenance
npm view ohrisk@1.15.1 version
npm view ohrisk@1.15.1 dist.tarball
npm view ohrisk@1.15.1 dist.integrity
```

Standalone recovery must use a draft GitHub Release. Build all targets, inspect
`release/standalone/SHA256SUMS`, upload the six executables, then regenerate the
manifest from the bytes downloaded back from the release before publication:

```bash
bun run build:standalone
gh release upload v1.15.1 release/standalone/ohrisk-* --clobber
```

Do not publish a release with missing targets, a locally generated checksum
manifest that was not recomputed from the attached assets, or unsigned assets
described as signed. If the release cannot meet those conditions, leave it in
draft state and keep npm recovery separate.
