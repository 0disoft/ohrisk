# Documentation Index

Guides for using Ohrisk effectively.

- [Product Specification](product/02-spec.md) — Product boundary, command model, risk model, outputs, and GitHub Action contract.
- [CLI Command Contract](cli/command-contract.md) — Stable command, option, output, and validation expectations.
- [System Boundary](architecture/00-system-boundary.md) — Owned components, external boundaries, and quality attributes.
- [GitHub Actions Guide](github-actions.md) — PR gates, PR comments, SARIF upload, and waiver drift checks.
- [GitHub Action Contract](github-action/action-contract.md) — Composite action versioning, path safety, permissions, and validation.
- [Risky Demo](risky-demo.md) — Run the bundled fixture to see high, review, unknown, and low findings.
- [CI Usage Guide](ci.md) — Short CI examples for gates, SARIF, SBOM, and waiver drift checks.
- [Waiver Guide](waivers.md) — How waivers work, when to use `id` vs `fingerprint`, and why permanent high-risk exemptions are discouraged.
- [Profile Guide](profiles.md) — Choosing between `saas` and `distributed-app` based on how you ship software.
- [Policy Configuration](policy.md) — Organization license rules, profile overrides, inheritance, and package exceptions.
- [Cache and Registry Configuration](cache-and-registries.md) — Persistent cache, offline mode, concurrency, and private registry authentication.
- [Report Formats Guide](report-formats.md) — What each output format includes and how they handle waiver data.
- [Remote Fetching Boundary](remote-fetching.md) — Current remote evidence scope, safety rules, and requirements for future registry fetches.
- [Korean Usage Guide](ko/README.md) — Korean-language overview of Ohrisk features and workflows.
