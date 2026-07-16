# Policy Configuration

Ohrisk reads `.ohrisk.yml` from the detected project root by default. Use
`--policy <path>` to select another policy file inside the workspace boundary.

```yaml
version: 1
extends:
  - compliance/base-ohrisk.yml

licenses:
  allow:
    - MIT
    - Apache-2.0
  deny:
    - AGPL-3.0-only
  severity:
    LGPL-3.0-only: review

packages:
  "pkg:npm/legacy-widget@*":
    severity: high
    recommendation: replace
    reason: Approved replacement exists.
    action: Migrate to @company/widget.

profiles:
  distributed-app:
    licenses:
      severity:
        MPL-2.0: review

network:
  allowedHosts:
    - npm.example.com
  npmRegistryUrl: https://npm.example.com/
  auth:
    npm.example.com:
      tokenEnv: OHRISK_REGISTRY_TOKEN
```

## Merge rules

Inherited policies are loaded in order and the current file is applied last.
Set and map entries from later files override earlier entries. Profile policies
are merged on top of the base policy only when that profile is evaluated.

Inheritance accepts local files only, is limited to eight levels, rejects
cycles, and cannot escape the workspace boundary through `..` or symlinks. A
license cannot be present in both the final allow and deny sets.

## Package matching

Package rules match the dependency ID or Package URL. Exact keys win before
wildcard keys, and the longest matching wildcard wins. Use Package URLs when
several ecosystems can contain the same package name.

When a package rule overrides severity, recommendation, or action, the finding
reason names the exact package-rule key that matched. If the rule has its own
`reason`, Ohrisk keeps it with that provenance; otherwise the reason also keeps
the underlying license classification so a package override is not mistaken
for a built-in license decision.

License keys may be complete SPDX terms, including exceptions such as
`GPL-2.0-only WITH Classpath-exception-2.0`. An exact `WITH` term is checked
before the base license key.

## Explain with policy

`ohrisk explain <expression> --policy <path>` applies license allow, deny, and
severity rules, including profile-specific license rules. `--workspace-root`
sets the trusted boundary for policy inheritance. Explain has no package ID or
Package URL, so package rules are deliberately not evaluated. JSON output marks
this as `policyScope: "license-only"` and includes only redacted, relative policy
source paths.

## Report metadata

Machine-readable scan and diff reports include a redacted policy summary with
counts and source paths relative to the project. Registry credentials and token
values are never included.
