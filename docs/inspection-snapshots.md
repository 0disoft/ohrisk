# Inspection snapshots

`scan` and `ci` can save the collected dependency graph and license evidence:

```sh
ohrisk scan --snapshot inspection.json --json --output report.json
ohrisk ci --from-snapshot inspection.json --policy new-policy.yml --no-waivers --json
```

`--from-snapshot` does not discover dependencies, read installed packages,
acquire artifacts, or access the network. It normalizes stored evidence using
the current tool, profile, policy and local waivers. Use `--no-waivers` for an
unwaived comparison. CI evidence and graph gates still apply. Production-only
snapshots require `--prod` on replay; full snapshots may be narrowed. Replay
rejects repository, archive, lockfile, all-input and registry selection flags.

Snapshots use a separate 1.0.0 schema, exported at
`ohrisk/schemas/inspection-snapshot.schema.json`. They record tool and rule
versions (rules ship with that tool version), the SPDX source commit, selected
input hashes, resolved policy and loaded waiver digests, the graph, extracted
evidence and artifact receipts. Saved replays record the parent payload digest
and retain original receipts. Stderr identifies policy, rule-version and waiver
changes. Replay results use existing scan report schemas and renderers.

Input hashes cover selected regular dependency files observed before graph
parsing and rechecked after collection. Additional manifests read by an adapter
are not an exhaustive filesystem snapshot. Directory, unreadable and oversized
inputs record `status: unavailable`; archives record the archive byte hash.
Artifact SHA-256 is separate from declared integrity checks. Neither content
hashes nor unsigned snapshots authenticate a publisher. Cache reuse validates
stored object hashes; replay validates the payload digest and graph references.

The reader limits snapshots to 32 MiB and bounds nodes, edges, paths, evidence
files and artifact receipts. It rejects missing package evidence, duplicate IDs,
unknown graph references and digest mismatches. Receipt truncation is explicit.
Output paths follow the safe report writer and must differ from report paths.

HTTP URLs omit credentials, query strings and fragments. Environment tokens
and request headers are not stored. Extracted license text and private package
names can still be sensitive: snapshots are local inspection data, not shareable
reports. Keep them out of version control unless deliberately owned by the
project. Raw downloaded archives are not embedded; replay uses extracted text.
