import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdBoundaryPrompt } from './adBoundaryPrompt.ts';
test('advertisement frame goal leads the request without dramatic boilerplate',()=>{
 const p=buildAdBoundaryPrompt({description:'左侧文档，右侧圆片，无人物',role:'start',aspectRatio:'16:9',references:[{label:'场景'},{label:'文档'}]});
 assert.ok(p.indexOf('左侧文档')<p.indexOf('参考图'));
 assert.match(p,/图片1：场景/);assert.match(p,/图片2：文档/);
 assert.doesNotMatch(p,/抛掷|召回|超自然|亲属/);
 assert.ok(p.length<400);
});
test('end frame preserves current first frame and exact authored action',()=>{
 const p=buildAdBoundaryPrompt({description:'纸张掀起一角',role:'end',aspectRatio:'16:9',references:[{label:'当前首帧',kind:'start-frame'}]});
 assert.match(p,/纸张掀起一角/);assert.match(p,/图片1.*最高优先级/);assert.match(p,/只输出一张/);
});
