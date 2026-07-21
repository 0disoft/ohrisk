# Risky Demo

Use the bundled Bun fixture when you want to see Ohrisk report real-looking
`high`, `review`, `unknown`, and `low` findings without modifying your own
project.

This demo is for a source checkout of the Ohrisk repository. The published npm
package ships the CLI, not the test fixtures.

## Run the demo

Clone the repository and run the fixture scan from the repository root:

```bash
git clone https://github.com/0disoft/ohrisk.git
cd ohrisk
npm install -g ohrisk@1.12.0
ohrisk scan --lockfile test/fixtures/bun-project/bun.lock --profile saas --prod
```

The fixture includes:

- `agpl-child@0.1.0`, a transitive AGPL package that should be reviewed before
  SaaS shipping
- `gpl-package@5.0.0`, a GPL package that is `review` for SaaS and stricter for
  distributed apps
- `missing-license@4.0.0`, a package with missing license evidence
- permissive MIT and dual-license packages that should stay low risk

Expected SaaS production summary:

```text
Risks: 1 high, 1 review, 1 unknown, 2 low
```

## Open the HTML report

Write the same demo report to a browser-friendly HTML file:

```bash
ohrisk scan --lockfile test/fixtures/bun-project/bun.lock --profile saas --prod --html --output ohrisk-demo.html --open
```

Use the filters to focus on `high`, `review`, or `unknown` findings first. The
long dependency paths and fingerprints are collapsed in the HTML report so they
can be expanded only when needed.

## Compare profiles

Run the same fixture with the distributed app profile:

```bash
ohrisk scan --lockfile test/fixtures/bun-project/bun.lock --profile distributed-app --prod
```

GPL risk is stricter for distributed apps because users receive the software
instead of only using a hosted service.
