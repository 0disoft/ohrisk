# Releasing

This is a human-run release checklist. Do not treat it as agent permission to
publish, tag, or change account settings.

## Preconditions

- `main` is clean and pushed.
- Bun is available locally. The package currently tests with Bun `1.3.14`.
- npm authentication is available in the current shell.
- The package name `ohrisk` is still available on npm.
- GitHub Actions billing is available if you want to run the manual Release Check workflow.

## Local Gate

Run the release-ready local gate:

```bash
bun run verify:release
```

This runs the full Bun test suite, verifies the npm package contents with a
dry-run pack, then installs the packed tarball into a temporary consumer project
and runs the packaged `ohrisk` bin.

## Optional GitHub Gate

If GitHub Actions runners are available for the account, run the manual
`Release Check` workflow from the Actions tab.

The workflow intentionally uses `workflow_dispatch` only. Push and pull request
triggers are disabled until the account can run Actions without billing or
spending-limit failures.

## Publish

Confirm npm auth:

```bash
npm whoami
```

Publish the public package:

```bash
npm publish --access public
```

Verify the registry result:

```bash
npm view ohrisk version
npm view ohrisk dist.tarball
```

## Tag

After the npm registry result is verified, tag the matching commit:

```bash
git tag v0.61.0
git push origin v0.61.0
```

Then create a GitHub Release using the notes from `CHANGELOG.md`.
