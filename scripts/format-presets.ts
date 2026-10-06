// Normalizes every preset JSON under presets/ into canonical form (all params
// explicit, defaults filled, stable key order). `--check` fails on any diff.
//   npm run presets:format         npm run presets:check
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { normalizePreset, serializePreset } from '../src/renderer/src/engine/presetIO';

const root = join(process.cwd(), 'presets');
const check = process.argv.includes('--check');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : [];
  });
}

let changed = 0;
for (const file of walk(root)) {
  const before = readFileSync(file, 'utf8');
  const after = serializePreset(normalizePreset(JSON.parse(before)));
  if (before !== after) {
    changed++;
    if (check) console.log(`not canonical: ${relative(process.cwd(), file)}`);
    else writeFileSync(file, after);
  }
}
console.log(check ? `${changed} preset(s) need formatting` : `formatted ${changed} preset(s)`);
process.exit(check && changed ? 1 : 0);
