# Changelog

## 0.1.0 - 2026-06-18

First public release candidate for Ohrisk.

### Added

- `ohrisk scan` for local Bun `bun.lock` projects.
- `--profile saas` and `--profile distributed-app` risk profiles.
- `--prod` filtering for production dependency scans.
- `--json` output that reuses the terminal report finding model.
- `--version` and `-v` package version output.
- Project discovery with clear failures for unsupported or ambiguous lockfiles.
- Bun lockfile dependency graph parsing with direct, transitive, production, and development dependency context.
- Local `file:` package evidence collection.
- HTTP(S) tarball evidence collection when the lockfile points directly to a tarball.
- `package.json` license field, legacy `licenses` field, `LICENSE`, `LICENCE`, `COPYING`, and `NOTICE` evidence handling.
- SPDX-like license expression parsing with simple `AND` and `OR` handling.
- Risk findings for low, review, high, and unknown license evidence.
- Terminal findings sorted by severity with package path, recommendation, and evidence snippets.

### Not Included Yet

- Registry metadata lookup when a lockfile does not contain a direct tarball URL.
- PR diff mode.
- CI failure mode.
- SARIF or SBOM output.
- Waiver, approval, or legal workflow management.
- GitHub App integration.
- Multi-ecosystem adapters beyond the first npm-style Bun lockfile path.
