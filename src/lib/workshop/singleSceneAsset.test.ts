import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
test('scene asset generation makes one request and selects one result', () => {
  const source = read('../../stores/workshopStore.ts');
  const block = source.slice(source.indexOf('    const runAssetGeneration ='), source.indexOf('  generateSceneVariants:', source.indexOf('    const runAssetGeneration =')));
  assert.equal((block.match(/await runAssetGeneration\(/g) ?? []).length, 1);
  assert.doesNotMatch(block, /viewBReferences|secondDest/);
  assert.match(block, /resultPaths\)\.slice\(0, 1\)/);
  assert.match(block, /selectedImagePaths: \[dest\], sceneReferenceMode: undefined/);
  assert.match(block, /sceneImagePaths: \[dest\], promptNeedsRefresh: true/);
  assert.match(block, /candidates: \[replacement\]/);
});
test('scene UI and authoring no longer demand two generated views', () => {
  const ui = read('../../components/workshop/steps/StepAssets.tsx');
  assert.doesNotMatch(ui, /重生成两视角|A\/B 两个/);
  assert.match(ui, /重新生成一张场景资产图/);
  assert.match(read('./workshopPrompts.ts'), /场景资产默认一张图/);
});
