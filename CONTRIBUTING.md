# Contributing to Kaizen Games Collective

Thanks for wanting to add a game or fix one. This page covers everything you need.

## Ways to contribute

- **Submit a new game** (details below)
- **Fix a bug or improve a game.** If you are not the game's author, open an issue first for anything bigger than a small fix; the authors are listed in the game's `game.json`.
- **Report a bug** with the [bug report form](../../issues/new?template=bug_report.yml)
- **Improve the platform**: home page, scripts, docs

## Two ways to submit

| | **Form** (no Git needed) | **Pull request** (traditional) |
| --- | --- | --- |
| Best for | Makers who just have a game folder | Anyone comfortable with Git |
| How | Open the [Submit a game form](../../issues/new?template=game_submission.yml), fill it in and attach a `.zip` of your game | Fork, add `games/<slug>/`, open a PR |
| What happens | A bot checks your game, then opens a pull request for you | CI checks your PR |
| Review | A maintainer reviews the code either way | Same |
| Credit | Your GitHub username is added as the author automatically | You list yourself in `game.json` |

Both end in the same place: a pull request that a maintainer reads before the game goes live. The rules below apply to both.

### Using the form

1. Put your game in a folder. `index.html` must be the entry point, with extra files (images, audio, scripts) next to it, referenced by **relative** paths.
2. Zip the folder. `index.html` can be at the top level of the zip or inside a single folder.
3. Open the [Submit a game form](../../issues/new?template=game_submission.yml), fill it in, and **drag the `.zip` into the "Game files" box**. Wait for the link to appear before submitting. (GitHub issues can't hold the game's code as text, so a zip is required. Max 25 MB. Alternatively, give the address of a public GitHub repository.)
4. Submit. Within a minute the bot comments on your issue: either a list of things to fix, or a link to your pull request.
5. To fix problems, **edit your issue** (change the form answers or re-attach a zip). The bot re-checks and updates your pull request automatically. You can have up to 3 open submissions at once.

The form can only create new games or update your own game. To change someone else's game, open a pull request.

## Submit a game with a pull request

### 1. Make your game fit

- It lives in `games/<slug>/`, where `<slug>` is lowercase letters, numbers and dashes (for example `neon-snake`).
- The entry point is `games/<slug>/index.html`. It must work when served from that folder, so use **relative** paths for your own files (`./sprites/hero.png`, not `/sprites/hero.png`).
- It must run in a modern browser with no build step and no server.
- You can add images, audio and extra scripts in the same folder.
- Size limits: 5 MB per file, 15 MB per game.
- External scripts, styles and fonts may only come from: `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com`, `cdn.tailwindcss.com`, `code.jquery.com`, `fonts.googleapis.com`, `fonts.gstatic.com`. Pin versions (for example `three@0.128.0`). Anything else must be bundled in your folder.
- Include `<meta name="viewport" content="width=device-width, initial-scale=1">` and a `<title>`.
- **Phones matter.** Please support touch if you can, and list `"touch"` in `controls` only if it is genuinely playable on a phone. Desktop-only games are accepted but are labelled as such.
- Don't add your own "back to Kaizen" or "report a bug" links; the build adds them.

### 2. Content and legal rules

- Suitable for all ages: no explicit sexual content, no graphic gore, no hate or harassment.
- No ads, no analytics or tracking, no crypto-mining, no collecting personal data, no login or payment prompts.
- Only submit work you made or have the right to share. Third-party assets (art, sound, fonts, code) must be compatible with your chosen license, and you should credit them in your game or a `CREDITS.md` in your folder.
- Pick one of the licenses allowed in `game.json` (below). Your game's source is public in this repo, so it must be open source.
- AI-assisted games are welcome. You are still responsible for the result, including its license and bugs.

### 3. Add `game.json`

Copy `templates/game-template/game.json` and edit it:

```json
{
  "slug": "neon-snake",
  "name": "Neon Snake",
  "description": "Guide a glowing snake through a neon grid. How long can you get?",
  "authors": [{ "name": "Ada Lovelace", "github": "ada" }],
  "license": "MIT",
  "version": "1.0.0",
  "genre": "Arcade",
  "tags": ["arcade", "snake", "casual"],
  "controls": ["keyboard", "touch"],
  "accent": "#f472b6",
  "jpTitle": "蛇"
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `slug` | yes | Must match the folder name |
| `name` | yes | 2-40 characters |
| `description` | yes | 10-200 characters, one or two sentences |
| `authors` | yes | 1-10 people. `github` is a username without `@`. This is how credit and bug notifications work |
| `license` | yes | One of `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `MPL-2.0`, `GPL-3.0-only`, `CC0-1.0`, `CC-BY-4.0`, `Unlicense` |
| `version` | no | `1.2.3` style. Bump it when you change the game |
| `genre` | no | Shown on the card |
| `tags` | no | Up to 6 short tags |
| `controls` | no | Any of `keyboard`, `mouse`, `touch`, `gamepad` |
| `accent` | no | Hex colour for your card |
| `jpTitle` | no | Short Japanese title shown vertically on your card (1-8 characters). Optional, purely decorative |

### 4. Check it locally

```bash
npm run validate     # same checks CI runs
npm run preview      # opens the full site at http://localhost:8080
```

Test your game on a real phone if you claim touch support.

### 5. Open a pull request

(If you used the form, skip this section; the bot does it for you.)

- One game per pull request.
- Touch only your own `games/<slug>/` folder, unless you are also fixing the platform. Keep unrelated changes out.
- Fill in the pull request template. CI will validate your files and report problems on the PR.
- A maintainer reviews the code of every game before merge. We read the JavaScript, because your game will run on our domain. Obfuscated or minified-only code without source will be asked to include the source.

## Updating or fixing an existing game

Small fixes (typos, bugs, mobile fixes) can go straight to a pull request. If you are not already listed in `authors`, add yourself in the same PR when your contribution is substantial; the original author or a maintainer will confirm.

## Bug reports

Use the [bug report form](../../issues/new?template=bug_report.yml). The **Report a bug** buttons on the site open it with the game filled in. Please include your device, browser and steps to reproduce.

## Code style

There is no framework or linter for games; follow the style of the file you are editing. For platform scripts: plain Node.js ES modules, no dependencies.

## Conduct

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
