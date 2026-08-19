# Project Initialization

`ohrisk init` turns the nearest supported dependency project into a usable
Ohrisk setup without replacing files that the project already owns.

```bash
ohrisk init
```

The command detects the same project root used by a local scan and merges
multiple supported inputs found at that one root. It creates a minimal
`.ohrisk.yml` beside those inputs. When the project is inside a Git repository,
the workflow is created at the repository root and receives a safe
`working-directory` for the detected project.

## Generated files

| File | Default | Contract |
| --- | --- | --- |
| `.ohrisk.yml` | yes | Minimal versioned policy. Add organization rules after reviewing the defaults. |
| `.github/workflows/ohrisk.yml` | yes | Pull-request `diff` gate pinned to the running Ohrisk version and immutable GitHub Action commits. |
| `.ohrisk-waivers.json` | `--waivers` only | Empty waiver decision-record template. It does not waive any finding. |

The generated workflow checks production dependencies against the pull
request's exact base commit. It uses `--all` only when initialization detected
multiple supported inputs at the selected project root.

## Options

```text
ohrisk init [--profile saas|distributed-app]
            [--fail-on high|unknown|review|low]
            [--no-workflow]
            [--waivers]
```

`--profile` and `--fail-on` configure the generated PR gate. `--no-workflow`
creates only local configuration. `--waivers` adds an empty waiver file for
teams that already have an exception-review process.

## Create-only behavior

Initialization never overwrites an existing target. Each target is reported as
`created`, `unchanged`, or `preserved`. `preserved` means a regular file already
exists with user-owned content, so Ohrisk left it untouched. Symbolic links and
non-regular target or parent entries fail closed.

All target paths are inspected before the first write. A filesystem race or
write failure after creation starts can leave earlier files in place; rerunning
`ohrisk init` resumes safely because every write uses create-only semantics.
Delete an unwanted generated file explicitly rather than relying on the command
to replace it.

The generated files are starter configuration, not legal approval. Review the
selected shipping profile, threshold, policy, and any future waiver before
committing them.
