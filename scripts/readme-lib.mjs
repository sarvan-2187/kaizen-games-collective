// Renders the generated parts of README.md and CONTRIBUTORS.md from the games' manifests.
// All manifest text is contributor-controlled, so it is escaped before it reaches Markdown/HTML.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, listGameDirs, checkGame } from './lib.mjs';

export const DEFAULT_REPO = 'sarvan-2187/kaizen-games-collective';

/** Escape text for safe use inside Markdown and inline HTML (numeric entities render identically). */
export function esc(s) {
  return String(s ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\\`*_{}[\]()#+!~|<>&"'@:/]/g, (c) => `&#${c.charCodeAt(0)};`)
    .trim();
}

export function siteUrl(repo) {
  const [owner, name] = repo.split('/');
  return `https://${owner.toLowerCase()}.github.io/${name}/`;
}

export function loadGames() {
  const games = [];
  for (const slug of listGameDirs()) {
    const { manifest, errors } = checkGame(slug);
    if (!errors.length) games.push(manifest);
  }
  return games.sort((a, b) => a.name.localeCompare(b.name));
}

export function makersOf(games) {
  const map = new Map();
  for (const g of games) {
    for (const a of g.authors) {
      const key = a.github.toLowerCase();
      if (!map.has(key)) map.set(key, { github: a.github, name: a.name, games: [] });
      map.get(key).games.push(g);
    }
  }
  return [...map.values()].sort((a, b) => b.games.length - a.games.length || a.name.localeCompare(b.name));
}

const authorLinks = (g) => g.authors.map((a) => `[${esc(a.name)}](https://github.com/${a.github})`).join(', ');
const platforms = (g) => ((g.controls || []).includes('touch') ? 'Desktop and mobile' : 'Desktop');

export function renderStats(games, makers) {
  return [
    `![Games](https://img.shields.io/badge/games-${games.length}-e63946?style=flat-square)`,
    `![Makers](https://img.shields.io/badge/makers-${makers.length}-d9a441?style=flat-square)`,
    `![License](https://img.shields.io/badge/license-MIT-4361ee?style=flat-square)`,
  ].join(' ');
}

export function renderGamesTable(games, repo = DEFAULT_REPO) {
  if (!games.length) return '_No games yet. Be the first to [submit one](CONTRIBUTING.md)._';
  const rows = games.map((g) =>
    `| [**${esc(g.name)}**](${siteUrl(repo)}games/${g.slug}/) | ${esc(g.genre || '')} | ${authorLinks(g)} | ${platforms(g)} | ${esc(g.license)} |`);
  return ['| Game | Genre | By | Platforms | License |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

export function renderContributorsGrid(makers, perRow = 6) {
  if (!makers.length) return '_Nobody yet. Your name could be here._';
  const cells = makers.map((m) =>
    `<td align="center" valign="top" width="${Math.floor(100 / perRow)}%"><a href="https://github.com/${m.github}"><img src="https://github.com/${m.github}.png?size=96" width="72" height="72" alt="${esc(m.name)}"><br><sub><b>${esc(m.name)}</b></sub></a><br><sub>${m.games.map((g) => esc(g.name)).join(', ')}</sub></td>`);
  const rows = [];
  for (let i = 0; i < cells.length; i += perRow) rows.push(`<tr>\n${cells.slice(i, i + perRow).join('\n')}\n</tr>`);
  return `<table>\n${rows.join('\n')}\n</table>`;
}

export function renderContributorsPage(games, makers, repo = DEFAULT_REPO) {
  const lines = [
    '# Makers',
    '',
    'Everyone who has made a game in the collective. This page is generated automatically after each merged pull request; do not edit it by hand.',
    '',
    renderContributorsGrid(makers, 5),
    '',
    '## Games by maker',
    '',
  ];
  for (const m of makers) {
    lines.push(`### [${esc(m.name)}](https://github.com/${m.github})`, '');
    for (const g of m.games) lines.push(`- [${esc(g.name)}](${siteUrl(repo)}games/${g.slug}/): ${esc(g.description)} (${esc(g.license)})`);
    lines.push('');
  }
  lines.push('## Want to be listed?', '', 'Submit a game with the [form](../../issues/new?template=game_submission.yml) or a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).', '');
  return lines.join('\n');
}

/** Replaces the text between <!-- NAME:START --> and <!-- NAME:END --> markers. Throws if markers are missing. */
export function replaceSection(text, name, body) {
  const start = `<!-- ${name}:START -->`, end = `<!-- ${name}:END -->`;
  const i = text.indexOf(start), j = text.indexOf(end);
  if (i === -1 || j === -1 || j < i) throw new Error(`Missing ${start} / ${end} markers`);
  return `${text.slice(0, i + start.length)}\n${body}\n${text.slice(j)}`;
}

export function buildDocs(readme, games, repo = DEFAULT_REPO) {
  const makers = makersOf(games);
  let out = replaceSection(readme, 'STATS', renderStats(games, makers));
  out = replaceSection(out, 'GAMES', renderGamesTable(games, repo));
  out = replaceSection(out, 'CONTRIBUTORS', renderContributorsGrid(makers));
  return { readme: out, contributors: renderContributorsPage(games, makers, repo) };
}

export function updateFiles(repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO) {
  const readmePath = path.join(ROOT, 'README.md');
  const { readme, contributors } = buildDocs(fs.readFileSync(readmePath, 'utf8'), loadGames(), repo);
  fs.writeFileSync(readmePath, readme);
  fs.writeFileSync(path.join(ROOT, 'CONTRIBUTORS.md'), contributors);
}
