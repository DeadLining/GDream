import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeChatMessages } from './chatMessageDedupe.ts';

test('deduplicates repeated system notices while preserving real user and assistant messages', () => {
  const messages = [
    {id:'a', role:'system', content:'已有后台生成任务（ct-1），本次在此暂停。', timestamp:1},
    {id:'b', role:'system', content:'已有后台生成任务（ct-1），本次在此暂停。', timestamp:2},
    {id:'c', role:'system', content:'生成任务 ct-1 失败或提交结果未知。', timestamp:3},
    {id:'d', role:'system', content:'生成任务 ct-1 失败或提交结果未知。', timestamp:4},
    {id:'u1', role:'user', content:'相同内容', timestamp:5},
    {id:'u2', role:'user', content:'相同内容', timestamp:6},
    {id:'c', role:'assistant', content:'重复 id 不应重复插入', timestamp:7},
  ] as any;
  assert.deepEqual(dedupeChatMessages(messages).map((m) => m.id), ['a','c','u1','u2']);
});
