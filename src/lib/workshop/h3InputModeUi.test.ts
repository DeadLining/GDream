import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
test('H3 frame controls do not expose a whitebox mode', () => {
  const source = read('../../components/workshop/steps/StepGenerate.tsx');
  assert.doesNotMatch(source, /handleFirstFrameModeChange|whitebox|白模/);
});

test('new H3 selections default to references, persisted explicit choices survive migration', () => {
  const settings = read('../../stores/settingsStore.ts');
  assert.match(settings, /customVideoGenericH3Task: 'ref2va',/);
  assert.match(settings, /result.customVideoGenericH3Task \?\? 'ref2va'/);
  assert.match(read('../../stores/workshopStore.ts'), /data.h3InputMode = 'ref2va'/);
});
test('legacy whitebox preference fields are no longer part of generation state', () => {
  assert.doesNotMatch(read('../../stores/workshopStore.ts'), /firstFrameMode|directorPrevisVideoPaths|stageBImagePath/);
  assert.doesNotMatch(read('./shotInputPresentation.ts'), /firstFrameMode|whitebox|白模/);
});
