import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptPanelCandidate, panelCandidateFingerprint } from './panelLifecycle.ts';
import type { StoryboardFrame } from './types.ts';

const frame: StoryboardFrame = {
  id: 'frame-1',
  prompt: 'single panel',
  candidates: [{ path: '/tmp/panel.png', source: 'generate', engineId: 'gpt-image-2', prompt: 'single panel', createdAt: 1 }],
};

test('panel candidate acceptance produces the shared production binding', () => {
  const accepted = acceptPanelCandidate({
    frame,
    path: '/tmp/panel.png',
    expectedFingerprint: panelCandidateFingerprint(frame.candidates![0], frame.id),
    now: 2,
  });
  assert.equal(accepted.review.kind, 'panel');
  assert.equal(accepted.binding.path, '/tmp/panel.png');
});
