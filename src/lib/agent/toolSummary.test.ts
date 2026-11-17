import test from 'node:test';
import assert from 'node:assert/strict';
import { formatToolSummary, formatToolBatchLabel, formatToolBatchStart, formatToolBatchEnd } from './toolSummary.ts';
test('reads, paging, writes and mixed batches are distinguished',()=>{
 assert.equal(formatToolSummary('workshop_get_state',{section:'prompts',shot_no:'01-01'}),'读取分镜提示词 · 镜头 01-01');
 assert.match(formatToolSummary('workshop_get_state',{output_id:'x',offset:8000}),/续读.*8000/);
 assert.equal(formatToolBatchLabel([{name:'workshop_set_asset_prompt',params:{}}]),'保存资产提示词');
 assert.equal(formatToolBatchLabel([{name:'workshop_get_state',params:{}},{name:'workshop_get_shot_refs',params:{}}]),'读取工坊资料');
 assert.equal(formatToolBatchLabel([{name:'workshop_get_state',params:{}},{name:'workshop_set_prompts',params:{}}]),'读取资料并保存工坊内容');
 assert.doesNotMatch(formatToolBatchStart([{name:'workshop_get_state',params:{}}]),/更新|写入|完成/);
 assert.doesNotMatch(formatToolBatchEnd([{name:'workshop_get_state',success:true}]),/阶段已经完成/);
});
