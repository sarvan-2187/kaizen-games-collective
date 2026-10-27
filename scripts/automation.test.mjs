// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, siteUrl, makersOf, renderGamesTable, renderContributorsGrid, renderContributorsPage, replaceSection, buildDocs } from './readme-lib.mjs';
import { classify, insertEntry, buildEntry, thanks } from './changelog.mjs';
import { gameFromBody, triage } from './triage-issue.mjs';

const games = [
  { slug: 'beta', name: 'Beta', description: 'B game here.', genre: 'Arcade', license: 'MIT', controls: ['keyboard', 'touch'], authors: [{ name: 'Ada', github: 'ada' }] },
  { slug: 'alpha', name: 'Alpha', description: 'A game here.', genre: 'Racing', license: 'MIT', controls: ['keyboard'], authors: [{ name: 'Ada', github: 'ada' }, { name: 'Grace', github: 'grace' }] },
];
games.sort((a, b) => a.name.localeCompare(b.name));

test('esc neutralises markdown, html and mentions', () => {
  const out = esc('<img src=x onerror=alert(1)> **bold** [x](y) @everyone | `c`\nnew');
  for (const bad of ['<', '>', '*', '[', ']', '@', '|', '`', '\n']) assert.ok(!out.includes(bad), `still contains ${JSON.stringify(bad)}`);
});

test('site url follows owner and repo', () => {
  assert.equal(siteUrl('Sarvan-2187/kaizen-games-collective'), 'https://sarvan-2187.github.io/kaizen-games-collective/');
});

test('makers are sorted by game count then name, with all their games', () => {
  const m = makersOf(games);
  assert.deepEqual(m.map((x) => x.github), ['ada', 'grace']);
  assert.equal(m[0].games.length, 2);
});

test('games table lists every game and escapes hostile names', () => {
  const evil = [{ ...games[0], name: '<script>alert(1)</script>', authors: [{ name: '[x](javascript:1)', github: 'ada' }] }];
  const t = renderGamesTable(evil);
  assert.ok(!t.includes('<script>'));
  assert.ok(!t.includes('](javascript:'));
  assert.match(renderGamesTable(games), /Alpha[\s\S]*Beta/);
  assert.match(renderGamesTable([]), /No games yet/);
});

test('contributors grid wraps into rows', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ github: `u${i}`, name: `U${i}`, games: [games[0]] }));
  assert.equal((renderContributorsGrid(many, 6).match(/<tr>/g) || []).length, 2);
  assert.ok(renderContributorsPage(games, makersOf(games)).includes('## Games by maker'));
});

test('replaceSection is idempotent and fails loudly without markers', () => {
  const doc = 'a\n<!-- X:START -->\nold\n<!-- X:END -->\nb';
  const once = replaceSection(doc, 'X', 'new');
  assert.equal(replaceSection(once, 'X', 'new'), once);
  assert.ok(once.includes('new') && !once.includes('old'));
  assert.throws(() => replaceSection('nothing', 'X', 'y'), /Missing/);
});

test('buildDocs fills README sections and builds the makers page', () => {
  const readme = ['<!-- STATS:START -->', '<!-- STATS:END -->', '<!-- GAMES:START -->', '<!-- GAMES:END -->', '<!-- CONTRIBUTORS:START -->', '<!-- CONTRIBUTORS:END -->'].join('\n');
  const { readme: out, contributors } = buildDocs(readme, games);
  assert.match(out, /games-2/);
  assert.match(out, /Alpha/);
  assert.match(out, /github.com\/ada.png/);
  assert.match(contributors, /Grace/);
  assert.equal(buildDocs(out, games).readme, out);
});

test('classifies pull requests by files changed', () => {
  assert.deepEqual(classify([{ filename: 'games/neon/game.json', status: 'added' }, { filename: 'games/neon/index.html', status: 'added' }]), { kind: 'new-game', slugs: ['neon'] });
  assert.equal(classify([{ filename: 'games/cyber-strike/index.html', status: 'modified' }]).kind, 'game-update');
  assert.equal(classify([{ filename: 'README.md', status: 'modified' }, { filename: 'docs/x.md', status: 'added' }]).kind, 'docs');
  assert.equal(classify([{ filename: 'scripts/build.mjs', status: 'modified' }]).kind, 'platform');
});

test('changelog entries are added newest-first, grouped by date, and never duplicated', () => {
  const base = '# Changelog\n\n<!-- CHANGELOG:START -->\n\n## 2026-10-01\n\n- old (#1)\n';
  const a = insertEntry(base, '2026-10-02', '- new ([#2](https://x/pull/2))', 2);
  assert.ok(a.indexOf('2026-10-02') < a.indexOf('2026-10-01'));
  const b = insertEntry(a, '2026-10-02', '- second ([#3](https://x/pull/3))', 3);
  assert.equal((b.match(/## 2026-10-02/g) || []).length, 1);
  assert.equal(insertEntry(b, '2026-10-02', '- again ([#3](https://x/pull/3))', 3), b);
  assert.throws(() => insertEntry('no marker', 'd', 'l', 1), /missing/);
});

test('changelog and thanks text escape the pull request title', () => {
  const pr = { number: 5, title: 'Fix <b>@everyone</b> [x](y)', author: 'octocat', url: 'https://x/pull/5' };
  const { line } = buildEntry({ kind: 'platform', slugs: [] }, pr, 'a/b');
  assert.ok(!line.includes('@everyone') && !line.includes('<b>'));
  assert.equal(thanks({ kind: 'platform', slugs: [] }, { ...pr, author: 'dependabot[bot]' }, 'a/b'), '');
  assert.match(thanks({ kind: 'platform', slugs: [] }, pr, 'a/b'), /@octocat/);
});

test('bug reports map to a game and its authors', () => {
  assert.equal(gameFromBody('### Game\n\ncyber-strike\n\n### What happened?'), 'cyber-strike');
  assert.equal(gameFromBody('### Game or area\n\n`site`\n'), 'site');
  assert.equal(gameFromBody('### Game\n\n../../etc\n'), '');
  assert.equal(gameFromBody('### Game files (ZIP)\n\nfoo'), '');
  const t = triage('### Game\n\ncyber-strike\n');
  assert.equal(t.known, true);
  assert.deepEqual(t.authors, ['sarvan-2187']);
  assert.equal(triage('### Game\n\nnope-game\n').known, false);
});
