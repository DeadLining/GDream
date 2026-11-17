import test from 'node:test';
import assert from 'node:assert/strict';
import { flushAndCloseEditor } from './editorClose.ts';

test('关闭未改动内容不触发保存或使生成结果失效', () => {
 let writes=0, closes=0;
 flushAndCloseEditor('原文','原文',()=>writes++,()=>closes++);
 assert.equal(writes,0);assert.equal(closes,1);
});
test('最后一次输入先保存，再关闭', () => {
 const calls:string[]=[];
 flushAndCloseEditor('中文输入','中文',v=>calls.push(v),()=>calls.push('closed'));
 assert.deepEqual(calls,['中文输入','closed']);
});
test('保存抛错仍关闭浮层，不会被 closing 标记永久锁住', () => {
 let closed=false;
 assert.throws(()=>flushAndCloseEditor('new','old',()=>{throw Error('save failed');},()=>{closed=true;}),/save failed/);
 assert.equal(closed,true);
});
