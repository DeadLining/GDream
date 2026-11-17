import assert from 'node:assert/strict';
import test from 'node:test';
import { PERSISTED_PROMPT_MAX, persistedCanvasTask } from './taskPersistence.ts';

function longPrompt(): string {
  return '镜头提示词'.repeat(1200);
}

test('generic canvas tasks persist a marked prompt summary', () => {
  const task = persistedCanvasTask({
    prompt: longPrompt(),
    referenceUrls: ['/asset/reference.png'],
    inFlight: true,
  });

  assert.equal(task.prompt.length, PERSISTED_PROMPT_MAX);
  assert.equal(task.promptTruncated, true);
  assert.deepEqual(task.referenceUrls, ['/asset/reference.png']);
  assert.equal(task.inFlight, undefined);
});

test('workshop shot tasks retain the complete submitted prompt', () => {
  const prompt = longPrompt();
  const task = persistedCanvasTask({
    prompt,
    promptTruncated: true,
    workshopShotNo: 'shot-01',
  });

  assert.equal(task.prompt, prompt);
  assert.equal(task.promptTruncated, undefined);
});

test('storyboard frame tasks retain the complete submitted prompt', () => {
  const prompt = longPrompt();
  const task = persistedCanvasTask({
    prompt,
    workshopStoryboardFrameId: 'frame-01',
  });

  assert.equal(task.prompt, prompt);
  assert.equal(task.promptTruncated, undefined);
});

test('short generic prompts clear a stale truncation marker', () => {
  const task = persistedCanvasTask({
    prompt: 'short prompt',
    promptTruncated: true,
  });

  assert.equal(task.prompt, 'short prompt');
  assert.equal(task.promptTruncated, undefined);
});
