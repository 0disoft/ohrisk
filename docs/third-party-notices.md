# Third-party notices

`ohrisk-notices` turns an Ohrisk-generated CycloneDX 1.5 report and explicitly
reviewed legal files into a deterministic `THIRD_PARTY_NOTICES.md` artifact.
It does not fetch, infer, or approve license text.

```bash
ohrisk scan --cyclonedx --output reports/ohrisk.cdx.json
ohrisk-notices \
  --sbom reports/ohrisk.cdx.json \
  --evidence notices-evidence.json \
  --output THIRD_PARTY_NOTICES.md
```

The evidence manifest uses the packaged
`ohrisk/schemas/notices-evidence` contract:

```json
{
  "$schema": "urn:ohrisk:schema:notices-evidence:1.0.0",
  "schemaVersion": "1.0.0",
  "packages": [
    {
      "purl": "pkg:npm/example@1.0.0",
      "copyright": ["Copyright Example"],
      "licenseFiles": ["legal/example-LICENSE.txt"],
      "noticeFiles": ["legal/example-NOTICE.txt"]
    }
  ]
}
```

All paths are relative to `--workspace` or the current directory. The SBOM,
manifest, legal files, and output must remain inside that boundary. Inputs are
bounded to 64 MiB for the SBOM, 2 MiB for the manifest and each legal file,
32 MiB total legal-file reads, 2,048 legal-file reads, and 50,000 components.

The generator normalizes legal-file line endings, hashes normalized contents
with SHA-256, emits identical text once, and records every referring package.
Package ordering, evidence ordering, and document ordering are deterministic.

Exit codes:

- `0`: the artifact was written with complete required evidence, or
  `--allow-incomplete` explicitly accepted gaps.
- `1`: the artifact was written but at least one included component lacks a
  license declaration, license text, or required NOTICE file.
- `2`: the input, schema version, path, size, or data shape is invalid; no
  completeness decision should be inferred.

Development-scope CycloneDX components are excluded by default. Pass
`--include-excluded` only when the release artifact intentionally covers them.
The generated document is review evidence, not legal advice or proof that all
distribution obligations have been satisfied.
