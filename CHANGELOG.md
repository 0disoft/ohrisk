# Changelog

## 0.3.0 - 2026-06-18

First public release candidate for Ohrisk.

### Added

- `ohrisk scan` for local Bun `bun.lock` projects.
- `--profile saas` and `--profile distributed-app` risk profiles.
- `--prod` filtering for production dependency scans.
- `--json` output that reuses the terminal report finding model.
- `ohrisk ci --fail-on <severity>` for non-zero exits when findings meet a configured threshold.
- `ohrisk explain <license-expression>` for profile-aware license risk explanation without scanning a project.
- `--version` and `-v` package version output.
- Project discovery with clear failures for unsupported or ambiguous lockfiles.
- Bun lockfile dependency graph parsing with direct, transitive, production, and development dependency context.
- Local `file:` package evidence collection.
- HTTP(S) tarball evidence collection when the lockfile points directly to a tarball.
- npm registry metadata lookup when the lockfile does not contain a direct tarball URL.
- `package.json` license field, legacy `licenses` field, `LICENSE`, `LICENCE`, `COPYING`, and `NOTICE` evidence handling.
- SPDX-like license expression parsing with simple `AND` and `OR` handling.
- SPDX `WITH` exception handling, deprecated package license object handling, and explicit `UNLICENSED` risk classification.
- Risk findings for low, review, high, and unknown license evidence.
- Terminal findings sorted by severity with package path, recommendation, and evidence snippets.

### Not Included Yet

- PR diff mode.
- SARIF or SBOM output.
- Waiver, approval, or legal workflow management.
- GitHub App integration.
- Multi-ecosystem adapters beyond the first npm-style Bun lockfile path.
