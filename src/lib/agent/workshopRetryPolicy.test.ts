import assert from 'node:assert/strict';
import test from 'node:test';
import { canRetryWorkshopMutation, isDuplicateWorkshopWrite, workshopMutationRepairKey } from './workshopRetryPolicy.ts';

test('allows two bounded repairs for breakdown structure writes', () => {
  assert.equal(canRetryWorkshopMutation('workshop_set_breakdown', 1), true);
  assert.equal(canRetryWorkshopMutation('workshop_set_shots', 2), true);
  assert.equal(canRetryWorkshopMutation('workshop_set_step_status', 2), true);
  assert.equal(canRetryWorkshopMutation('workshop_set_shots', 3), false);
});

test('does not retry unrelated or paid workshop operations', () => {
  assert.equal(canRetryWorkshopMutation('workshop_generate', 1), false);
  assert.equal(canRetryWorkshopMutation('workshop_set_prompts', 1), false);
  assert.equal(canRetryWorkshopMutation('workshop_remove_asset', 1), false);
});

test('tracks shot repair budgets per stable batch instead of globally', () => {
  assert.equal(workshopMutationRepairKey('workshop_set_shots', {
    mode: 'merge',
    shots: [{ shotNo: '01-02' }, { shotNo: '01-01' }],
  }), 'workshop_set_shots:merge:01-01,01-02');
  assert.notEqual(
    workshopMutationRepairKey('workshop_set_shots', { mode: 'merge', shots: [{ shotNo: '01-01' }] }),
    workshopMutationRepairKey('workshop_set_shots', { mode: 'merge', shots: [{ shotNo: '01-02' }] }),
  );
});

test('failed workshop writes do not count as duplicate writes', () => {
  // A rejected workshop_set_shots persisted nothing, so resubmitting the same
  // batch is the documented repair path, never a duplicate write.
  assert.equal(isDuplicateWorkshopWrite(0), false);
  assert.equal(isDuplicateWorkshopWrite(1), true);
  assert.equal(isDuplicateWorkshopWrite(3), true);
});
