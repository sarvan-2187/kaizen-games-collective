// Regenerates the games table, stats and contributors in README.md, plus CONTRIBUTORS.md.
// Run: npm run docs   (CI runs it automatically after every merged pull request)
import { updateFiles } from './readme-lib.mjs';
updateFiles();
console.log('README.md and CONTRIBUTORS.md updated.');
