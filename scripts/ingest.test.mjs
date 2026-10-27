// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, checkGame } from './lib.mjs';
import { LABELS, parseIssueBody, buildManifest, findSource, extractZipSafe, findGameRoot, copyGame } from './ingest-lib.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kz-test-'));
const py = (code) => execFileSync('python3', ['-c', code], { encoding: 'utf8' });

function body(over = {}) {
  const v = {
    [LABELS.name]: 'Neon Snake', [LABELS.slug]: 'neon-snake',
    [LABELS.description]: 'Guide a glowing snake through a neon grid.',
    [LABELS.displayName]: 'Ada', [LABELS.coauthors]: '@grace, ada', [LABELS.license]: 'MIT',
    [LABELS.genre]: 'Arcade', [LABELS.tags]: 'arcade, snake',
    [LABELS.controls]: '- [x] Keyboard\n- [ ] Mouse\n- [x] Touch (phones and tablets)\n- [ ] Gamepad',
    [LABELS.accent]: '#f472b6', [LABELS.jpTitle]: '蛇',
    [LABELS.files]: '[game.zip](https://github.com/user-attachments/files/123456/game.zip)',
    [LABELS.repoUrl]: '_No response_',
    [LABELS.confirm]: '- [x] a\n- [x] b\n- [x] c',
    ...over,
  };
  return Object.entries(v).map(([k, val]) => `### ${k}\n\n${val}\n`).join('\n');
}

test('form labels in the issue template match the parser', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github/ISSUE_TEMPLATE/game_submission.yml'), 'utf8');
  const labels = [...yml.matchAll(/^\s+label: (.+)$/gm)].map((m) => m[1].trim());
  for (const l of Object.values(LABELS)) assert.ok(labels.includes(l), `template is missing label "${l}"`);
});

test('builds a manifest from a form submission', () => {
  const { manifest, errors } = buildManifest(parseIssueBody(body()), 'ada-l');
  assert.deepEqual(errors, []);
  assert.equal(manifest.slug, 'neon-snake');
  assert.deepEqual(manifest.controls, ['keyboard', 'touch']);
  assert.deepEqual(manifest.authors, [{ name: 'Ada', github: 'ada-l' }, { name: 'grace', github: 'grace' }, { name: 'ada', github: 'ada' }]);
  assert.equal(manifest.accent, '#f472b6');
});

test('the author is always the issue author, not a form field', () => {
  const { manifest } = buildManifest(parseIssueBody(body({ [LABELS.displayName]: 'Someone Else' })), 'real-user');
  assert.equal(manifest.authors[0].github, 'real-user');
});

test('rejects bad slugs, unticked boxes, bad licenses and usernames', () => {
  assert.ok(buildManifest(parseIssueBody(body({ [LABELS.slug]: '../evil' })), 'a').errors.length);
  assert.ok(buildManifest(parseIssueBody(body({ [LABELS.slug]: 'templates' })), 'a').errors.length);
  assert.ok(buildManifest(parseIssueBody(body({ [LABELS.confirm]: '- [x] a\n- [ ] b' })), 'a').errors.length);
  assert.ok(buildManifest(parseIssueBody(body({ [LABELS.license]: 'Proprietary' })), 'a').errors.length);
  assert.ok(buildManifest(parseIssueBody(body({ [LABELS.coauthors]: 'bad$name' })), 'a').errors.length);
});

test('finds the zip or repo source', () => {
  assert.equal(findSource(parseIssueBody(body())).type, 'zip');
  const repo = findSource(parseIssueBody(body({ [LABELS.files]: '_No response_', [LABELS.repoUrl]: 'https://github.com/you/games/tree/main/neon-snake' })));
  assert.deepEqual(repo, { type: 'repo', owner: 'you', repo: 'games', treePath: 'main/neon-snake' });
  assert.ok(findSource(parseIssueBody(body({ [LABELS.files]: '_No response_', [LABELS.repoUrl]: 'https://evil.example/x' }))).error);
  assert.ok(findSource(parseIssueBody(body({ [LABELS.files]: 'https://evil.example/game.zip' }))).error);
  assert.ok(findSource(parseIssueBody(body({ [LABELS.files]: '_No response_', [LABELS.repoUrl]: '' }))).error);
});

test('extracts a normal zip (inside a wrapper folder) and validates it end to end', () => {
  const d = tmp();
  py(`import zipfile;z=zipfile.ZipFile(r'${d}/g.zip','w');z.writestr('neon/index.html','<!doctype html><title>Neon</title><meta name="viewport" content="width=device-width">hi');z.writestr('neon/img/a.png','x');z.writestr('__MACOSX/neon/._index.html','x');z.close()`);
  extractZipSafe(path.join(d, 'g.zip'), path.join(d, 'out'));
  const root = findGameRoot(path.join(d, 'out'));
  assert.ok(root && root.endsWith('neon'));
  const games = path.join(d, 'games');
  copyGame(root, path.join(games, 'neon-snake'));
  const { manifest } = buildManifest(parseIssueBody(body()), 'ada-l');
  fs.writeFileSync(path.join(games, 'neon-snake', 'game.json'), JSON.stringify(manifest));
  const res = checkGame('neon-snake', games);
  assert.deepEqual(res.errors, []);
  assert.ok(!fs.existsSync(path.join(d, 'out', '__MACOSX')));
});

test('rejects zip-slip paths', () => {
  const d = tmp();
  py(`import zipfile;z=zipfile.ZipFile(r'${d}/e.zip','w');z.writestr('../evil.txt','x');z.writestr('index.html','x');z.close()`);
  assert.throws(() => extractZipSafe(path.join(d, 'e.zip'), path.join(d, 'out')), /unsafe path/);
  assert.ok(!fs.existsSync(path.join(d, 'evil.txt')));
});

test('rejects symlinks inside a zip', () => {
  const d = tmp();
  py(`import zipfile;z=zipfile.ZipFile(r'${d}/s.zip','w');z.writestr('index.html','x');i=zipfile.ZipInfo('link');i.create_system=3;i.external_attr=0o120777<<16;z.writestr(i,'/etc/passwd');z.close()`);
  assert.throws(() => extractZipSafe(path.join(d, 's.zip'), path.join(d, 'out')), /Symbolic links/);
});

test('submissions without index.html are rejected', () => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'readme.txt'), 'x');
  assert.equal(findGameRoot(d), null);
});

test('the repo\'s own games pass validation', () => {
  for (const s of ['cyber-strike', 'stickman-warfare']) assert.deepEqual(checkGame(s).errors, []);
});
