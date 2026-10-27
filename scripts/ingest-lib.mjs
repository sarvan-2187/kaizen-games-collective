// Turns a "Submit a game" issue into games/<slug>/. Pure helpers, covered by ingest.test.mjs.
// Everything here treats the issue and the zip as untrusted: nothing from them is ever executed.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SLUG_RE, GITHUB_RE, HEX_RE, RESERVED_SLUGS, LICENSES, walk } from './lib.mjs';

// These must match the `label:` values in .github/ISSUE_TEMPLATE/game_submission.yml (a test checks it).
export const LABELS = {
  name: 'Game name',
  slug: 'URL name',
  description: 'Short description',
  displayName: 'Your name (as shown in credits)',
  coauthors: 'Co-authors (GitHub usernames)',
  license: 'License',
  genre: 'Genre',
  tags: 'Tags',
  controls: 'Controls',
  accent: 'Accent colour',
  jpTitle: 'Japanese title',
  files: 'Game files (ZIP)',
  repoUrl: 'Or a public GitHub repository',
  confirm: 'Confirmation',
};

export const LIMITS = { zipBytes: 25 * 1024 * 1024, unpackedBytes: 60 * 1024 * 1024, files: 500 };

export function parseIssueBody(body) {
  const sections = {};
  const parts = String(body || '').replace(/\r\n/g, '\n').split(/^### /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const value = (nl === -1 ? '' : part.slice(nl + 1)).trim();
    sections[heading] = value === '_No response_' ? '' : value;
  }
  const f = {};
  for (const [key, label] of Object.entries(LABELS)) f[key] = sections[label] ?? '';
  return f;
}

const CONTROL_MAP = [['keyboard', 'keyboard'], ['mouse', 'mouse'], ['touch', 'touch'], ['gamepad', 'gamepad']];

/** Returns { manifest, errors }. `login` is the issue author, taken from GitHub, never from the form. */
export function buildManifest(f, login) {
  const errors = [];
  if (!GITHUB_RE.test(login || '')) errors.push('Could not determine your GitHub username.');
  const checked = (f.confirm.match(/^- \[x\]/gim) || []).length;
  const boxes = (f.confirm.match(/^- \[[ xX]\]/gm) || []).length;
  if (!boxes || checked !== boxes) errors.push('Please tick every box under "Confirmation".');

  const slug = f.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) errors.push('"URL name" must be lowercase letters, numbers and dashes (and not a reserved name).');
  if (!LICENSES.includes(f.license.trim())) errors.push('Please choose a license from the list.');

  const co = f.coauthors.split(/[,\s]+/).map((c) => c.replace(/^@/, '').trim()).filter(Boolean);
  for (const c of co) if (!GITHUB_RE.test(c)) errors.push(`Co-author "${c.slice(0, 40)}" is not a valid GitHub username.`);
  const seen = new Set([String(login).toLowerCase()]);
  const authors = [{ name: (f.displayName.trim() || login || '').slice(0, 60), github: login }];
  for (const c of co) if (GITHUB_RE.test(c) && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); authors.push({ name: c, github: c }); }

  const manifest = {
    slug,
    name: f.name.trim(),
    description: f.description.replace(/\s+/g, ' ').trim(),
    authors,
    license: f.license.trim(),
    version: '1.0.0',
  };
  if (f.genre.trim()) manifest.genre = f.genre.trim();
  const tags = f.tags.split(',').map((t) => t.trim()).filter(Boolean);
  if (tags.length) manifest.tags = tags;
  const controls = [];
  for (const line of f.controls.split('\n')) {
    const m = line.match(/^- \[[xX]\]\s*(.+)$/);
    if (!m) continue;
    const hit = CONTROL_MAP.find(([, k]) => m[1].toLowerCase().startsWith(k));
    if (hit) controls.push(hit[0]);
  }
  if (controls.length) manifest.controls = controls;
  if (f.accent.trim()) { if (HEX_RE.test(f.accent.trim())) manifest.accent = f.accent.trim(); else errors.push('"Accent colour" must be a hex colour like #f472b6.'); }
  if (f.jpTitle.trim()) manifest.jpTitle = f.jpTitle.trim();
  return { manifest, errors };
}

const ZIP_URL_RE = /https:\/\/github\.com\/(?:user-attachments\/files\/\d+\/[^\s)"'<>]+?|[\w.-]+\/[\w.-]+\/files\/\d+\/[^\s)"'<>]+?)\.zip(?=[\s)"'<>]|$)/i;
const REPO_RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([\w.\-/]+?))?\/?$/;

export function findSource(f) {
  const zip = f.files.match(ZIP_URL_RE);
  if (zip) return { type: 'zip', url: zip[0] };
  const repo = f.repoUrl.trim();
  if (repo) {
    const m = repo.match(REPO_RE);
    if (!m) return { error: '"Public GitHub repository" must look like https://github.com/owner/repo (optionally /tree/branch/folder).' };
    return { type: 'repo', owner: m[1], repo: m[2], treePath: m[3] || '' };
  }
  if (f.files.trim()) return { error: 'The "Game files" box has no .zip link yet. Drag the zip in and wait for the link to appear (it can take a few seconds).' };
  return { error: 'Please upload a .zip of your game, or give a public GitHub repository.' };
}

/** Extracts a zip into destDir after checking names, counts and sizes. Throws Error(message) for bad zips. */
export function extractZipSafe(zipFile, destDir) {
  const run = (args) => execFileSync('unzip', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const names = run(['-Z1', zipFile]).split('\n').filter(Boolean);
  if (names.length > LIMITS.files) throw new Error(`The zip has ${names.length} files; the limit is ${LIMITS.files}.`);
  for (const n of names) {
    if (n.startsWith('/') || n.includes('\\') || n.split('/').includes('..')) throw new Error(`The zip contains an unsafe path ("${n.slice(0, 60)}").`);
  }
  const totals = run(['-Zt', zipFile]).match(/(\d+) files?, (\d+) bytes uncompressed/);
  if (totals && Number(totals[2]) > LIMITS.unpackedBytes) throw new Error('The zip is too large when unpacked (limit 60 MB).');
  fs.mkdirSync(destDir, { recursive: true });
  run(['-q', '-o', zipFile, '-x', '__MACOSX/*', '*/.DS_Store', '.DS_Store', '-d', destDir]);
  assertNoLinks(destDir);
}

export function assertNoLinks(dir) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) throw new Error('Symbolic links are not allowed in a submission.');
      if (e.isDirectory()) stack.push(p);
    }
  }
}

/** Finds the folder holding index.html: the top level, or a single wrapper folder. */
export function findGameRoot(dir) {
  if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  const subs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== '.git');
  if (subs.length === 1 && fs.existsSync(path.join(dir, subs[0].name, 'index.html'))) return path.join(dir, subs[0].name);
  return null;
}

/** Copies the game into destDir, skipping VCS and dependency folders. */
export function copyGame(root, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.cpSync(root, destDir, {
    recursive: true,
    filter: (src) => !/(^|[\\/])(\.git|node_modules|\.github)([\\/]|$)/.test(path.relative(root, src)),
  });
}

export function fileCount(dir) { return walk(dir).length; }
