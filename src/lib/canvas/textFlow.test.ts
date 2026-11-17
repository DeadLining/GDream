import test from 'node:test';
import assert from 'node:assert/strict';
import { composeNodePrompt } from './textFlow.ts';
const nodes = [
  { id: 't', type: 'text', data: { generatedContent: '产品说明' } },
  { id: 'other', type: 'text', data: { description: '不相关内容' } },
];
test('connected text reaches generation input and retry edges do not duplicate it', () => {
  assert.equal(composeNodePrompt('img', '白色背景', nodes, [{ source: 't', target: 'img' }, { source: 't', target: 'img' }]), '白色背景\n\n产品说明');
});
test('text-only input and updated upstream text are read at submission time', () => {
  assert.equal(composeNodePrompt('img', '', nodes, [{ source: 't', target: 'img' }]), '产品说明');
  assert.equal(composeNodePrompt('img', '产品说明', nodes, [{ source: 't', target: 'img' }]), '产品说明');
  assert.equal(composeNodePrompt('img', '', nodes, [{ source: 't', target: 'else' }]), '');
});

test('reference cards and submission share inclusion, dedup and provenance exclusion', async () => {
 const { projectTextInputs } = await import('./textFlow.ts');
 const graph = [...nodes, {id:'same',type:'text',data:{description:'产品说明',lineageLabel:'镜头说明'}}, {id:'blank',type:'text',data:{description:''}}];
 const edges = [{source:'t',target:'img'},{source:'t',target:'img'},{source:'same',target:'img'},{source:'blank',target:'img'},{source:'other',target:'img',data:{relation:'provenance'}}];
 const p = projectTextInputs('img','产品说明',graph,edges);
 assert.equal(p.prompt,'产品说明');
 assert.equal(p.references.length,3);
 assert.equal(p.references[0].status,'duplicate');
 assert.equal(p.references[1].label,'镜头说明');
 assert.equal(p.references[2].status,'empty');
 assert.equal(projectTextInputs('img','',graph,edges).references[0].status,'included');
 assert.equal(composeNodePrompt('img','',graph,edges),projectTextInputs('img','',graph,edges).prompt);
});
