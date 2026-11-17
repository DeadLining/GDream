import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from './types.ts';
import { selectPromptShots, promptShotFacts } from './promptState.ts';
test('single shot takes precedence; padded and inferred episode numbers match', () => {
  const data = emptyWorkshopData('p');
  data.shots = [{ shotNo: '01-01', description: '', characterIds: [] }, { shotNo: '02-01', episode: '02', description: '', characterIds: [] }];
  assert.equal(selectPromptShots(data, '', '1')[0].shotNo, '01-01');
  assert.equal(selectPromptShots(data, '', '2')[0].shotNo, '02-01');
  assert.equal(selectPromptShots(data, '01-01', '2')[0].shotNo, '01-01');
  assert.equal(selectPromptShots(data, 'missing').length, 0);
});
test('prompt facts retain dialogue/timeline/H3 slot but exclude production history', () => {
  const shot = { shotNo: '01-01', description: '原文画面', dialogue: '原文台词', characterIds: [], universalVideoPrompt: 'H3', videoPath: '/old.mp4', genError: 'HUGE_HISTORY'.repeat(10000) };
  const facts = promptShotFacts(shot, true);
  assert.equal(facts.dialogue, shot.dialogue);
  assert.equal(facts.universalVideoPrompt, 'H3');
  assert.equal(facts.universalVideoPromptLength, 2);
  assert.doesNotMatch(JSON.stringify(facts), /HUGE_HISTORY|old.mp4/);
});

test('prompt facts keep explicit sparse prop references and ordinary textual objects', () => {
  for (const full of [false, true]) {
    const facts = promptShotFacts({ shotNo: '01-01', description: '桌上有普通茶杯', characterIds: [], propIds: ['cup'], assetPropIds: [], incidentalObjects: ['普通白色茶杯'] }, full);
    assert.deepEqual(facts.assetPropIds, []);
    assert.deepEqual(facts.incidentalObjects, ['普通白色茶杯']);
    assert.deepEqual(facts.propIds, ['cup']);
  }
});
