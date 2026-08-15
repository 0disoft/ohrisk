# Contributing to Ohrisk

Thanks for helping improve Ohrisk. Small, focused changes with a reproducible
test are the easiest to review.

## Before you start

- Use Node.js 24 and Bun 1.3.14.
- Search existing issues before opening a duplicate.
- Use a private security advisory for vulnerabilities; never disclose them in
  a public issue or pull request.
- Do not include credentials, private dependency files, registry responses, or
  proprietary source in fixtures, logs, screenshots, or reports.

Install the locked development dependencies:

```bash
bun install --frozen-lockfile
```

## Development workflow

Add or update a focused test first when fixing a defect. Run the narrowest
relevant test while iterating, then run the complete release gate before asking
for review:

```bash
bun test test/<relevant-test>.test.ts
bun run typecheck
bun run verify:release
```

`bun run verify:release` checks formatting, source hygiene, types, docs,
schemas, the full test and coverage suites, the checked-in Action bundle,
package contents, and an installed CLI smoke test. If source or package metadata
changes make `action-dist/cli.js` stale, run `bun run build:action` and include
the generated bundle in the same pull request.

## Change boundaries

- Keep parsers deterministic and fail closed when a dependency graph or package
  identity cannot be proven from the selected input.
- Keep network access bounded by exact hosts, redirects, byte limits, timeouts,
  checksums, and package identity checks.
- Preserve existing report schemas, finding identity, and waiver compatibility
  unless the change explicitly documents a migration.
- Avoid new runtime dependencies. A dependency proposal must explain why the
  behavior cannot be implemented safely within the existing package boundary.
- Update the owning guide and `CHANGELOG.md` for user-visible behavior.

## Adding an ecosystem

An ecosystem contribution should be one reviewable vertical slice:

1. Add project discovery and a strict parser for resolved dependency input.
2. Preserve direct/transitive and production/development information only when
   the input proves it; otherwise use the conservative scope.
3. Add local evidence collection before any remote fallback.
4. For remote evidence, require immutable identity or checksums and enforce the
   shared network and archive limits.
5. Register the adapter without adding ecosystem-specific branching to the CLI.
6. Add parser, malformed-input, path, identity, evidence, and CLI integration
   tests plus documentation for unsupported cases.

Do not add a parser that silently returns a partial graph for unsupported input.

## Pull requests

Explain the problem, the chosen boundary, user-visible impact, compatibility or
security consequences, and the exact validation run. Keep unrelated cleanup in
separate changes. If a check is skipped, state why and what risk remains.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
