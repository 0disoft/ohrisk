# Security Policy

## Supported versions

Security fixes are prepared for the latest published version of Ohrisk. Older
versions may be asked to upgrade before a fix is backported.

| Version | Supported |
| --- | --- |
| Latest published version | Yes |
| Older versions | No guaranteed backport |

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability. Use GitHub's private
[security advisory form](https://github.com/0disoft/ohrisk/security/advisories/new).
If that form is unavailable, email `rodisoft1@gmail.com` with the subject
`Ohrisk security report`.

Include only what is needed to reproduce and assess the issue:

- affected Ohrisk version and operating system;
- attack prerequisites and expected impact;
- minimal reproduction steps or a proof of concept;
- whether the issue is already public; and
- a safe way to contact you.

Remove registry tokens, repository credentials, private lockfiles, and other
secrets. Do not test against systems or repositories you do not own or have
permission to assess.

## Response and disclosure

The maintainer aims to acknowledge a complete report within 7 calendar days.
After triage, the reporter will receive a severity decision, remediation plan,
or a request for more evidence. Material status changes are shared at least
every 14 calendar days while a confirmed issue remains open.

Confirmed vulnerabilities are fixed and tested before coordinated disclosure.
The advisory, release notes, and credit are published together when practical.
Please keep report details private until the maintainer and reporter agree that
users have had a reasonable opportunity to update.

## Security scope

Reports are especially useful for remote fetch validation, archive handling,
path traversal or symlink boundaries, command execution, credential leakage,
cache integrity, Git ref handling, and release or GitHub Action supply-chain
behavior. License classification disagreements without a security impact belong
in the dedicated license-result issue form.
