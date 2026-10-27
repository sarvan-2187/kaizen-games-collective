# Maintainer guide

## Before making the repository public

Do these once, in this order.

**Content**
- [ ] Search the full git history for secrets, personal emails and private URLs (`git log -p | grep -i -E "key|token|secret|password"`). History is public too. Current commits use the `noreply` author address.
- [ ] Confirm you own, or have permission for, everything in both starter games (art, sounds, fonts, code) and that the `MIT` license in their `game.json` is what you want.
- [ ] Replace `sarvan-2187` in `authors[].name` with the display name you want credited.
- [ ] If the repo name or owner changes, update the fallback in `scripts/build.mjs` and the URLs in `index.html`, `.github/ISSUE_TEMPLATE/config.yml` and `README.md`. (CI passes the real name through `GITHUB_REPOSITORY`, so the deployed site's links already follow a rename.)

**Repository settings** (Settings in GitHub)
- [ ] General: add a description and topics (`browser-games`, `html5-games`, `open-source`); enable Issues; enable Discussions (optional).
- [ ] General → Pull Requests: enable "Automatically delete head branches".
- [ ] Branches → add a rule for `main`: require a pull request, require 1 approval, require review from Code Owners, require the **Validate games** status check, block force pushes, and include administrators once you have a second maintainer.
- [ ] Actions → General: set "Fork pull request workflows" to require approval for first-time contributors, and workflow permissions to **read** by default.
- [ ] Actions → General → Workflow permissions: tick **Allow GitHub Actions to create and approve pull requests**. The form-submission bot needs this to open pull requests (it asks for write access per workflow, so the read default stays).
- [ ] Security: enable private vulnerability reporting, Dependabot alerts and secret scanning.
- [ ] Pages: Source = **GitHub Actions**. (Pages on a private repo needs a paid GitHub plan; it is free once the repo is public.)
- [ ] Issues → Labels: create `game-proposal`, `game-bug`, `good first issue`, `needs-author` and `mobile`.

## Reviewing a game submission

CI checks the manifest, file sizes and external hosts. It cannot tell if a game is safe or appropriate, so a human must:

1. Read the JavaScript. Look for network requests (`fetch`, `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon`), `eval`/`new Function`, `localStorage`/`document.cookie` access beyond the game's own save, `window.top`/`parent` access and redirects.
2. Play it on desktop and, if it lists `touch`, on a phone.
3. Check the assets and license claim, and that the content is all-ages.
4. Confirm `authors[].github` points at the people who made it.
5. Merge. The Pages workflow publishes it.

All games share one origin, so a malicious game could read another game's `localStorage`. Review is the main defence. If submissions grow, the next step is to serve each game from its own sandboxed iframe.

## Form submissions (the bot)

`.github/workflows/game-submission.yml` runs when someone opens or edits an issue titled `[game submission] ...` (created from `.github/ISSUE_TEMPLATE/game_submission.yml`). It:

1. Labels the issue `game-submission` and enforces a limit of 3 open submissions per person.
2. Runs `scripts/ingest-submission.mjs`: reads the form, downloads the attached `.zip` (or clones the public repo), unpacks it safely (no `..` paths, no symlinks, size and file-count limits), writes `games/<slug>/game.json` with the **issue author as the credited author**, and runs the same validator as CI.
3. On failure, comments the problems on the issue; the submitter edits the issue and it re-runs.
4. On success, pushes `submission/issue-<n>`, opens a PR (`Closes #n`) containing a reviewer checklist, and triggers the **Validate games** workflow on that branch (PRs made with the default token don't trigger it on their own).

It never executes submitted code. Treat the resulting PR exactly like any other game PR: read the JavaScript before merging. Merging closes the issue and publishes the game.

Notes:
- If the PR doesn't appear, check Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests".
- Attachment downloads work for public repos. In a private repo the bot retries with its token; if GitHub still refuses, ask the submitter to link a public repo instead.
- If the **Validate games** check is required but shows as missing on a bot PR, re-run it from the Actions tab (workflow dispatch on the `submission/issue-<n>` branch).
- To change the form fields, update `LABELS` in `scripts/ingest-lib.mjs` too. `npm test` fails if they drift apart.

## Credits and bug reports

- **Credits** come from `authors` in each `game.json`. The home page's Makers section is generated from them.
- **Bug reports** go to the `bug_report.yml` issue form with the game's slug filled in. Triage by tagging `@authors` from the game's `game.json` in the issue and adding the `game-bug` label. Add game folders to `.github/CODEOWNERS` so authors are requested on PRs touching their game.

## Releasing

Merging to `main` deploys. There is no separate release step.
