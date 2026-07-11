import {execFileSync} from 'node:child_process';
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, extname, resolve} from 'node:path';

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

for (const [shotIndex, shot] of manifest.shots.entries()) {
  const panelName = `panel-${shotIndex}${extname(shot.panelPath) || '.png'}`;
  copyFileSync(shot.panelPath, resolve(stageDir, panelName));
  shot.panelPath = `public/jobs/${jobName}/${panelName}`;
  for (const [lineIndex, line] of shot.dialogue.entries()) {
    if (!line.audioPath) continue;
    const audioName = `audio-${shotIndex}-${lineIndex}${extname(line.audioPath) || '.wav'}`;
    copyFileSync(line.audioPath, resolve(stageDir, audioName));
    line.audioPath = `public/jobs/${jobName}/${audioName}`;
  }
}

const stagedProps = resolve(stageDir, 'props.json');
writeFileSync(stagedProps, JSON.stringify({manifest}, null, 2));
mkdirSync(resolve(outputPath, '..'), {recursive: true});
execFileSync(
  'npx',
  ['remotion', 'render', 'src/index.tsx', 'ComicEpisode', outputPath,
    '--props', stagedProps, '--codec', 'h264', '--crf', '20'],
  {cwd: root, stdio: 'inherit'},
);
