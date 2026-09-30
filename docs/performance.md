# Inspection performance

The repository-owned `ohrisk_benchmark_inspection` intent runs a bounded
synthetic benchmark with 256 independent npm TAR.GZ artifacts and eight jobs.
It uses injected in-memory HTTP responses and accesses no external network.
Results are written to ignored `.tmp/inspection-benchmark/results.json`.

Each measured mode runs in a fresh Bun process. Cold starts with an empty cache;
warm and offline caches are primed by separate processes before measurement.
The harness rejects warm/offline runs that perform a fetch or lose evidence.

The output measures collection, gzip decompression, license normalization,
combined JSON/HTML/CycloneDX rendering, total time and peak RSS. Collection
includes parsing and decompression: its time and nested decompression time
must not be summed. The decompression probe covers the shared TAR.GZ reader
used by this fixture, not every supported archive codec. Disabled probes only
invoke the original work and do not read clocks or sample memory.

Process high-water RSS includes fixture setup but excludes cache priming.
On hosts without process high-water RSS, phase-boundary samples are explicitly
labelled as a lower bound. Synthetic transport excludes real DNS and network
latency; results do not establish throughput or a bottleneck for a customer
repository. Optimization decisions require a relevant representative sample.

## Local reference run

Windows x64, Bun 1.4.2, 256 fixture packages and eight jobs. One local run,
2026-10-01; these values are observations, not regression thresholds.

| Cache | Collect ms | Nested gzip ms | Normalize ms | Render ms | Total ms | Peak RSS MiB | Fetches |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cold | 4272.4 | 37.0 | 60.5 | 70.4 | 4442.0 | 86.8 | 256 |
| Warm | 2131.8 | 31.4 | 66.4 | 64.6 | 2313.7 | 87.7 | 0 |
| Offline | 2484.6 | 26.4 | 65.5 | 65.8 | 2691.8 | 90.6 | 0 |

All modes retained 256 evidence records and identical JSON, HTML and CycloneDX
output sizes. Collection includes cache I/O, checksum checks, archive parsing
and scheduling. These measurements do not isolate any one of those as the
cause of the collection cost. Runtime output identifies the Bun-provided Node
compatibility version; the actual runner is Bun.
