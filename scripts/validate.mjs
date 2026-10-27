// Validates every game submission. Exits non-zero on errors. Run: npm run validate
import { listGameDirs, checkGame } from './lib.mjs';

const slugs = listGameDirs();
let failed = false;
for (const slug of slugs) {
  const { errors, warnings } = checkGame(slug);
  for (const w of warnings) console.log(`::warning::${w}`);
  for (const e of errors) { console.log(`::error::${e}`); failed = true; }
  console.log(`${errors.length ? '✗' : '✓'} ${slug}${warnings.length ? ` (${warnings.length} warning${warnings.length > 1 ? 's' : ''})` : ''}`);
}
console.log(`\n${slugs.length} game(s) checked.`);
if (failed) { console.error('Validation failed. See CONTRIBUTING.md for the rules.'); process.exit(1); }
