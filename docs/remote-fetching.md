# Remote Fetching Boundary

Ohrisk is a local-first scanner. Remote fetching is allowed only where the code
can keep the request target, downloaded bytes, credentials, cache entry, and
resulting evidence bounded and reproducible enough for a license-risk check.

## Current Scope

Remote fetching is limited to these explicit adapters:

- public GitHub HTTPS repository input for the `scan` CLI command, materialized
  through a bounded temporary shallow clone;

- direct HTTPS package tarball URLs recorded in supported npm-family lockfiles;
- npm-compatible registry metadata lookup for an exact locked package version;
- exact SPDX metadata from that response for transitive npm packages, while
  direct packages and absent or non-SPDX declarations continue to the verified
  tarball path;
- the tarball URL returned by that exact-version registry metadata response.
- PyPI release metadata lookup for an exact locked Python package version;
- the SHA-256-identified source distribution or wheel returned by that exact
  PyPI release response, including bounded identity-checked package metadata and
  license files.
- Maven Central POM metadata for an exact Maven coordinate and version when
  local POM evidence is unavailable;
- a bounded parent-POM chain used only to inherit package license names;
- exact-version POM metadata from a project-declared HTTPS Maven repository only
  when its exact host is explicitly allowed by policy or `--allow-host`;
- a bounded Maven JAR license-file fallback only when the selected repository
  publishes a SHA-256 sidecar and the JAR contains exact embedded Maven identity.
- exact Go module ZIPs from the fixed public `proxy.golang.org` endpoint when
  `go.sum` supplies the module ZIP's exact `h1` checksum; only root license
  files from the checksum-verified archive are evidence.

The repository adapter accepts only `github.com` owner/repository URLs, disables
credential prompts, submodule fetching, and symlink checkout, rejects non-portable or
oversized trees before checkout, caps temporary storage, applies a two-minute
clone budget, a 30-second tree-inspection budget, and a three-minute checkout
budget, and removes its owned staging directory. It does not accept private
repository credentials or arbitrary Git hosts. The host invocation directory,
not the clone, owns policy, waivers, cache, and report output.

The declared tree is capped at 50,000 entries, 100 MiB per blob, and 640 MiB in
aggregate. The complete temporary clone, packfiles, index, pathspec, and checkout
remain subject to the independent 1 GiB staging ceiling.
Clone transfer is monitored while Git writes unknown pack data. After tree
inspection, checkout capacity is checked from the current staging size, declared
portable-file bytes, and bounded per-entry filesystem overhead; final staging
size is checked again after checkout. This avoids repeatedly walking a large
materializing tree while keeping the same hard ceiling.

Submodule gitlinks are skipped by default without resolving `.gitmodules` URLs
or making additional network requests. Every report records the total skipped
count, a bounded list of safe relative paths, truncation state, and incomplete
coverage guidance. `--submodules reject` restores strict failure on the first
gitlink. Recursive fetching is intentionally unsupported because it would widen
the allowed repository, host, credential, recursion, storage, and timeout scope.

Symbolic-link blobs are also skipped, but are never resolved or followed. Their
validated repository-relative paths are retained only long enough to remove the
regular-file materializations produced by `core.symlinks=false`; the checkout is
then revalidated and fails closed if a link or unexpected special entry remains.
Reports record a bounded path list and incomplete coverage separately from
submodules. A skipped symbolic link cannot act as a dependency manifest or
lockfile, even when its filename would otherwise be supported.

Regular blobs that are structurally safe but cannot be represented consistently
on supported filesystems are excluded before checkout with NUL-delimited literal
Git pathspecs. This includes Windows-reserved names, unsupported characters or
suffixes, overlong segments, and case or Unicode normalization collisions.
Reports expose these paths separately as incomplete coverage. Traversal, `.git`
segments, malformed paths, and unsupported Git entry types still fail closed.

When the repository root has no supported input, remote scans recursively inspect
only the already validated checkout. One nested dependency project is selected
automatically; multiple nested project roots are merged into one repository-wide
graph with per-lockfile provenance. Automatic discovery is capped at 64 project
roots and 128 dependency inputs. `--lockfile <repository-relative-path>` narrows
the scan to one explicit input. Inputs at every selected root are merged instead
of silently preferring one ecosystem. An SBOM with unresolved uppercase `@BUILD_VARIABLE@`
placeholders is a build template and is not an automatic candidate. The adapter
rejects absolute paths, empty or dot segments, and
traversal before resolving an explicit path. This selects existing repository
data only and does not widen the network or credential boundary.

Maven aggregator POMs are expanded only through bounded `<module>` paths that
remain inside the validated checkout. Cycles, missing module POMs, path escape,
excessive depth, and excessive module count fail the scan instead of returning
an empty successful report. Dependencies whose exact group, artifact, and
version match a module in the same reactor are project components and are not
reported again as external packages.

Other ecosystems use local caches, vendored source, lockfile-embedded evidence,
or local package metadata. Any further remote ecosystem adapter is not enabled until
it implements the same target, integrity, cache, credential, and resource
boundary.

Modern npm package locks may embed the exact package `license` field alongside
the locked name and version. Ohrisk uses one valid SPDX declaration from that
local metadata before making a registry request. Missing, non-SPDX, or duplicate
records with conflicting license values are not trusted as embedded evidence
and continue through the local-package or integrity-verified tarball path.
An npm package resolved from Git or another non-registry source is never replaced
with a same-name registry artifact: its integrity identifies different bytes,
so absent local evidence remains unavailable instead of mixing identities.

Go module evidence remains local-first. A module or module-to-module replacement
may use the fixed public proxy only when the adjacent `go.sum` contains the exact
module ZIP `h1` checksum for the evidence identity. Local path replacements are
never sent to the proxy. Missing or malformed ZIP checksums produce unavailable
evidence without a request, and a checksum mismatch fails the scan. For modules
declaring Go 1.17 or later, `go.mod` is the complete requirement graph and
`go.sum` is used only as the checksum ledger; older or versionless modules retain
the conservative `go.sum`-only dependency fallback.

`uv.lock` Git source records are identity-only inputs, not another remote
adapter. Ohrisk accepts one only when uv's resolved source ends in a full 40- or
64-hex Git commit, retains the package and dependency paths, and emits
unavailable evidence that requires manual license verification at that commit.
It does not contact the VCS host, clone the source, persist its URL, or query
PyPI for a same-name package. A branch, tag, short revision, missing resolved
commit, or malformed remote source fails closed. Rejected-source diagnostics
strip credentials, query strings, fragments, and absolute local source paths.

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

Go module requests are constructed only under `https://proxy.golang.org` using
the module proxy's uppercase and exclamation-mark escaping. The official proxy
may redirect ZIP downloads to the exact `storage.googleapis.com` host. That
redirect is revalidated like every other target, receives no npm token or other
credential, and signed query strings or fragments are omitted from diagnostics.
Callers cannot replace the fixed proxy or widen this adapter through
`--registry-url`.

Within one scan, successful public DNS answers are reused for at most 60 seconds
and 256 exact hostnames. The cache is scan-local, does not retain failures, and
pins HTTPS lookup to the same previously approved public addresses. Connected
socket addresses are still checked on every response, and every redirect target
passes the same hostname and address rules before reuse. This bounds repeated
DNS work in large monorepos without allowing DNS rebinding to a newly returned
private address.

Additional public artifact hosts must be declared through policy or repeatable
`--allow-host` options. `--registry-url` automatically permits only its exact
hostname. Host matching does not use suffix or substring rules. Allowlisting
changes only hostname policy: DNS preflight, rejection of every blocked DNS
answer, guarded socket lookup, connected-address checks, and per-redirect
revalidation remain mandatory.

Maven Central requests use only `https://repo.maven.apache.org/maven2/` and
never receive npm registry credentials. Group, artifact, and version segments
must be safe exact repository coordinates before the URL is constructed.
Redirects may not leave the fixed Maven Central host. Every returned POM must
match the requested artifact identity; malformed XML, identity mismatches,
parent cycles, unsafe parent coordinates, excessive parent depth, and oversized
POMs fail closed.

Project `pom.xml` files may contribute at most 32 bounded repository URLs after
profile sections are removed and local properties are resolved. A contributed
URL is not authority to contact its host: it must use HTTPS, contain no URL
credentials, query, or fragment, and its exact hostname must already be present
in host-owned policy or repeatable `--allow-host` input. Maven Central is tried
first. Each permitted repository is constrained to its own exact hostname for
redirects, uses no npm token, and receives only safe exact coordinate paths.

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

Checksum-identified Go module ZIPs use the same content-addressed cache,
conditional revalidation, offline stale-entry behavior, size ceiling, and LRU
control as other remote artifacts. Offline cache misses remain unavailable and
never trigger DNS or HTTP work.

The fixed Go proxy adapter retries one short-lived failure after a bounded
200-millisecond delay. Retryable responses are limited to HTTP 408, 425, 429,
500, 502, 503, and 504 plus non-timeout network exceptions. Permanent HTTP
responses, full request timeouts, blocked targets, malformed archives, and
integrity failures are not retried. A successful retry is written to the normal
artifact cache; failures are not persisted as negative cache entries.

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

When a remote package artifact has supported lockfile integrity metadata, or an
exact PyPI release response supplies its SHA-256 digest, Ohrisk verifies the
downloaded bytes before trusting package evidence. Without supported integrity
metadata, Ohrisk does not fetch or trust the artifact and records unavailable
evidence with a warning.

For Go, the integrity source is the exact module ZIP `h1` record in `go.sum`.
Ohrisk computes the Go checksum over every sorted ZIP entry name and content,
requires the requested `<module>@<version>/` root prefix, and then inspects only
root `LICENSE`, `LICENCE`, `COPYING`, `NOTICE`, and recognized variants. ZIP
entry, expansion, materialization, time, and response limits remain enforced.
A safely rejected archive limit affects only that package; malformed archives,
unexpected roots, or checksum drift fail closed.

PyPI uses fixed public `pypi.org` release metadata and
`files.pythonhosted.org` distribution URLs. It never receives npm registry
credentials. A selected distribution is accepted only after its filename,
archive format, SHA-256 digest, embedded package name, and embedded version are
validated. Non-yanked wheels are preferred, then non-yanked source
distributions, keeping the archive surface smaller when equivalent wheel
metadata is available. Yanked files are considered only for an exact pinned
release and are reported with a warning.

After the distribution digest is verified, an archive resource-limit rejection
is isolated to that package as unavailable evidence. The entry, expansion,
compression-ratio, materialization, and work limits are not raised, and no
metadata or license bytes from the rejected archive are trusted. Integrity
mismatches, malformed archives, identity mismatches, and unsafe paths still fail
the scan.

Maven POM evidence is requested by exact-version path and is bounded to 2 MiB
per POM and eight inherited parent levels. Parent requests are
deduplicated within a scan and use the same persistent cache, conditional
revalidation, offline behavior, timeout, DNS, connected-address, and response
stream limits as other remote metadata.

When the selected POM and resolvable parent chain contain no license name, the
same repository may be queried for `<artifact>.jar.sha256`. The checksum response
is limited to one exact 64-hex SHA-256 value. Only then may Ohrisk download the
matching JAR, capped at 32 MiB, verify the checksum, parse it with the bounded ZIP
reader, and require exact
`META-INF/maven/<groupId>/<artifactId>/pom.properties` identity. Only package-root
or direct `META-INF` LICENSE, LICENCE, COPYING, and NOTICE files are considered;
nested dependency license directories are ignored. Missing checksums, missing
embedded identity, absent license files, or a safely rejected optional JAR leave
the package `unknown`. A malformed checksum, checksum mismatch, or embedded
identity mismatch fails closed. Maven source archives are not fetched.

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
