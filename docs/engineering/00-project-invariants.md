# Project Invariants

- Status: Project-owned

## Invariants

- Published CLI runtime support is Node.js `>=24.0.0`.
- Bun is a development, test, and packaging tool, not a user runtime requirement.
- Severity and waiver semantics must be covered by tests before they change.
- Shareable reports must use project-relative or sanitized paths.
- The composite action must reject unsafe repository-relative path inputs before invoking the CLI.
- `dist/`, caches, local reports, and generated outputs are not source truth.

## Required Evidence

- TypeScript changes: `bun run typecheck`
- Behavior changes: `bun test`
- Release/package changes: `bun run verify:release`
- ssealed scaffold changes: `ssealed doctor --strict`
