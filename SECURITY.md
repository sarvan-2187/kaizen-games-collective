# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private reporting: go to the **Security** tab of this repository and choose **Report a vulnerability**. We aim to reply within 7 days.

Examples we care about: a game that steals data or tracks players, code that escapes its page, a way to inject script through `game.json`, or a CI/workflow weakness.

## How games are handled

Every game runs on the same web origin as the rest of the site, so it could in principle read another game's saved data (`localStorage`). To reduce that risk:

- Every game's code is reviewed by a maintainer before it is merged, including games that arrive through the submission form (a bot opens the pull request; it never merges).
- The submission bot treats issue text and uploaded zips as untrusted data: no code from a submission is executed, zip paths and symlinks are rejected, and size limits apply.
- CI blocks scripts and styles from unapproved hosts (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- The home page renders `game.json` content as plain text only and validates links.
- Games must not collect personal data, show ads or use analytics.

If you spot a merged game breaking these rules, report it as above.

## Supported versions

Only the live site built from `main` is supported.
