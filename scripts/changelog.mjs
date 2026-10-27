// Adds a merged pull request to CHANGELOG.md and prepares release notes + the thank-you comment.
//   env: PR_NUMBER, PR_TITLE, PR_AUTHOR, PR_URL, MERGED_AT, FILES_JSON (path), OUT_DIR, GITHUB_REPOSITORY
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, GAMES_DIR } from './lib.mjs';
import { esc, siteUrl, DEFAULT_REPO } from './readme-lib.mjs';

const MARKER = '<!-- CHANGELOG:START -->';

export function classify(files) {
  const added = new Set();
  const touched = new Set();
  for (const f of files) {
    const m = f.filename.match(/^games\/([a-z0-9]+(?:-[a-z0-9]+)*)\//);
    if (!m) continue;
    touched.add(m[1]);
    if (f.status === 'added' && f.filename === `games/${m[1]}/game.json`) added.add(m[1]);
  }
  if (added.size) return { kind: 'new-game', slugs: [...added] };
  if (touched.size) return { kind: 'game-update', slugs: [...touched] };
  const docsOnly = files.length > 0 && files.every((f) => /\.(md|png|svg)$/i.test(f.filename) || f.filename.startsWith('docs/'));
  return { kind: docsOnly ? 'docs' : 'platform', slugs: [] };
}

function manifestOf(slug) {
  try { return JSON.parse(fs.readFileSync(path.join(GAMES_DIR, slug, 'game.json'), 'utf8')); } catch { return null; }
}

export function buildEntry({ kind, slugs }, pr, repo) {
  const url = siteUrl(repo);
  const ref = `[#${pr.number}](${pr.url})`;
  const title = esc(pr.title);
  const names = slugs.map((s) => {
    const m = manifestOf(s);
    return m ? `[${esc(m.name)}](${url}games/${s}/)` : `\`${s}\``;
  });
  const by = (slugsIn) => {
    const people = new Set();
    for (const s of slugsIn) for (const a of manifestOf(s)?.authors || []) people.add(a.github);
    return [...people].map((p) => `[${esc(p)}](https://github.com/${p})`).join(', ');
  };
  switch (kind) {
    case 'new-game': return { label: 'New game', line: `- **New game:** ${names.join(', ')} by ${by(slugs) || esc(pr.author)} (${ref})` };
    case 'game-update': return { label: 'Game update', line: `- **Update:** ${names.join(', ')}: ${title} (${ref}, by [${esc(pr.author)}](https://github.com/${pr.author}))` };
    case 'docs': return { label: 'Docs', line: `- **Docs:** ${title} (${ref})` };
    default: return { label: 'Platform', line: `- **Platform:** ${title} (${ref})` };
  }
}

export function insertEntry(changelog, date, line, prNumber) {
  if (changelog.includes(`/pull/${prNumber})`)) return changelog; // already recorded
  const at = changelog.indexOf(MARKER);
  if (at === -1) throw new Error(`CHANGELOG.md is missing ${MARKER}`);
  const head = changelog.slice(0, at + MARKER.length);
  const rest = changelog.slice(at + MARKER.length);
  const heading = `## ${date}`;
  if (rest.trimStart().startsWith(heading)) {
    const idx = rest.indexOf(heading) + heading.length;
    return `${head}${rest.slice(0, idx)}\n\n${line}${rest.slice(idx).replace(/^\n\n/, '\n')}`.replace(/\n{3,}/g, '\n\n');
  }
  return `${head}\n\n${heading}\n\n${line}\n${rest.replace(/^\n+/, '\n')}`;
}

export function thanks({ kind, slugs }, pr, repo) {
  const url = siteUrl(repo);
  if (kind === 'new-game' || kind === 'game-update') {
    const people = new Set();
    for (const s of slugs) for (const a of manifestOf(s)?.authors || []) people.add(a.github);
    if (!people.size && !pr.author.endsWith('[bot]')) people.add(pr.author);
    const who = [...people].map((p) => `@${p}`).join(' ');
    const links = slugs.map((s) => `- ${url}games/${s}/`).join('\n');
    return `Thank you ${who}! Your ${kind === 'new-game' ? 'game is merged' : 'update is merged'} and will be live in about a minute:\n\n${links}\n\n${kind === 'new-game' ? 'You have been added to the [makers list](https://github.com/' + repo + '/blob/main/CONTRIBUTORS.md). ' : ''}If something looks wrong, open a [bug report](https://github.com/${repo}/issues/new?template=bug_report.yml).`;
  }
  return pr.author.endsWith('[bot]') ? '' : `Thanks for the contribution, @${pr.author}! This is merged and will be in the next deploy.`;
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const pr = { number: Number(process.env.PR_NUMBER), title: process.env.PR_TITLE || '', author: process.env.PR_AUTHOR || '', url: process.env.PR_URL || '' };
  if (!Number.isInteger(pr.number) || pr.number < 1) throw new Error('PR_NUMBER is required');
  const files = JSON.parse(fs.readFileSync(process.env.FILES_JSON, 'utf8'));
  const outDir = process.env.OUT_DIR || '.';
  const date = (process.env.MERGED_AT || new Date().toISOString()).slice(0, 10);

  const cls = classify(files);
  const entry = buildEntry(cls, pr, repo);
  const file = path.join(ROOT, 'CHANGELOG.md');
  fs.writeFileSync(file, insertEntry(fs.readFileSync(file, 'utf8'), date, entry.line, pr.number));

  fs.writeFileSync(path.join(outDir, 'release-notes.md'), `${entry.line}\n\nFull changelog: https://github.com/${repo}/blob/main/CHANGELOG.md\n`);
  fs.writeFileSync(path.join(outDir, 'thanks.md'), thanks(cls, pr, repo));
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ kind: cls.kind, slugs: cls.slugs, label: entry.label, tag: `v${date.replace(/-/g, '.')}-${pr.number}` }));
  console.log(`Changelog updated (${cls.kind}).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
