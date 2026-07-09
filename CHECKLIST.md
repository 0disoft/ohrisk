# Checklist Router

- Status: Project-owned

Use this file as a router. Do not turn it into one giant checklist.

- CLI command changes: `.agents/skills/cli-tool/SKILL.md` and `.agents/checklists/cli-tool.md`
- GitHub Action changes: `.agents/skills/github-action/SKILL.md` and `.agents/checklists/github-action.md`
- Dependency parser or evidence changes: `docs/cli/command-contract.md`, relevant `src/graph/` or `src/evidence/` tests, and `.agents/checklists/security.md`
- Risk policy, waiver, or report-format changes: `docs/profiles.md`, `docs/waivers.md`, `docs/report-formats.md`, and relevant tests
- Documentation-only changes: update the owning guide and any doc contract tests that assert examples or command output
- Release/package changes: `RELEASING.md`, `CHANGELOG.md`, `package.json`, and `bun run verify:release`
- Repository hygiene changes: `.agents/checklists/security.md` and `.agents/checklists/ops-change.md`
