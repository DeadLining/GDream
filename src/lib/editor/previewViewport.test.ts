import test from 'node:test';
import assert from 'node:assert/strict';
import { fitPreviewViewport } from './previewViewport.ts';

test('height constrained small player keeps the entire 16:9 composition visible', () => {
  const size = fitPreviewViewport(1166, 520, 16 / 9);
  assert.equal(size.height, 520);
  assert.ok(Math.abs(size.width - 520 * 16 / 9) < 1e-10);
});
test('width constrained and fullscreen containers share the same coordinate ratio', () => {
  for (const [w, h] of [[640, 600], [1920, 1000], [500, 220]]) {
    const size = fitPreviewViewport(w, h, 16 / 9);
    assert.ok(size.width <= w && size.height <= h);
    assert.ok(Math.abs(size.width / size.height - 16 / 9) < 1e-10);
  }
});
test('portrait, square and ultrawide fit both constraints', () => {
  for (const ratio of [9 / 16, 1, 4 / 3, 3 / 4, 21 / 9]) {
    const size = fitPreviewViewport(700, 300, ratio);
    assert.ok(size.width <= 700 && size.height <= 300);
    assert.ok(Math.abs(size.width / size.height - ratio) < 1e-10);
  }
});
test('unmeasured and invalid containers never produce overflowing geometry', () => {
  for (const args of [[0, 300, 1], [300, 0, 1], [-1, 200, 1], [NaN, 200, 1], [300, 200, 0]]) {
    assert.deepEqual(fitPreviewViewport(...args as [number, number, number]), { width: 0, height: 0 });
  }
});
