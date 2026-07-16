# Remote Fetching Boundary

Ohrisk is a local-first scanner. Remote fetching is allowed only where the code
can keep the request target, downloaded bytes, credentials, cache entry, and
resulting evidence bounded and reproducible enough for a license-risk check.

## Current Scope

Remote fetching is limited to npm package evidence:

- direct HTTPS package tarball URLs recorded in supported npm-family lockfiles;
- npm-compatible registry metadata lookup for an exact locked package version when no direct tarball URL is available;
- the tarball URL returned by that exact-version registry metadata response.

Other ecosystems use local caches, vendored source, lockfile-embedded evidence,
or local package metadata. A new remote ecosystem adapter is not enabled until
it implements the same target, integrity, cache, credential, and resource
boundary.

## Target and Redirect Rules

Every remote target must use HTTPS, contain no URL username or password, and
pass hostname and address validation. Local, private, special-purpose,
multicast, reserved, documentation, and benchmark-only destinations are
rejected.

Hostname targets are resolved before an online request. DNS answers that point
to blocked addresses are rejected, and the default HTTPS path rechecks the
connected socket address before trusting the response. Redirects are followed
manually, capped, and fully revalidated. A bearer token is attached only to the
exact configured registry hostname and is never forwarded to another redirect
host.

Additional public artifact hosts must be declared through policy or repeatable
`--allow-host` options. `--registry-url` automatically permits only its exact
hostname. Host matching does not use suffix or substring rules. Allowlisting
changes only hostname policy: DNS preflight, rejection of every blocked DNS
answer, guarded socket lookup, connected-address checks, and per-redirect
revalidation remain mandatory.

## Credential Rules

Registry credentials are read from the environment through
`--registry-token-env` or a policy `tokenEnv` entry. Raw token CLI arguments and
credential-bearing URLs are rejected. Reports, cache keys, diagnostics, and
policy summaries never include token values.

## Cache and Offline Rules

The persistent cache is content-addressed and stores artifact bytes with an
integrity digest plus bounded freshness metadata. Corrupt, truncated, or
mismatched entries are removed rather than trusted. Cache directories and files
use private permissions where the platform supports them.

Online collection validates the target before using a cached remote result, so
an old cache entry cannot bypass the current SSRF allowlist. Fresh entries are
used directly; expired entries are conditionally revalidated with `ETag` and
`Last-Modified` when available. A `304 Not Modified` response refreshes the
entry without replacing its bytes, while `Cache-Control: no-store` prevents
persistence and removes a previous entry for that request.

Cache validators are attached only to the first validated request and are not
forwarded across redirects. The same rule already applies to registry bearer
tokens, preventing request-specific state from crossing host boundaries.

`--offline` performs no DNS lookup or network request. It may use a valid stale
entry because revalidation is impossible by definition, but a missing,
corrupt, or oversized entry is reported as unavailable evidence instead of
silently going online. Cache locations, TTL rules, size limits, and management
commands are defined in `docs/cache-and-registries.md`.

## Resource Rules

Remote fetches have a bounded per-request timeout, response byte limits, archive
decompression limits, archive entry limits, and evidence-worker concurrency.
The CLI exposes bounded `--timeout` and `--jobs` values; policy cannot expand
hard safety ceilings.

When a remote package artifact has supported lockfile integrity metadata,
Ohrisk verifies downloaded bytes before trusting tarball evidence. Without
supported integrity metadata, Ohrisk does not fetch or trust that tarball and
records unavailable evidence with a warning.

## Failure Semantics

Transient online failures such as DNS resolver errors, timeouts, connection
errors, and failed HTTP responses are recorded as unavailable evidence so the
remaining graph can be evaluated. Security violations, integrity mismatches,
malformed registry metadata, unreadable bodies, and parser failures fail closed
instead of pretending evidence coverage is complete.

Error details may name a package id, sanitized URL, redirect relation, blocked
host reason, HTTP status, size limit, timeout, or cache state. They must not echo
credentials, authorization headers, or raw secret-bearing configuration.

## Adding a Registry or Artifact Source

A new source must define and test the exact package identity and version source,
allowed hosts, redirect behavior, credential scope, redaction, cache key and
integrity contract, offline behavior, time and byte limits, decompression and
entry limits, concurrency, and partial-failure semantics. Tests must include
blocked hosts, private DNS answers, connected-address rechecks, credential URLs,
cross-host redirects, corrupt cache entries, oversized responses, timeouts,
integrity failures, malformed metadata, and offline cache misses.

Broad fetch-whatever-the-lockfile-mentions behavior is forbidden. Each remote
source requires a narrow adapter and explicit tests for this boundary.
