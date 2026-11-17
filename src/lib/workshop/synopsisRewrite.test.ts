import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSynopsisRewritePrompt } from './synopsisRewrite.ts';
import { classifyWorkshopEditScope } from './narrativeGuard.ts';
test('梗概重写取得明确故事编辑范围且限制为局部合并',()=>{
 const p=buildSynopsisRewritePrompt();
 assert.equal(classifyWorkshopEditScope(p),'story');
 for(const term of ['仅更新当前项目顶层 synopsis','mode:"merge"','其他字段省略','不生成任何媒体','原有下游内容仍是旧版','共享资产关系']) assert.ok(p.includes(term),term);
 assert.doesNotMatch(p,/\uFFFD/);
});
