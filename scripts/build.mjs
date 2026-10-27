// Builds the deployable site into _site/: copies the site, writes games.json, and adds the
// Kaizen bar (back link + "Report a bug") to every game page. Run: npm run build
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, GAMES_DIR, listGameDirs, checkGame, walk } from './lib.mjs';

const OUT = path.join(ROOT, '_site');
const REPO = process.env.GITHUB_REPOSITORY || 'sarvan-2187/kaizen-games-collective';

const games = [];
let failed = false;
for (const slug of listGameDirs()) {
  const { manifest, errors } = checkGame(slug);
  if (errors.length) { errors.forEach((e) => console.error(`✗ ${e}`)); failed = true; continue; }
  games.push(manifest);
}
if (failed) { console.error('Fix validation errors before building.'); process.exit(1); }

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(OUT, 'index.html'));
fs.cpSync(GAMES_DIR, path.join(OUT, 'games'), { recursive: true });
if (fs.existsSync(path.join(ROOT, 'assets'))) fs.cpSync(path.join(ROOT, 'assets'), path.join(OUT, 'assets'), { recursive: true });
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const registry = {
  repo: REPO,
  generatedAt: new Date().toISOString(),
  games: games.sort((a, b) => a.name.localeCompare(b.name)).map((g) => ({
    slug: g.slug, name: g.name, description: g.description, authors: g.authors, license: g.license,
    version: g.version || null, genre: g.genre || null, tags: g.tags || [], controls: g.controls || [],
    accent: g.accent || null, jpTitle: g.jpTitle || null,
  })),
};
fs.writeFileSync(path.join(OUT, 'games.json'), JSON.stringify(registry, null, 2));

const bar = (slug) => {
  const report = `https://github.com/${REPO}/issues/new?template=bug_report.yml&game=${encodeURIComponent(slug)}&title=${encodeURIComponent(`[${slug}] `)}`;
  return `
<!-- kaizen-games-collective:bar -->
<style>#kz-bar{position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:2147483000;display:flex;gap:6px;font:600 11px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;opacity:.55}#kz-bar:hover,#kz-bar:focus-within{opacity:1}#kz-bar a{padding:5px 11px;border-radius:999px;background:rgba(0,0,0,.65);color:#fff;text-decoration:none}@media (pointer:coarse){#kz-bar{left:8px;bottom:8px;transform:none;opacity:.85}}</style>
<div id="kz-bar"><a href="../../index.html">&larr; Kaizen Games</a><a href="${report}" target="_blank" rel="noopener">Report a bug</a></div>
`;
};

for (const g of games) {
  const file = path.join(OUT, 'games', g.slug, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  const i = html.toLowerCase().lastIndexOf('</body>');
  html = i === -1 ? html + bar(g.slug) : html.slice(0, i) + bar(g.slug) + html.slice(i);
  // Give games without their own icon the collective's favicon.
  if (!/<link[^>]+rel=["'](?:shortcut )?icon["']/i.test(html)) {
    const icon = '<link rel="icon" href="../../assets/favicon.svg" type="image/svg+xml">\n<link rel="icon" href="../../assets/favicon-32.png" type="image/png" sizes="32x32">\n';
    const h = html.search(/<\/head>/i);
    html = h === -1 ? icon + html : html.slice(0, h) + icon + html.slice(h);
  }
  fs.writeFileSync(file, html);
}
console.log(`Built ${games.length} game(s) into ${path.relative(ROOT, OUT)}/ for ${REPO}`);
