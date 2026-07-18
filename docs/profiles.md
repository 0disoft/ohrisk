# Profile Decision Guide

Ohrisk profiles adjust risk severity based on how you ship software. The same
dependency tree can produce different findings under `saas` and
`distributed-app` because redistribution changes license obligations.

A profile is not a legal judgment. It is a usage-context severity filter. Ohrisk
reports `low`, `review`, `high`, and `unknown` findings; you decide what to do
with them.

Organization policy is evaluated after the built-in profile. A checked-in
`.ohrisk.yml` can allow or deny licenses, override severity, and apply package
exceptions, so policy-controlled results can intentionally differ from the
built-in table below.

## When to choose saas

Use `saas` (the default) when you run a service and do not redistribute package
binaries to users. In this mode:

- GPL-only copyleft (GPL-2.0, GPL-3.0) is `review`, not `high`, because SaaS
  usage does not trigger redistribution obligations.
- AGPL, source-available restrictions, and UNLICENSED remain `high`.
- MPL file-level copyleft is `low` because service use does not deliver a copy
  of the package to users.
- Weak copyleft LGPL and EPL remain `review`.
- Permissive licenses (MIT, Apache-2.0, BSD, ISC, etc.) are `low`.

## When to choose distributed-app

Use `distributed-app` when you ship the package to users — a CLI tool, a
mobile app, a desktop app, a Docker image distributed to customers. In this
mode:

- GPL becomes `high` because redistribution obligations apply.
- AGPL, source-available restrictions, and UNLICENSED remain `high`.
- Weak copyleft (LGPL, MPL, EPL) is `review`.
- Permissive licenses are `low`.

## Why the same license changes

GPL and MPL change severity with the shipping profile. Under `saas`, you are
not redistributing the package, so GPL redistribution obligations do not
trigger and MPL file-level source obligations are not activated because no
package copy is delivered. Ohrisk classifies GPL as `review` and MPL as `low`. Under
`distributed-app`, you are shipping the package, so GPL becomes `high` and MPL
becomes `review`.

All other license families are profile-independent. AGPL is `high` under both
profiles because the network clause applies regardless of how you ship. SSPL,
BUSL, Commons-Clause, and similar source-available restrictions are `high`
under both profiles because they restrict commercial use regardless of
distribution model.

Commercial restrictions are evaluated against the part of the package they
explicitly govern. Package metadata and terms applied to software, source code,
or the package itself can raise severity to `high`. Terms explicitly limited to
documentation or data such as corpora and datasets are retained in finding
evidence as `restriction scope: documentation` or `restriction scope: data`,
but they do not override a separate package-code license. If the application
ships or uses those separately licensed materials, review their terms as a
separate asset decision.

## License family reference

| License family | Example SPDX IDs | saas | distributed-app |
|---|---|---|---|
| Permissive | MIT, Apache-2.0, BSD-3-Clause, ISC, 0BSD, Zlib | low | low |
| File-level copyleft | MPL-2.0 | low | review |
| Weak copyleft | LGPL-3.0, EPL-2.0 | review | review |
| Strong copyleft (GPL) | GPL-2.0, GPL-3.0 | review | high |
| Network copyleft | AGPL-3.0 | high | high |
| Source-available restriction | SSPL-1.0, BUSL-1.1, Commons-Clause, Elastic-2.0, PolyForm-Noncommercial-1.0.0, PolyForm-Free-Trial-1.0.0 | high | high |
| UNLICENSED | UNLICENSED | high | high |
| Missing or malformed | (no license declared) | unknown | unknown |
| Unrecognized | (license not in Ohrisk's known set) | unknown | unknown |

Severities shown assume a single-license expression. For `OR` expressions
(e.g., `MIT OR GPL-3.0`), Ohrisk uses the least risky branch. For `AND`
expressions, it uses the riskiest branch.

## --prod and profiles

`--prod` and `--profile` are independent:

- `--prod` excludes development-only dependencies from the scan. It controls
  which packages are evaluated.
- `--profile` controls how their licenses are classified. It controls severity.

A dev-only GPL dependency is excluded entirely with `--prod`. Without `--prod`,
it appears in the scan but gets an `exclude-dev-only` recommendation if its
severity is `review` or `high`.

## CI recommended combinations

```bash
# SaaS — you run the service
ohrisk ci --profile saas --prod --fail-on high

# Distributed app — you ship binaries
ohrisk ci --profile distributed-app --prod --fail-on high
```

With `--fail-on high`, CI fails when any active finding is `high`. Under
`saas`, GPL findings are `review` and do not trigger the gate. Under
`distributed-app`, GPL findings are `high` and do trigger the gate.

## If you are unsure

If you are not certain whether your usage counts as SaaS or distribution, run
the scan with `distributed-app` once. It is the stricter profile — any finding
that passes under `distributed-app` will also pass under `saas`. The reverse is
not true: a GPL finding that is `review` under `saas` becomes `high` under
`distributed-app`.
