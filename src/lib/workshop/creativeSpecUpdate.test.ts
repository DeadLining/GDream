import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyWorkshopData, type WorkshopCreativeSpec } from './types.ts';
import { applyCreativeSpecUpdate } from './creativeSpecUpdate.ts';

function fixture() {
  const data = emptyWorkshopData('project');
  data.creativeSpec = {
    workKind: 'product-ad', format: 'short-film', episodeCount: 1,
    episodeDurationSec: 60, detailLevel: 'standard', expansionPolicy: 'balanced',
    allowNewCharacters: false, allowSubplots: false, allowNewConflicts: false,
    adSpec: { productName: 'Workstation', productCategory: 'physical', audience: ['consumer'],
      objective: 'explainer', durationSec: 60, productImages: ['/product.png'] },
  };
  for (const step of Object.values(data.steps)) step.status = 'done';
  data.steps.generate.status = 'stale';
  data.shots = [{ shotNo: '01-01', description: 'Product demonstration', characterIds: [], productReferenceImages: ['/product.png'] }];
  return data;
}

const materials = { fingerprint: 'f', preparedAt: 100, mode: 'online' as const,
  sources: [], images: [], productImages: ['/product.png'], warnings: [],
  referencePlan: { snapshot: 's', createdAt: 200, plans: [] } };

test('saving research and per-shot reference plans preserves breakdown and generation states', () => {
  const data = fixture();
  const spec = data.creativeSpec!;
  const next = applyCreativeSpecUpdate(data, { ...spec, adSpec: { ...spec.adSpec!, materials } }, 300);
  assert.deepEqual(next.steps, data.steps);
  assert.equal(next.creativeSpec?.adSpec?.materials, materials);
  assert.deepEqual(next.shots, data.shots);
  // Rollback of failed metadata persistence must not invalidate breakdown either.
  assert.deepEqual(applyCreativeSpecUpdate(next, spec, 400).steps, data.steps);
});

test('changing product images invalidates media downstream, not saved breakdown or assets', () => {
  const data = fixture();
  const next = applyCreativeSpecUpdate(data, { ...data.creativeSpec!,
    adSpec: { ...data.creativeSpec!.adSpec!, productImages: ['/new.png'] } }, 300);
  assert.equal(next.steps.breakdown.status, 'done');
  assert.equal(next.steps.assets.status, 'done');
  assert.equal(next.steps.prompts.status, 'stale');
  assert.deepEqual(next.steps.generate, data.steps.generate);
  assert.deepEqual(next.shots[0].productReferenceImages, ['/new.png']);
  assert.deepEqual(data.shots[0].productReferenceImages, ['/product.png']);
});

test('actual creative changes still invalidate completed breakdown', () => {
  for (const patch of [
    { episodeDurationSec: 90 },
    { adSpec: { ...fixture().creativeSpec!.adSpec!, audience: ['partner'] } },
    { adSpec: { ...fixture().creativeSpec!.adSpec!, keyMessage: 'New claim' } },
    { workKind: 'drama' },
  ]) {
    const data = fixture();
    const next = applyCreativeSpecUpdate(data, { ...data.creativeSpec!, ...patch } as WorkshopCreativeSpec, 300);
    assert.equal(next.steps.breakdown.status, 'stale');
    assert.equal(next.steps.breakdown.updatedAt, 300);
    assert.equal(data.steps.breakdown.status, 'done');
    assert.deepEqual(next.steps.generate, data.steps.generate);
  }
});

test('no-op, property reordering, and research mode changes do not invalidate creation', () => {
  const data = fixture();
  const reordered = Object.fromEntries(Object.entries(data.creativeSpec!).reverse()) as WorkshopCreativeSpec;
  assert.deepEqual(applyCreativeSpecUpdate(data, reordered, 300).steps, data.steps);
  assert.deepEqual(applyCreativeSpecUpdate(data, { ...reordered,
    adSpec: { ...reordered.adSpec!, researchMode: 'provided-only' } }, 300).steps, data.steps);
});

test('metadata cannot clear an existing stale breakdown or alter pending/in-progress stages', () => {
  const data = fixture();
  data.steps.breakdown.status = 'stale';
  data.steps.assets.status = 'in-progress';
  data.steps.handoff.status = 'pending';
  const next = applyCreativeSpecUpdate(data, { ...data.creativeSpec!,
    adSpec: { ...data.creativeSpec!.adSpec!, materials } }, 300);
  assert.deepEqual(next.steps, data.steps);
  const changed = applyCreativeSpecUpdate(next, { ...next.creativeSpec!, episodeCount: 2 }, 400);
  assert.deepEqual(changed.steps.assets, data.steps.assets);
  assert.deepEqual(changed.steps.handoff, data.steps.handoff);
});
