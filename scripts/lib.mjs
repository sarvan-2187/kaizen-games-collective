// Shared helpers for validating and building the game registry.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GAMES_DIR = path.join(ROOT, 'games');

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const GITHUB_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const RESERVED_SLUGS = new Set(['assets', 'templates', 'api', 'admin']);
export const CONTROLS = ['keyboard', 'mouse', 'touch', 'gamepad'];
export const LICENSES = [
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MPL-2.0',
  'GPL-3.0-only', 'CC0-1.0', 'CC-BY-4.0', 'Unlicense',
];
// Hosts a game may load scripts/styles/fonts from. Everything else must be bundled in the game folder.
export const ALLOWED_HOSTS = [
  'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdn.tailwindcss.com',
  'code.jquery.com', 'fonts.googleapis.com', 'fonts.gstatic.com',
];
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_GAME_BYTES = 15 * 1024 * 1024;

export function listGameDirs() {
  if (!fs.existsSync(GAMES_DIR)) return [];
  return fs.readdirSync(GAMES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Returns { manifest, errors, warnings } for one games/<slug> folder. */
export function checkGame(slug, gamesDir = GAMES_DIR) {
  const errors = [];
  const warnings = [];
  const dir = path.join(gamesDir, slug);
  const err = (m) => errors.push(`games/${slug}: ${m}`);
  const warn = (m) => warnings.push(`games/${slug}: ${m}`);

  if (!SLUG_RE.test(slug)) err('folder name must be lowercase-kebab-case (a-z, 0-9, dashes)');
  if (RESERVED_SLUGS.has(slug)) err(`"${slug}" is a reserved name`);

  const indexPath = path.join(dir, 'index.html');
  if (!fs.existsSync(indexPath)) err('missing index.html');

  const manifestPath = path.join(dir, 'game.json');
  let m = null;
  if (!fs.existsSync(manifestPath)) {
    err('missing game.json (copy templates/game-template/game.json)');
  } else {
    try { m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch (e) { err(`game.json is not valid JSON: ${e.message}`); }
  }

  if (m) {
    const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
    if (m.slug !== slug) err(`game.json "slug" must equal the folder name ("${slug}")`);
    if (!str(m.name, 2, 40)) err('"name" must be 2-40 characters');
    if (!str(m.description, 10, 200)) err('"description" must be 10-200 characters');
    if (!Array.isArray(m.authors) || m.authors.length < 1 || m.authors.length > 10) {
      err('"authors" must be a list of 1-10 people');
    } else {
      m.authors.forEach((a, i) => {
        if (!a || !str(a.name, 1, 60)) err(`authors[${i}].name must be 1-60 characters`);
        if (!a || typeof a.github !== 'string' || !GITHUB_RE.test(a.github)) err(`authors[${i}].github must be a valid GitHub username (no @)`);
      });
    }
    if (!LICENSES.includes(m.license)) err(`"license" must be one of: ${LICENSES.join(', ')}`);
    if (m.version !== undefined && !/^\d+\.\d+\.\d+$/.test(String(m.version))) err('"version" must look like 1.0.0');
    if (m.genre !== undefined && !str(m.genre, 2, 40)) err('"genre" must be 2-40 characters');
    if (m.tags !== undefined && (!Array.isArray(m.tags) || m.tags.length > 6 || !m.tags.every((t) => str(t, 1, 20)))) err('"tags" must be up to 6 short strings');
    if (m.controls !== undefined && (!Array.isArray(m.controls) || !m.controls.every((c) => CONTROLS.includes(c)))) err(`"controls" may only contain: ${CONTROLS.join(', ')}`);
    if (m.accent !== undefined && !HEX_RE.test(m.accent)) err('"accent" must be a hex colour like #22d3ee');
    if (m.jpTitle !== undefined && !str(m.jpTitle, 1, 8)) err('"jpTitle" must be 1-8 characters');
    if (m.controls === undefined) warn('no "controls" listed; add e.g. ["keyboard","mouse","touch"]');
    else if (!m.controls.includes('touch')) warn('game does not list touch support (phones are a big part of our players)');
    const known = new Set(['slug', 'name', 'description', 'authors', 'license', 'version', 'genre', 'tags', 'controls', 'accent', 'jpTitle']);
    for (const k of Object.keys(m)) if (!known.has(k)) warn(`unknown game.json field "${k}" (ignored)`);
  }

  if (fs.existsSync(dir)) {
    let total = 0;
    for (const file of walk(dir)) {
      const rel = path.relative(dir, file);
      const size = fs.statSync(file).size;
      total += size;
      if (size > MAX_FILE_BYTES) err(`${rel} is ${(size / 1048576).toFixed(1)} MB; the per-file limit is 5 MB`);
      if (/\.html?$/i.test(file)) checkHtml(file, rel, err, warn);
    }
    if (total > MAX_GAME_BYTES) err(`game folder is ${(total / 1048576).toFixed(1)} MB; the limit is 15 MB`);
  }
  return { manifest: m, errors, warnings };
}

function checkHtml(file, rel, err, warn) {
  const html = fs.readFileSync(file, 'utf8');
  const urlRe = /<(?:script|link|img|iframe|source|audio|video)\b[^>]*?\b(?:src|href)\s*=\s*["'](https?:)?\/\/([^/"']+)/gi;
  for (const [, , host] of html.matchAll(urlRe)) {
    if (!ALLOWED_HOSTS.includes(host.toLowerCase())) {
      // <a href> links are fine; only embedded resources are restricted, which the regex above targets.
      err(`${rel} loads a resource from "${host}". Bundle it in the game folder or use an allowed CDN (${ALLOWED_HOSTS.join(', ')})`);
    }
  }
  if (/<iframe\b/i.test(html)) warn(`${rel} uses an <iframe>; maintainers will review what it embeds`);
  if (rel === 'index.html') {
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) warn('index.html has no viewport meta tag (needed for phones)');
    if (!/<title>[^<]+<\/title>/i.test(html)) warn('index.html has no <title>');
  }
}
