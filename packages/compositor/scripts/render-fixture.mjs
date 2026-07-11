import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const publicDir = resolve(root, 'public/fixture');
const outDir = resolve(root, 'out');
mkdirSync(publicDir, {recursive: true});
mkdirSync(outDir, {recursive: true});

const demoPanel = resolve(root, '../../apps/web/public/demo-panel.png');
if (existsSync(demoPanel)) {
  copyFileSync(demoPanel, resolve(publicDir, 'panel.png'));
} else {
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'color=c=0x1b525e:s=1080x1920:d=1',
    '-frames:v', '1', resolve(publicDir, 'panel.png'),
  ], {stdio: 'ignore'});
}
execFileSync('ffmpeg', [
  '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '1',
  resolve(publicDir, 'dialogue.wav'),
], {stdio: 'ignore'});

const manifest = {
  episode: {id: 'fixture', title: 'Fixture', width: 1080, height: 1920, fps: 30},
  shots: [{
    id: 'shot-1', durationSeconds: 1, panelPath: 'public/fixture/panel.png',
    reviewStatus: 'approved', motion: 'push_in',
    dialogue: [{
      id: 'line-1', characterName: '林默', text: '别回头。', startSeconds: 0,
      durationSeconds: 1, audioPath: 'public/fixture/dialogue.wav',
    }],
  }],
};
const propsPath = resolve(outDir, 'fixture-props.json');
writeFileSync(propsPath, JSON.stringify({manifest}, null, 2));

const chromePath = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : null;
const browserArgs = chromePath && existsSync(chromePath)
  ? ['--browser-executable', chromePath]
  : [];

execFileSync(
  'npx',
  ['remotion', 'render', 'src/index.tsx', 'ComicEpisode', resolve(outDir, 'fixture.mp4'),
    '--props', propsPath, '--codec', 'h264', '--crf', '20', '--concurrency', '1',
    '--port', '3199', ...browserArgs],
  {cwd: root, stdio: 'inherit'},
);
