// Sync the checked-in h3-prompt-writing skill into a TypeScript string module.
//
// The workshop runtime must carry the complete skill text in the packaged app;
// reading user-specific ~/.codex paths would make dev and production diverge.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ⚠️ 必须用 fileURLToPath：仓库路径含中文（AI漫剧），
// new URL(...).pathname 会给出百分号编码的 'AI%E6%BC%AB%E5%89%A7'，读文件直接 ENOENT。
const root = fileURLToPath(new URL('..', import.meta.url));
const skillRoot = join(root, 'skills', 'h3-prompt-writing');
const read = (relativePath) => readFileSync(join(skillRoot, relativePath), 'utf8');

const payload = {
  SKILL: read('SKILL.md'),
  BASE_EN: read('references/base-en.txt'),
  REF_EN: read('references/ref-en.txt'),
  OUTPUT_FORMAT: read('references/output-format.json'),
};

const banner = `/**
 * Generated from skills/h3-prompt-writing. Do not edit by hand.
 * Run: node scripts/sync-h3-prompt-skill.mjs
 */

`;
const source = banner + Object.entries(payload)
  .map(([key, value]) => `export const ${key} = ${JSON.stringify(value)};`)
  .join('\n\n') + '\n';

const target = join(root, 'src', 'lib', 'workshop', 'h3PromptWritingSkillContent.ts');
writeFileSync(target, source);
console.log(`[h3-skill] synced ${source.length} bytes to ${target}`);
