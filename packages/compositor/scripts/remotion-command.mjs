import {existsSync} from 'node:fs';


export function resolveBrowserExecutable(
  env = process.env,
  platform = process.platform,
  exists = existsSync,
) {
  const candidates = [env.REMOTION_BROWSER_EXECUTABLE];
  if (platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else if (platform === 'linux') {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  }
  return candidates.find(candidate => candidate && exists(candidate)) ?? null;
}


export function buildRemotionRenderArgs(outputPath, stagedProps, browserExecutable) {
  const args = [
    'remotion', 'render', 'src/index.tsx', 'ComicEpisode', outputPath,
    '--props', stagedProps, '--codec', 'h264', '--crf', '20',
  ];
  if (browserExecutable) {
    args.push(
      '--browser-executable',
      browserExecutable,
      '--chrome-mode=chrome-for-testing',
    );
  }
  return args;
}
