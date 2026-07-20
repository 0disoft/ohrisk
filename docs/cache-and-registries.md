# Cache and Registry Configuration

Ohrisk stores fetched npm registry metadata, PyPI release metadata, Maven POM metadata, checksum-verified Go module ZIPs, and package artifacts in a shared,
content-addressed cache. The URL index contains only a SHA-256 URL key, object
digest, byte size, access timestamps, expiration metadata, and optional HTTP
validators. Raw URLs, credentials, authorization headers, and token values are
not written to the cache index.

Automatic LRU maintenance runs once after evidence collection instead of after
every cache write. A cross-process maintenance lock and short cooldown coalesce
simultaneous scans, while the same 2 GiB default limit, ownership marker, and
content-addressed integrity checks remain in force.

## Cache location

The cache used by scans and cache-management commands is selected in this
order:

1. `--cache-dir <path>`
2. `OHRISK_CACHE_DIR`
3. the platform default

The platform default is `$XDG_CACHE_HOME/ohrisk/artifacts` when
`XDG_CACHE_HOME` is set, `%LOCALAPPDATA%/Ohrisk/Cache/artifacts` on Windows, and
`~/.cache/ohrisk/artifacts` otherwise. The default is shared across projects so
identical remote evidence is downloaded once rather than copied into a
project-specific cache.

## Runtime options

```text
--cache-dir <path>       Persistent cache directory
--offline                Never perform a network request
--jobs <1..64>           Evidence collection concurrency
--timeout <duration>     Per-request timeout, for example 30s or 2m
--registry-url <https>   npm registry base URL
--registry-token-env <name>
--allow-host <hostname>  Additional allowed artifact host; repeatable
```

For Maven projects, `--allow-host` permits only an exact matching HTTPS
repository URL already declared in the scanned `pom.xml`; it does not construct
or discover arbitrary repository URLs. Maven Central remains the default. A
permitted Maven repository may supply bounded POM evidence and, only with a
same-repository SHA-256 sidecar plus exact embedded identity, JAR license files.

Go module ZIPs always use the fixed public `proxy.golang.org` adapter and the
exact `go.sum` `h1` checksum. `--registry-url` and `--allow-host` do not replace
or widen that proxy; official redirects remain limited to
`storage.googleapis.com` and receive no registry credentials.

Cache objects are verified by size and SHA-256 before use. Corrupt, truncated,
or mismatched entries are deleted and treated as misses. Writes use private
file permissions where supported, temporary files, and atomic rename so
parallel scans cannot publish a partial object.

## Freshness and revalidation

A response follows `Cache-Control: max-age`, `Cache-Control: no-cache`, and
`Expires` within a bounded one-year ceiling. When no usable freshness directive
exists, the default TTL is 24 hours. `Cache-Control: no-store` prevents
persistence and removes an older entry for the same request.

A fresh entry is reused without a network request. An expired entry with an
`ETag` or `Last-Modified` validator is rechecked with `If-None-Match` or
`If-Modified-Since`; HTTP `304` refreshes its metadata without rewriting the
artifact bytes. Conditional validators and registry authorization are not
forwarded across redirects.

Version 2 cache indexes are migrated lazily to version 3 when read. Migrated
entries are marked stale so the next online scan revalidates them instead of
assuming that an old object is fresh.

## Offline behavior

Offline mode reads local package sources, embedded SBOM evidence, and valid
cache entries. A valid expired entry remains usable offline because Ohrisk must
not perform DNS resolution or a network request in this mode. A missing,
corrupt, or oversized cache entry remains unavailable evidence; Ohrisk never
silently goes online.

## Capacity and cleanup

Successful writes enforce a default 2 GiB physical-object ceiling. When the
cache exceeds that ceiling, least-recently-used URL entries are removed until
the referenced object set fits; shared content is retained while another entry
still references it.

Use the management command for inspection and explicit cleanup:

```bash
ohrisk cache status
ohrisk cache status --json
ohrisk cache prune
ohrisk cache prune --max-age 7d --max-size 1GiB
ohrisk cache clear
```

`cache status` reports valid entries, physical objects, total bytes, stale and
corrupt entries, orphan objects, and oldest/newest access times. `cache prune`
removes expired entries and orphan objects by default; `--max-age` additionally
removes entries not accessed within the duration, and `--max-size` applies LRU
trimming to the requested physical size. `cache clear` removes only Ohrisk's
known index and object paths inside the selected cache directory. Both
destructive commands require the exact, regular-file Ohrisk ownership marker
to exist before inspection or removal; a missing, replaced, or mismatched
marker fails closed and leaves the directory untouched.

Scan-time cache initialization may create the marker only when the cache
directory is new or empty. A non-empty unmarked directory is never claimed as
an Ohrisk cache, and cache reads, revalidation, corruption cleanup, prune, and
clear do not mutate it.

`--json` returns the action and result without exposing an absolute cache path.
`--max-size` accepts byte units such as `512MiB`, `2GB`, or `0B`, and
`--max-age` accepts `ms`, `s`, `m`, `h`, or `d` durations.

## Authentication boundary

Registry tokens are read from the named environment variable at runtime. The
authorization header is attached only when the request hostname exactly matches
the configured registry host, and authenticated hosts must also be explicitly
allowed by policy or CLI configuration. Tokens, token environment values, raw
authorization headers, and credential-bearing URLs must never appear in cache
metadata, reports, or diagnostics.
