import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsStorage } from './settingsPersistence.ts';

const saved = (state: Record<string, unknown>) => JSON.stringify({ state, version: 44 });
const credential = { id: 'tavily-fixture', apiKey: 'test-only', label: 'Tavily' };
const configured = saved({ credentials: [credential], credentialRefs: { tavily: credential.id }, theme: 'dark' });
const empty = saved({ credentials: [], credentialRefs: {}, theme: 'light' });
function fixture(disk: string | null = configured, cached: string | null = empty) {
  let file = disk;
  let cache = cached;
  const writes: string[] = [];
  const errors: string[] = [];
  const storage = createSettingsStorage({
    cache: { getItem: () => cache, setItem: (_n, v) => { cache = v; }, removeItem: () => { cache = null; } },
    readFile: async () => file,
    writeFile: async (v, expected) => {
      if (file !== expected) throw new Error('conflict');
      file = v; writes.push(v);
    },
    onError: (phase) => { errors.push(phase); },
  });
  return { storage, writes, errors, file: () => file, cache: () => cache, externalWrite: (v: string) => { file = v; } };
}

test('disk credentials override nonempty stale dev/prod cache before hydration', async () => {
  const f = fixture();
  assert.equal(await f.storage.getItem('settings'), configured);
  assert.equal(f.cache(), configured);
  assert.equal(f.writes.length, 0);
});
test('startup writes cannot overwrite disk before recovery completes', async () => {
  const f = fixture();
  await f.storage.setItem('settings', empty);
  assert.equal(f.file(), configured);
  assert.equal(await f.storage.getItem('settings'), configured);
});
test('only a missing disk file permits legacy localStorage recovery', async () => {
  const f = fixture(null, configured);
  assert.equal(await f.storage.getItem('settings'), configured);
  await f.storage.setItem('settings', configured);
  assert.equal(f.file(), configured);
});
test('corrupt disk fails closed and cannot be overwritten by cache', async () => {
  const f = fixture('{corrupt');
  await assert.rejects(f.storage.getItem('settings'));
  await f.storage.setItem('settings', empty);
  assert.equal(f.file(), '{corrupt');
});
test('failed read never falls back to cached secrets or enables writing', async () => {
  let wrote = false;
  const storage = createSettingsStorage({
    cache: { getItem: () => configured, setItem: () => {}, removeItem: () => {} },
    readFile: async () => { throw new Error('fixture read failed'); },
    writeFile: async () => { wrote = true; }, onError: () => {},
  });
  await assert.rejects(storage.getItem('settings'));
  await storage.setItem('settings', empty);
  assert.equal(wrote, false);
});
test('writes are serialized, explicit credential deletion persists on restart', async () => {
  const f = fixture();
  await f.storage.getItem('settings');
  await Promise.all([f.storage.setItem('settings', configured), f.storage.setItem('settings', empty)]);
  assert.equal(f.file(), empty);
  assert.equal(await fixture(f.file(), configured).storage.getItem('settings'), empty);
});
test('another instance change is detected without overwriting and later writes stay blocked', async () => {
  const f = fixture();
  await f.storage.getItem('settings');
  const changed = saved({ credentials: [{ ...credential, apiKey: 'rotated-fixture' }] });
  f.externalWrite(changed);
  await f.storage.setItem('settings', empty);
  await f.storage.setItem('settings', configured);
  assert.equal(f.file(), changed);
  assert.deepEqual(f.errors, ['save', 'not-ready']);
});
test('cache quota failure does not lose disk write or read recovery', async () => {
  let file: string | null = configured;
  const storage = createSettingsStorage({
    cache: { getItem: () => empty, setItem: () => { throw new Error('quota'); }, removeItem: () => {} },
    readFile: async () => file, writeFile: async v => { file = v; }, onError: () => {},
  });
  assert.equal(await storage.getItem('settings'), configured);
  await storage.setItem('settings', empty);
  assert.equal(file, empty);
});
test('invalid envelopes are rejected without leaking their contents', async () => {
  for (const invalid of ['null', '[]', '{}', '{"state":[]}', '{"state":null}', '{"state":{},"version":"secret"}']) {
    const f = fixture(invalid);
    await assert.rejects(f.storage.getItem('settings'), e => !String(e).includes('secret'));
    assert.equal(f.writes.length, 0);
  }
});

test('real Zustand hydration waits for disk, then settings edits persist without losing Tavily', async () => {
  const { createStore } = await import('zustand/vanilla');
  const { persist, createJSONStorage } = await import('zustand/middleware');
  const f = fixture();
  const store = createStore(persist(() => ({ credentials: [], credentialRefs: {}, theme: 'light' }), {
    name: 'settings', storage: createJSONStorage(() => f.storage), version: 44, skipHydration: true,
  }));
  assert.equal(store.persist.hasHydrated(), false);
  await store.persist.rehydrate();
  assert.equal(store.persist.hasHydrated(), true);
  assert.deepEqual(store.getState().credentials, [credential]);
  store.setState({ theme: 'light' });
  await f.storage.flush();
  assert.deepEqual(JSON.parse(f.file()!).state.credentialRefs, { tavily: credential.id });
  assert.equal(JSON.parse(f.file()!).state.theme, 'light');
});

test('real Zustand migration writes against the originally loaded file', async () => {
  const { createStore } = await import('zustand/vanilla');
  const { persist, createJSONStorage } = await import('zustand/middleware');
  const f = fixture(JSON.stringify({ state: { oldKey: 'test-only' }, version: 43 }));
  const store = createStore(persist(() => ({ credentials: [] as typeof credential[] }), {
    name: 'settings', storage: createJSONStorage(() => f.storage), version: 44, skipHydration: true,
    migrate: () => ({ credentials: [credential] }),
  }));
  await store.persist.rehydrate();
  await f.storage.flush();
  assert.equal(store.persist.hasHydrated(), true);
  assert.deepEqual(JSON.parse(f.file()!).state.credentials, [credential]);
  assert.deepEqual(f.errors, []);
});

test('same-version obsolete engine fields are purged on read and write without touching credentials', async () => {
 const dirty=JSON.stringify({version:45,state:{deepseekEngine:'builtin',maxTurns:30,setMaxTurns:'obsolete',credentials:[credential],credentialRefs:{tavily:credential.id}}});
 const f=fixture(dirty);
 const loaded=JSON.parse((await f.storage.getItem('settings'))!);
 assert.equal('deepseekEngine' in loaded.state,false);
 assert.equal('maxTurns' in loaded.state,false);
 assert.equal('setMaxTurns' in loaded.state,false);
 assert.deepEqual(loaded.state.credentials,[credential]);
 assert.equal('deepseekEngine' in JSON.parse(f.file()!).state,false);
 await f.storage.setItem('settings',dirty);
 assert.equal('deepseekEngine' in JSON.parse(f.file()!).state,false);
});
