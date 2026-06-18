# Changelog

## 0.31.0 - 2026-06-19

First public release candidate for Ohrisk.

### Added

- `ohrisk scan` for local Bun `bun.lock` projects.
- `package-lock.json` graph parsing for modern npm lockfiles with a `packages` section.
- npm v1 `package-lock.json` dependency-tree parsing.
- `pnpm-lock.yaml` graph parsing for importer, package, and snapshot dependency data.
- Yarn v1 `yarn.lock` graph parsing with root dependency classification from `package.json`.
- `--profile saas` and `--profile distributed-app` risk profiles.
- `--prod` filtering for production dependency scans.
- `--json` output that reuses the terminal report finding model.
- `--sarif` output for SARIF 2.1.0 code scanning upload.
- `--markdown` output for PR comments and release notes.
- `--output <file>` for writing scan, ci, diff, and explain reports to disk.
- `ohrisk ci --fail-on <severity>` for non-zero exits when findings meet a configured threshold.
- `ohrisk explain <license-expression>` for profile-aware license risk explanation without scanning a project.
- `ohrisk diff <baseline-ref>` for git-ref baseline comparison that reports only newly introduced findings.
- `--version` and `-v` package version output.
- Project discovery with clear failures for unsupported or ambiguous lockfiles.
- Bun lockfile dependency graph parsing with direct, transitive, production, and development dependency context.
- Local `file:` package evidence collection.
- Installed `node_modules` package evidence collection before network fallback.
- HTTP(S) tarball evidence collection when the lockfile points directly to a tarball.
- npm registry metadata lookup when the lockfile does not contain a direct tarball URL.
- `package.json` license field, legacy `licenses` field, `LICENSE`, `LICENCE`, `COPYING`, and `NOTICE` evidence handling.
- SPDX-like license expression parsing with simple `AND` and `OR` handling.
- SPDX `WITH` exception handling, deprecated package license object handling, and explicit `UNLICENSED` risk classification.
- Common permissive and public-domain-style SPDX licenses `0BSD`, `CC0-1.0`, and `Unlicense` are classified as low risk.
- Explicit commercial restriction text detection for Commons Clause, BUSL, and non-commercial license evidence.
- Recognizable standard license text in `LICENSE` and `COPYING` files is used as medium-confidence evidence when package license metadata is absent.
- Recognizable standard license files can resolve malformed package metadata pointers such as `SEE LICENSE IN LICENSE`.
- Standard license file detection covers GPL-2.0, LGPL-2.0, and LGPL-2.1 text in addition to existing GPL-family v3 detection.
- Specific finding reason text for explicit commercial-use restriction evidence.
- Markdown scan and diff reports include finding reasons for PR review.
- Findings include human-readable action text alongside the stable recommendation enum.
- Findings include stable IDs for JSON, terminal, Markdown, SARIF, and diff matching.
- Findings include exact fingerprints for diff matching and SARIF partial fingerprints.
- npm alias dependencies resolve to the actual package identity while keeping the alias visible in dependency paths.
- Installed `node_modules` evidence lookup checks npm alias install names before registry fallback.
- pnpm alias package keys such as `alias@npm:actual@version` resolve to the actual package identity.
- Local and remote package tarballs are verified against lockfile integrity digests before license evidence is trusted.
- SARIF result properties include structured reason and action fields.
- Markdown scan reports include license confidence counts.
- Terminal and Markdown scan summaries include missing and malformed license counts.
- Risk findings include structured dependency type and direct/transitive scope.
- Scan and diff reports choose the next action from the actual finding recommendations.
- JSON scan and diff reports include the same next action used by human-readable reports.
- JSON reports include `failOn`, `failed`, and `failingFindingCount` when a CI or diff threshold is configured.
- Terminal and Markdown reports show threshold pass/fail lines when a CI or diff threshold is configured.
- Unknown-risk findings now distinguish missing, malformed, and unrecognized license metadata in reason and action text.
- Risk findings for low, review, high, and unknown license evidence.
- Terminal findings sorted by severity with package path, recommendation, and evidence snippets.

### Not Included Yet

- SBOM output.
- Waiver, approval, or legal workflow management.
- GitHub App integration.
- Ecosystem adapters beyond npm-style lockfiles.
