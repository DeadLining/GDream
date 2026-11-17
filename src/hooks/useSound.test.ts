import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('automatic reply sound is neither loaded nor played, even with legacy soundEnabled settings', () => {
  const hook = read('./useSound.ts');
  const drawer = read('../components/chat/AgentDrawer.tsx');
  assert.doesNotMatch(hook, /notification\.mp3|playNotification|audioRef|useEffect/);
  assert.doesNotMatch(drawer, /useSound|playNotification|wasStreamingRef/);
  assert.match(hook, /new Audio\(src\)/);
  assert.match(hook, /return \{ playCustom \}/);
});

test('obsolete message-sound controls are removed, while system notifications and media previews remain', () => {
  const settings = read('../components/Settings.tsx');
  assert.doesNotMatch(settings, /title="消息提示音"|title="提示音音量"/);
  assert.match(settings, /title="系统通知"/);
  assert.match(read('../components/workshop/steps/StepAssets.tsx'), /<audio src=\{convertFileSrc\(voicePath\)\} controls/);
});
