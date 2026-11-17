import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateKeysInStore, type KeyValueStore } from './legacyRename.ts';

/** 内存版 Storage，行为对齐 localStorage 的键序与 length 语义。 */
function memStore(init: Record<string, string>): KeyValueStore & { dump(): Record<string, string> } {
  const map = new Map<string, string>(Object.entries(init));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { map.set(k, v); },
    dump: () => Object.fromEntries(map),
  };
}

test('旧键值被复制到新键，且旧键保留', () => {
  const s = memStore({
    'kunpeng-settings': '{"theme":"dark"}',
    'kunpeng.editor.leftWidth': '300',
    'gdream-canvas': '{"nodes":[]}',
  });
  const moved = migrateKeysInStore(s);
  assert.equal(moved, 2);
  const d = s.dump();
  assert.equal(d['gdream-settings'], '{"theme":"dark"}');
  assert.equal(d['gdream.editor.leftWidth'], '300');
  // 源键必须还在，方便回退旧版本
  assert.equal(d['kunpeng-settings'], '{"theme":"dark"}');
  assert.equal(d['kunpeng.editor.leftWidth'], '300');
});

test('已存在的新键不被旧键覆盖', () => {
  const s = memStore({
    'kunpeng-settings': 'OLD',
    'gdream-settings': 'NEW',
  });
  const moved = migrateKeysInStore(s);
  assert.equal(moved, 0);
  assert.equal(s.getItem('gdream-settings'), 'NEW');
  assert.equal(s.getItem('kunpeng-settings'), 'OLD');
});

test('非 kunpeng 前缀的键完全不受影响', () => {
  const s = memStore({
    'kunpeng-canvas': 'a',
    'com.apple.WebInspector.foo': 'b',
    'some-other-key': 'c',
    'kunp': 'd',
  });
  migrateKeysInStore(s);
  const d = s.dump();
  assert.equal(d['gdream-canvas'], 'a');
  assert.equal(d['com.apple.WebInspector.foo'], 'b');
  assert.equal(d['some-other-key'], 'c');
  assert.equal(d['gdream'], undefined, '前缀不完整不应被改写');
  assert.equal(d.kunp, 'd');
});

test('重复运行是幂等的', () => {
  const s = memStore({ 'kunpeng-sessions': 'x' });
  assert.equal(migrateKeysInStore(s), 1);
  assert.equal(migrateKeysInStore(s), 0, '第二次不应再复制');
  assert.equal(s.getItem('gdream-sessions'), 'x');
});

test('setItem 抛错（配额满）不阻断其余键迁移', () => {
  const map = new Map<string, string>([['kunpeng-a', '1'], ['kunpeng-b', '2']]);
  const s: KeyValueStore = {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      if (k === 'gdream-a') throw new Error('quota');
      map.set(k, v);
    },
  };
  const moved = migrateKeysInStore(s);
  assert.equal(moved, 1, '一个失败不应影响另一个');
  assert.equal(map.get('gdream-b'), '2');
  assert.equal(map.has('gdream-a'), false);
});
