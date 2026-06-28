# Remote Fetching Boundary

Ohrisk is a local-first scanner. Remote fetching is allowed only where the code
can keep the request target, downloaded bytes, and resulting evidence bounded
and reproducible enough for a license-risk check.

## Current Scope

Remote fetching is currently limited to npm package evidence:

- direct HTTP(S) package tarball URLs recorded in supported npm-family
  lockfiles;
- npm registry metadata lookup for a locked package version when no direct
  tarball URL is available;
- the tarball URL returned by that exact-version npm registry metadata response.

Other ecosystems may use local caches, vendored source, lockfile-embedded
evidence, or local package metadata. Remote Maven parent/BOM resolution, remote
PyPI artifacts, remote Bazel registries, remote Conda channels, remote Swift
checkouts, remote CocoaPods podspecs or sources, and similar ecosystem-specific
fetches remain out of scope until they have the same safety and reproducibility
boundary.

## Security Rules

Every remote artifact target must pass URL validation before fetch. The URL must
be HTTP(S), must not carry username or password credentials, and must not target
obvious local, private, special-purpose, multicast, reserved, documentation, or
benchmark-only hosts.

Hostname targets are resolved before the default fetch path proceeds. DNS
answers that point at blocked local or private addresses are rejected. Redirects
are followed manually; each redirect target is validated with the same URL and
DNS checks before the next request is made. Redirect chains are capped.

Error details must redact credential-bearing URLs. Public diagnostics can name a
package id, registry URL, tarball URL, redirect source, redirect target, blocked
host reason, status, size limit, or timeout, but must not echo raw credentials.

## Resource Rules

Remote fetches are bounded:

- request and body reads are covered by a timeout;
- registry metadata responses have a maximum byte size;
- package tarball responses have a maximum byte size;
- package tarball decompression, entry count, and unpacked size are bounded;
- evidence collection runs with bounded concurrency.

If a remote package artifact has lockfile integrity metadata, Ohrisk verifies the
downloaded bytes before trusting the tarball evidence. When integrity metadata is
not available, the finding evidence must keep that limitation visible.

## Reproducibility Rules

Remote fetching must not be used to guess a dependency graph that the lockfile
does not already resolve. Fetches may collect license evidence for an already
resolved package identity; they must not silently add dependencies, change root
classification, or invent transitive relationships.

Offline and cache-first behavior stays preferred. If local evidence exists, use
it before registry fallback. If remote evidence is unavailable, Ohrisk should
return unavailable or unknown evidence where that is safe, or fail closed when a
parser would otherwise pretend coverage is complete.

## Adding A New Registry

Before adding a new remote registry or artifact source, the implementation must
define:

- the exact package identity and version source;
- the allowed registry host or host family;
- whether redirects are allowed and how every redirect target is revalidated;
- credential rejection and redaction behavior;
- timeout, byte, decompression, entry count, and concurrency limits;
- integrity verification or the visible warning when integrity is unavailable;
- local-cache precedence and offline behavior;
- tests for blocked hosts, DNS-rebound-style answers, credential URLs,
  redirects, oversized responses, timeouts, and malformed metadata.

Broad "fetch whatever the lockfile mentions" support is intentionally not a
target. Each ecosystem needs a narrow registry-specific adapter with tests that
prove the above boundary.
