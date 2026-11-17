import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEpisodeContinuity } from './episodeContinuity.ts';
import type { WsShot } from './types.ts';

const base = (shotNo: string): WsShot => ({ shotNo, description: '', characterIds: [], durationSec: 4 });

test('accepts matching timeline duration and explicit prop handoff', () => {
  const a = { ...base('01-01'), sceneId: 'room', actionTimeline: { durationSec: 4, summary: '', segments: [] }, continuitySnapshot: { sceneId: 'room', props: [{ id: 'cup', holder: 'a', state: 'held' }] } };
  const b = { ...base('01-02'), sceneId: 'room', continuityMode: 'inherit' as const, actionTimeline: { durationSec: 4, summary: '', segments: [{ startSec: 0, endSec: 1, track: 'prop' as const, label: 'a 将杯子交给 b' }] }, continuitySnapshot: { sceneId: 'room', cameraSignature: 'same', props: [{ id: 'cup', holder: 'b', state: 'held' }] } };
  assert.deepEqual(validateEpisodeContinuity([a, b]), []);
});

test('reports timeline, camera and prop continuity violations', () => {
  const a = { ...base('01-01'), sceneId: 'room', continuitySnapshot: { sceneId: 'room', cameraSignature: 'left', props: [{ id: 'usb', holder: 'a', state: 'held' }] } };
  const b = { ...base('01-02'), sceneId: 'room', continuityMode: 'inherit' as const, actionTimeline: { durationSec: 3, summary: '', segments: [] }, continuitySnapshot: { sceneId: 'room', cameraSignature: 'right', props: [{ id: 'usb', holder: 'b', state: 'held' }] } };
  const issues = validateEpisodeContinuity([a, b]);
  assert.deepEqual(issues.map((issue) => issue.code), ['timeline-duration-mismatch', 'camera-signature-jump', 'prop-holder-jump']);
});
