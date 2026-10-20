// Copies AGENTS.md, the one source of the AI coding rules, to the places assistants that do not read
// AGENTS.md look for them. CLAUDE.md imports AGENTS.md directly, so it is not generated.
// Usage: npm run rules:sync   (or `node scripts/sync-rules.mjs --check` to fail when a copy is stale)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const TARGETS = ['.github/copilot-instructions.md'];
const banner = '<!-- Generated from AGENTS.md by `npm run rules:sync`. Edit AGENTS.md instead. -->\n\n';
const content = banner + readFileSync('AGENTS.md', 'utf8');
const check = process.argv.includes('--check');

let stale = 0;
for (const target of TARGETS) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current === content) continue;
  if (check) {
    console.error(`${target} is out of date; run npm run rules:sync`);
    stale++;
    continue;
  }
  writeFileSync(target, content);
  console.log(`wrote ${target}`);
}
process.exitCode = stale > 0 ? 1 : 0;
