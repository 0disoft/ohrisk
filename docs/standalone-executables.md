# Standalone Executables

Ohrisk publishes six release assets that run without a separately installed
Node.js or Bun runtime:

| Asset | Operating system | Architecture | Compatibility |
| --- | --- | --- | --- |
| `ohrisk-linux-x64` | Linux | x64 | glibc, baseline x64 CPU |
| `ohrisk-linux-arm64` | Linux | arm64 | glibc |
| `ohrisk-macos-x64` | macOS | Intel x64 | baseline x64 CPU |
| `ohrisk-macos-arm64` | macOS | Apple Silicon | arm64 |
| `ohrisk-windows-x64.exe` | Windows | x64 | baseline x64 CPU |
| `ohrisk-windows-arm64.exe` | Windows | arm64 | Windows on ARM |

The npm package remains the primary package-manager installation path. The
standalone assets are an additional distribution surface for users who do not
want Node.js in a container, workstation, or CI runner.

## Download

Open the matching tagged GitHub Release and download one executable plus
`SHA256SUMS`. GitHub CLI users can select exact assets explicitly:

```bash
gh release download vX.Y.Z \
  --repo 0disoft/ohrisk \
  --pattern ohrisk-linux-x64 \
  --pattern SHA256SUMS
```

Replace `vX.Y.Z` and the asset name with the exact release and platform you
intend to run. Do not download an executable from an issue attachment, mirror,
or mutable branch artifact.

## Verify and run on Linux

```bash
sha256sum --check SHA256SUMS --ignore-missing
chmod +x ohrisk-linux-x64
./ohrisk-linux-x64 version
./ohrisk-linux-x64 scan
```

The current Linux executables target glibc. Alpine and other musl-only systems
should use the npm package or a glibc-compatible container until dedicated musl
assets are released.

## Verify and run on macOS

```bash
grep '  ohrisk-macos-arm64$' SHA256SUMS | shasum -a 256 --check
chmod +x ohrisk-macos-arm64
./ohrisk-macos-arm64 version
./ohrisk-macos-arm64 scan
```

Choose `ohrisk-macos-x64` on an Intel Mac and
`ohrisk-macos-arm64` on Apple Silicon.

## Verify and run on Windows PowerShell

```powershell
$asset = "ohrisk-windows-x64.exe"
$expected = (
  Select-String -Path .\SHA256SUMS -Pattern "$([regex]::Escape($asset))$"
).Line.Split()[0].ToLowerInvariant()
$actual = (Get-FileHash ".\$asset" -Algorithm SHA256).Hash.ToLowerInvariant()

if ($actual -ne $expected) {
  throw "Checksum mismatch for $asset"
}

& ".\$asset" version
& ".\$asset" scan
```

Choose `ohrisk-windows-arm64.exe` for native Windows on ARM.

## Signing status

The first standalone release assets are not code-signed or notarized. macOS
Gatekeeper and Windows SmartScreen can therefore show an unidentified-publisher
warning. `SHA256SUMS` proves that the downloaded bytes match the assets attached
to the GitHub Release, but it does not establish a platform publisher identity.

Do not disable Gatekeeper, SmartScreen, or system-wide execution policy. Verify
the checksum, inspect the tagged source and release workflow when required, and
use the npm package when local policy requires signed executables. Platform code
signing should be added only after release certificates and protected secrets
have explicit owners and rotation procedures.

## Release integrity

The tag workflow follows this order:

1. Verify the tag, package version, tests, package smoke, and release notes.
2. Create or refresh a draft GitHub Release.
3. Build all six targets with the pinned Bun version.
4. Check each executable format and architecture header.
5. Execute `version` and `explain MIT --json` for the native target on each
   runner.
6. Upload the executables to the draft release.
7. Publish and verify the npm package.
8. Download the release assets again, calculate one deterministic
   `SHA256SUMS`, upload it, and publish the GitHub Release.

A failed build, smoke check, npm verification, or checksum step leaves the
GitHub Release in draft state. Rerunning the same tag workflow replaces assets
with the same names and can complete the interrupted release without publishing
a second npm version.
