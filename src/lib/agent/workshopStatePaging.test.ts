import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWorkshopStateRead, isInitialWorkshopStateRead, WorkshopStatePager, WORKSHOP_STATE_PAGE_CHARS, protectWorkshopStatePages } from './workshopStatePaging.ts';
import { RepeatReadMemo } from './repeatReadGuard.ts';
import { readFileSync } from 'node:fs';

function unpack(output: string) {
  const [header, _instruction, ...body] = output.split('\n');
  return { meta: JSON.parse(header), body: body.join('\n') };
}

test('small output stays compatible with the original state response', () => {
  assert.equal(new WorkshopStatePager().start('short state', {}, 'p'), 'short state');
});

test('long script, review and beats can be recovered exactly without oversized tool results', () => {
  const pager = new WorkshopStatePager();
  const source = { revision: 'r1' };
  const text = JSON.stringify({ currentScriptRevision: { content: '正文与对白。\n'.repeat(5000) }, scriptReview: { revision: 'r1' }, narrativeBeats: [{ id: 'beat-1' }] });
  let output = pager.start(text, source, 'p');
  let recovered = '';
  const memo = new RepeatReadMemo();
  for (let i = 0; i < 100; i++) {
    assert.ok(output.length < 12_000, 'below smallest protected output limit');
    const { meta, body } = unpack(output);
    recovered += body;
    if (meta.complete) {
      assert.equal(meta.next_call, null);
      assert.equal(meta.next_offset, null);
      break;
    }
    assert.equal(meta.next_offset, recovered.length);
    assert.equal(memo.check('workshop_get_state', meta.next_call), null);
    memo.record('workshop_get_state', meta.next_call, true);
    output = pager.read(meta.output_id, meta.next_offset, source, 'p');
  }
  assert.equal(recovered, text);
  assert.equal(JSON.parse(recovered).narrativeBeats[0].id, 'beat-1');
});

test('Unicode surrogate pairs remain intact at a page boundary', () => {
  const pager = new WorkshopStatePager();
  const source = {};
  const text = '中'.repeat(WORKSHOP_STATE_PAGE_CHARS - 1) + '😀尾声';
  const first = unpack(pager.start(text, source, 'p'));
  assert.equal(first.body.length, WORKSHOP_STATE_PAGE_CHARS - 1);
  const last = unpack(pager.read(first.meta.output_id, first.meta.next_offset, source, 'p'));
  assert.equal(first.body + last.body, text);
});

test('missing, cross-project and changed-state snapshots fail rather than mix facts', () => {
  const pager = new WorkshopStatePager();
  const source = {};
  const text = 'x'.repeat(9000);
  assert.throws(() => pager.read('missing', 0, source, 'p'), /过期/);
  const a = unpack(pager.start(text, source, 'p')).meta;
  assert.throws(() => pager.read(a.output_id, 8000, source, 'other'), /数据已变化/);
  const b = unpack(pager.start(text, source, 'p')).meta;
  assert.throws(() => pager.read(b.output_id, 8000, { revision: 'changed' }, 'p'), /数据已变化/);

  // The live store can hand the tool a fresh object with the same saved state.
  // That must not invalidate a cursor mid-read.
  const c = unpack(pager.start(text, source, 'p')).meta;
  assert.doesNotThrow(() => pager.read(c.output_id, 8000, { ...source }, 'p'));
});

test('invalid offsets rejected; repeated page reads are deterministic', () => {
  const pager = new WorkshopStatePager();
  const source = {};
  const first = pager.start('x'.repeat(9000), source, 'p');
  const { meta } = unpack(first);
  for (const offset of [-1, 0.5, NaN, Infinity, '8000', undefined, 9000]) {
    assert.throws(() => pager.read(meta.output_id, offset, source, 'p'), /offset/);
  }
  assert.equal(pager.read(meta.output_id, 0, source, 'p'), first);
});

test('snapshot cache is bounded', () => {
  const pager = new WorkshopStatePager();
  const source = {};
  const { meta } = unpack(pager.start('x'.repeat(9000), source, 'p'));
  for (let i = 0; i < 8; i++) pager.start('x'.repeat(9000) + i, source, 'p');
  assert.throws(() => pager.read(meta.output_id, 8000, source, 'p'), /过期/);
});

test('state tool exposes paging before live response and breakdown permits continuation', () => {
  const tool = readFileSync(new URL('./tools/workshopTools.ts', import.meta.url), 'utf8');
  assert.match(tool, /output_id: \{ type: 'string'/);
  assert.match(tool, /workshopStatePager\.read\(params.output_id, params.offset, s.data/);
  assert.match(tool, /workshopStatePager\.start\(`/);
  const prompt = readFileSync(new URL('../workshop/workshopPrompts.ts', import.meta.url), 'utf8');
  assert.match(prompt, /分页续读不计为重复读取/);
});


test('all pages of a recent snapshot stay together during microcompaction', () => {
  const page = (id: string, offset: number) => ({ role: 'tool', content: JSON.stringify({ output_id: id, offset, complete: false }) + '\nbody' });
  const messages = [page('ws-state-old', 0), ...Array.from({ length: 6 }, (_, i) => page('ws-state-current', i * 8000))];
  const protectedIndices = new Set([5, 6]);
  protectWorkshopStatePages(messages, protectedIndices);
  assert.deepEqual([...protectedIndices].sort(), [1, 2, 3, 4, 5, 6]);
});


test('reopening an unchanged section reuses its cursor without evicting other sections', () => {
  const pager = new WorkshopStatePager();
  const source = {};
  const breakdown = pager.start('b'.repeat(18000), source, 'p');
  const other = unpack(pager.start('c'.repeat(9000), source, 'p')).meta;
  for (let i = 0; i < 12; i++) assert.equal(pager.start('b'.repeat(18000), source, 'p'), breakdown);
  assert.equal(unpack(pager.read(other.output_id, 8000, source, 'p')).body, 'c'.repeat(1000));
});

test('recently restored snapshots survive LRU eviction', () => {
  const pager = new WorkshopStatePager();
  const source = {};
  const first = unpack(pager.start('a'.repeat(9000), source, 'p')).meta;
  const old = unpack(pager.start('b'.repeat(9000), source, 'p')).meta;
  for (let i = 0; i < 6; i++) pager.start('c'.repeat(9000) + i, source, 'p');
  pager.read(first.output_id, 8000, source, 'p');
  pager.start('d'.repeat(9000), source, 'p');
  assert.equal(unpack(pager.read(first.output_id, 8000, source, 'p')).body, 'a'.repeat(1000));
  assert.throws(() => pager.read(old.output_id, 8000, source, 'p'), /过期/);
});


test('initial filtered shot reads tolerate offset zero without treating it as continuation', () => {
  const request = { detail: 'step', section: 'prompts', shot_no: '02-04', offset: 0 };
  assert.equal(isInitialWorkshopStateRead(request), true);
  assert.equal(request.shot_no, '02-04');
  assert.equal(isInitialWorkshopStateRead({}), true);
  assert.equal(isInitialWorkshopStateRead({ output_id: 'snapshot', offset: 0 }), false);
  for (const offset of [1, -1, 0.5, '0', NaN]) {
    assert.equal(isInitialWorkshopStateRead({ offset }), false);
  }
  assert.equal(isInitialWorkshopStateRead({ output_id: '' , offset: 0 }), true);
  assert.equal(isInitialWorkshopStateRead({ output_id: 'snapshot' }), false);
});

test('state tool uses tolerant first-read routing before strict snapshot reads', () => {
  const tool = readFileSync(new URL('./tools/workshopTools.ts', import.meta.url), 'utf8');
  assert.match(tool, /if \(!isInitialWorkshopStateRead\(params\)\)/);
  assert.match(tool, /首次读取请移除这两个参数/);
});

test('actual DSH empty-default payload is initial and does not mutate caller args', () => {
  const params = {detail:'step',episode:'',offset:0,output_id:'',section:'current',shot_no:'',work_unit_id:''};
  assert.equal(isInitialWorkshopStateRead(params), true);
  for (const output_id of [undefined, null, '', '  ']) {
    for (const offset of [undefined, null, 0]) assert.equal(isInitialWorkshopStateRead({output_id,offset}),true);
    for (const offset of [1,-1,'0',false,NaN]) assert.equal(isInitialWorkshopStateRead({output_id,offset}),false);
  }
  for (const output_id of [false,0,{},[], 'snapshot']) assert.equal(isInitialWorkshopStateRead({output_id,offset:0}),false);
});

test('read normalization is scoped, immutable and retains real filters and cursors', () => {
  const request = { detail:'step', section:'prompts', shot_no:'02-04', episode:'', work_unit_id:null, output_id:' ', offset:0 };
  assert.deepEqual(normalizeWorkshopStateRead(request), {detail:'step',section:'prompts',shot_no:'02-04',offset:0});
  assert.equal(request.output_id,' ');
  assert.deepEqual(normalizeWorkshopStateRead({output_id:'snapshot',offset:null}),{output_id:'snapshot'});
  assert.deepEqual(normalizeWorkshopStateRead({section:'',detail:null,offset:'0',other:''}),{offset:'0',other:''});
});
