# Operational Contract

- Status: Project-owned

## Release Boundary

Ohrisk releases an npm CLI package and a GitHub Action tag. Package contents are
controlled by `package.json`, `scripts/build.ts`, `dist/`, `CHANGELOG.md`, and
`RELEASING.md`.

## CI Boundary

CI must preserve typecheck, tests, packaging checks, and action safety checks.
Action examples live in `docs/ci.md` and `docs/github-actions.md`.

## Generated Output

Generated reports, build output, caches, and dependency folders are operational
artifacts. They must not become source-of-truth documentation or committed
evidence unless a specific fixture or snapshot contract says so.

## Incident Triggers

- Published package cannot run on Node.js `>=24.0.0`.
- `ohrisk ci` threshold behavior regresses.
- Shareable reports expose absolute local paths.
- GitHub Action path validation accepts absolute, UNC, empty, `.`, or `..` segments.
