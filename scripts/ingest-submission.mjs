// Runs in CI for "Submit a game" issues. Reads the issue from env vars, fetches the game, writes
// games/<slug>/ and a result file. It only copies and validates files; it never runs submitted code.
//   env: ISSUE_BODY, ISSUE_AUTHOR, RESULT_FILE, GH_TOKEN (optional, for private-repo attachments)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GAMES_DIR, checkGame } from './lib.mjs';
import { parseIssueBody, buildManifest, findSource, extractZipSafe, findGameRoot, copyGame, assertNoLinks, fileCount, LIMITS } from './ingest-lib.mjs';

const RESULT_FILE = process.env.RESULT_FILE || 'submission-result.json';
const TOKEN = process.env.GH_TOKEN || '';
const HOST_OK = /(^|\.)(github|githubusercontent)\.com$|\.amazonaws\.com$/;

function finish(result) {
  fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
  console.log(result.ok ? `OK: ${result.slug}` : `Rejected:\n- ${result.errors.join('\n- ')}`);
}

async function download(url, dest) {
  let cur = url;
  for (let hop = 0; hop < 6; hop++) {
    const u = new URL(cur);
    if (u.protocol !== 'https:' || !HOST_OK.test(u.hostname)) throw new Error('The zip link points somewhere we do not allow.');
    const headers = u.hostname === 'github.com' && TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
    const res = await fetch(cur, { redirect: 'manual', headers });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { cur = new URL(res.headers.get('location'), cur).href; continue; }
    if (!res.ok) {
      const hint = [401, 403, 404].includes(res.status)
        ? ' If the zip was uploaded but this keeps failing, the repository may still be private (GitHub does not let bots download attachments from private repos). Try again once the repository is public, or link a public GitHub repository instead.'
        : '';
      throw new Error(`Could not download the zip (HTTP ${res.status}). Re-upload it and edit the issue.${hint}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > LIMITS.zipBytes) throw new Error('The zip is larger than 25 MB.');
    fs.writeFileSync(dest, buf);
    return;
  }
  throw new Error('Too many redirects while downloading the zip.');
}

async function main() {
  const login = process.env.ISSUE_AUTHOR || '';
  const fields = parseIssueBody(process.env.ISSUE_BODY);
  const { manifest, errors } = buildManifest(fields, login);
  const fail = (...e) => finish({ ok: false, slug: manifest.slug || null, errors: [...errors, ...e], warnings: [] });
  if (errors.length) return fail();

  const source = findSource(fields);
  if (source.error) return fail(source.error);

  const dest = path.join(GAMES_DIR, manifest.slug);
  const existing = path.join(dest, 'game.json');
  if (fs.existsSync(dest)) {
    let owners = [];
    try { owners = JSON.parse(fs.readFileSync(existing, 'utf8')).authors.map((a) => a.github.toLowerCase()); } catch { /* treated as not owned */ }
    if (!owners.includes(login.toLowerCase())) return fail(`A game called "${manifest.slug}" already exists. Pick a different URL name, or ask its author to update it.`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaizen-sub-'));
  try {
    const unpack = path.join(tmp, 'unpacked');
    if (source.type === 'zip') {
      const zipPath = path.join(tmp, 'game.zip');
      await download(source.url, zipPath);
      extractZipSafe(zipPath, unpack);
    } else {
      const args = ['clone', '--depth', '1', '--quiet'];
      const branchGuess = source.treePath.split('/')[0];
      if (branchGuess) args.push('--branch', branchGuess);
      args.push(`https://github.com/${source.owner}/${source.repo}.git`, unpack);
      execFileSync('git', args, { stdio: 'pipe', timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
      assertNoLinks(unpack);
    }
    let base = unpack;
    if (source.type === 'repo' && source.treePath.includes('/')) {
      base = path.resolve(unpack, source.treePath.split('/').slice(1).join('/'));
      if (!base.startsWith(unpack + path.sep) || !fs.existsSync(base)) return fail('That folder was not found in the repository.');
    }
    const root = findGameRoot(base);
    if (!root) return fail('Could not find index.html at the top level of your zip/repository (or inside a single folder).');
    if (fileCount(root) > LIMITS.files) return fail(`Too many files (limit ${LIMITS.files}).`);

    copyGame(root, dest);
    fs.writeFileSync(path.join(dest, 'game.json'), JSON.stringify(manifest, null, 2) + '\n');
    const check = checkGame(manifest.slug);
    if (check.errors.length) {
      fs.rmSync(dest, { recursive: true, force: true });
      return finish({ ok: false, slug: manifest.slug, errors: check.errors.map((e) => e.replace(/^games\/[^:]+: /, '')), warnings: check.warnings });
    }
    finish({ ok: true, slug: manifest.slug, name: manifest.name, errors: [], warnings: check.warnings.map((e) => e.replace(/^games\/[^:]+: /, '')), manifest });
  } catch (e) {
    fs.rmSync(dest, { recursive: true, force: true });
    const msg = e && e.message ? e.message : String(e);
    return fail(/Command failed/.test(msg) ? 'Could not read the zip or repository. Is it valid and public?' : msg);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => { finish({ ok: false, slug: null, errors: [`Unexpected error: ${e.message}`], warnings: [] }); });
