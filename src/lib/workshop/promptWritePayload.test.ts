import test from 'node:test';
import assert from 'node:assert/strict';
import { hasNonVideoPromptPayload } from './promptWritePayload.ts';
import { readFileSync } from 'node:fs';

test('actual DeepSeek video rewrite calls with signatures do not invoke empty ancillary save', () => {
  for (const item of [
    { shotNo: '01-06', rewriteVideo: true, expectedRefSignature: 'refs-8j13nd' },
    { shotNo: '01-06', rewriteVideo: true, expectedRefSignature: 'refs-8j13nd', videoPrompt: '按 ref2va 六段格式重写' },
    { shot_no: '01-06', expected_ref_signature: 'refs-8j13nd', replace_audio_prompts: true },
  ]) assert.equal(hasNonVideoPromptPayload(item), false);
});
test('real image/frame/audio payloads retain their save branch including intentional clears', () => {
  for (const field of ['imagePrompt','image_prompt','startFramePrompt','start_frame_prompt','endFramePrompt','end_frame_prompt']) {
    assert.equal(hasNonVideoPromptPayload({ [field]: '', expectedRefSignature: 'signature' }), true);
    assert.equal(hasNonVideoPromptPayload({ [field]: null }), false);
  }
  assert.equal(hasNonVideoPromptPayload({audioPrompts: []}), true);
  assert.equal(hasNonVideoPromptPayload({audio_prompts: [{characterId:'a',prompt:'b'}]}), true);
  assert.equal(hasNonVideoPromptPayload({audioPrompts: 'invalid'}), false);
});
test('tool routes ancillary writes by writable fields instead of metadata count', () => {
 const source=readFileSync(new URL('../agent/tools/workshopTools.ts',import.meta.url),'utf8');
 assert.match(source,/if \(hasNonVideoPromptPayload\(nonVideo\)\) otherItems.push\(nonVideo\)/);
});
