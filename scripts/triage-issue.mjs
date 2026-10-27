// Reads a bug report / idea issue and prints which game it is about, and who made it.
//   env: ISSUE_BODY   ->  stdout: {"slug": "...", "known": true, "authors": ["a","b"]}
import fs from 'node:fs';
import path from 'node:path';
import { GAMES_DIR, SLUG_RE, GITHUB_RE } from './lib.mjs';

export function gameFromBody(body) {
  const m = String(body || '').replace(/\r\n/g, '\n').match(/^### (?:Game or area|Game)\n\n([^\n]+)/m);
  const slug = m ? m[1].trim().toLowerCase().replace(/^`|`$/g, '') : '';
  return SLUG_RE.test(slug) ? slug : '';
}

export function triage(body) {
  const slug = gameFromBody(body);
  if (!slug) return { slug: '', known: false, authors: [] };
  try {
    const m = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, slug, 'game.json'), 'utf8'));
    return { slug, known: true, authors: m.authors.map((a) => a.github).filter((g) => GITHUB_RE.test(g)) };
  } catch { return { slug, known: false, authors: [] }; }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(triage(process.env.ISSUE_BODY)));
