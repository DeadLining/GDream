import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

// Keep presentation-only changes from making provenance labels permanent again.
test('edge history labels are revealed only on interaction', () => {
  const source = readFileSync(new URL('../../components/canvas/edges/CustomEdge.tsx', import.meta.url), 'utf8');
  assert.match(source, /isLineage && lineageLabel && isActive &&/);
  assert.doesNotMatch(source, /isActive \|\| data\?\.relation === 'provenance'/);
});

test('image provenance details are shown only for the selected image', () => {
  const source = readFileSync(new URL('../../components/canvas/nodes/ImageNode.tsx', import.meta.url), 'utf8');
  assert.match(source, /selected && typeof \(data as Record<string, unknown>\)\.provenanceLabel/);
});
