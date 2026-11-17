import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyWorkshopData } from './types.ts';
import { breakdownExecutionProgress, isFullBreakdownExecution } from './breakdownExecution.ts';

test('only execution requests continue, not inspection or failed batch repair', () => {
  assert.ok(isFullBreakdownExecution('请对当前工坊项目执行剧本拆解（第②步）：'));
  assert.ok(isFullBreakdownExecution('继续第二步'));
  assert.equal(isFullBreakdownExecution('请对当前工坊项目执行剧本拆解，只核对状态'), false);
  assert.equal(isFullBreakdownExecution('请修复一批未写入的 Atomic Shot'), false);
});

test('ready episode comes first; missing scripts use an explicit next action', () => {
  const data = emptyWorkshopData('p');
  data.episodes = [
    { no: '1', title: '', sceneList: '' },
    { no: '2', title: '', sceneList: '', scriptStatus: 'draft', script: '正式对白' },
    { no: '3', title: '', sceneList: '', scriptStatus: 'planned' },
  ];
  data.shots = [{ shotNo: '01-01', description: '', characterIds: [] }];
  data.steps.breakdown.status = 'done';
  const first = breakdownExecutionProgress(data);
  assert.equal(first.finished, false);
  assert.match(first.next, /先完成第 2 集/);
  data.steps.breakdown.updatedAt = 123;
  assert.equal(breakdownExecutionProgress(data).key, first.key);
  data.shots.push({ shotNo: '02-01', description: '', characterIds: [] });
  assert.match(breakdownExecutionProgress(data).next, /第 3 集.*workshop_set_episode_script/);
  assert.notEqual(breakdownExecutionProgress(data).key, first.key);
});
