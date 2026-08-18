# Randomized HTML scan results

Seed: `20260818`

Result: `9/10` passed

| Mode | Repository | Root input | Format | Exit | HTML | Bytes | Time |
| --- | --- | --- | --- | ---: | --- | ---: | ---: |
| url | borgo-lang/borgo | Cargo.lock | repository URL | 0 | pass | 148654 | 1169 ms |
| url | BurntSushi/toml | go.mod | repository URL | 0 | pass | 20683 | 1084 ms |
| url | uber-go/automaxprocs | go.mod | repository URL | 0 | pass | 50588 | 937 ms |
| url | thoas/go-funk | go.mod | repository URL | 0 | pass | 46735 | 881 ms |
| url | imroc/req | go.mod | repository URL | 0 | pass | 81956 | 1547 ms |
| archive | tokio-rs/mini-redis | Cargo.lock | zip | 0 | pass | 65536 | 301 ms |
| archive | yoav-lavi/melody | Cargo.lock | tar.gz | 2 | fail | 0 | 147 ms |
| archive | mailru/easyjson | go.mod | zip | 0 | pass | 26096 | 246 ms |
| archive | anordal/shellharden | Cargo.lock | tar.gz | 0 | pass | 26865 | 136 ms |
| archive | uptrace/bun | go.mod | zip | 0 | pass | 65536 | 380 ms |

## Failures

### archive yoav-lavi/melody

Command: `ohrisk scan --html --archive repository.tar.gz`

Exit: `2`

```text
Ohrisk could not complete the command.
MULTIPLE_LOCKFILES: Multiple lockfiles found in the same archive project root. Scan all with --all.
archive: repository.tar.gz
entryPath: melody-main
lockfiles: Cargo.lock, flake.lock

```

