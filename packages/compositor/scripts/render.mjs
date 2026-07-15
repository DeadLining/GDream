import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, extname, resolve} from 'node:path';

import {buildRemotionRenderArgs, resolveBrowserExecutable} from './remotion-command.mjs';
import {stageManifestMedia} from './stage-media.mjs';

const [manifestArg, outputArg] = process.argv.slice(2);
if (!manifestArg || !outputArg) {
  throw new Error('Usage: node scripts/render.mjs <manifest.json> <output.mp4>');
}

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(manifestArg);
const outputPath = resolve(outputArg);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const jobName = basename(manifestPath, extname(manifestPath)).replace(/[^a-zA-Z0-9_-]/g, '-');
const stageDir = resolve(root, 'public/jobs', jobName);
mkdirSync(stageDir, {recursive: true});
stageManifestMedia(manifest, stageDir, `public/jobs/${jobName}`);

const stagedProps = resolve(stageDir, 'props.json');
writeFileSync(stagedProps, JSON.stringify({manifest}, null, 2));
mkdirSync(resolve(outputPath, '..'), {recursive: true});
execFileSync(
  'npx',
  buildRemotionRenderArgs(outputPath, stagedProps, resolveBrowserExecutable()),
  {cwd: root, stdio: 'inherit'},
);
