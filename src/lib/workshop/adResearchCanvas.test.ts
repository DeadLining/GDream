import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdResearchSelection, upsertAdResearchNodes } from './adResearchCanvas.ts';
const sources=[{url:'https://example.test/product',title:'官方产品页',content:'真实功能说明',reason:'用于核心卖点'}];
test('selection validates URLs and never implies verification or identity adoption',()=>{
 const value=parseAdResearchSelection({sources,images:[{url:'https://example.test/a.png',reason:'构图参考'}]});
 assert.equal(value.sources[0].reason,'用于核心卖点');
 assert.throws(()=>parseAdResearchSelection({sources:[{...sources[0],url:'file:///secret'}]}));
 assert.throws(()=>parseAdResearchSelection({sources:[],images:[]}));
 assert.throws(()=>parseAdResearchSelection({images:[{url:'http://127.0.0.1/a',reason:'x'}]}));
});
test('canvas upsert is idempotent, project scoped, preserves unrelated nodes and manual position',()=>{
 const selected=parseAdResearchSelection({sources,images:[{url:'https://example.test/a.png',reason:'构图参考'}]});
 const images=[{url:'https://example.test/a.png',path:'/project/a.png',purpose:'inspiration' as const}];
 const original:any[]=[{id:'manual',position:{x:0,y:0},data:{description:'用户内容'}}];
 let seq=0;const build=(nodes:any[])=>upsertAdResearchNodes(nodes,'project-a',selected,images,p=>'asset://'+p,()=>`id-${++seq}`);
 const first=build(original);const second=build(first.nodes);
 assert.equal(second.nodes.length,first.nodes.length);assert.deepEqual(second.nodeIds,first.nodeIds);
 assert.equal(first.nodes[0],original[0]);
 const img=first.nodes.find(n=>n.type==='image')!;assert.equal(img.data.localPath,'/project/a.png');
 assert.match(img.data.description,/待确认/);assert.equal(img.data.isGenerating,undefined);
 img.position={x:900,y:900};assert.deepEqual(build(first.nodes).nodes.find(n=>n.id===img.id)!.position,img.position);
 assert.equal(first.nodes.some(n=>n.data.productImages),false);
});

test('selection rejects private literals, credentials, duplicates and oversized evidence', () => {
  for (const url of ['https://localhost./a','https://host.local./a','https://host.localhost./a','https://127.0.0.1/a','https://[::1]/a','https://user:pass@example.test/a']) {
    assert.throws(() => parseAdResearchSelection({sources:[{...sources[0],url}]}), url);
  }
  assert.throws(() => parseAdResearchSelection({sources:[sources[0],sources[0]]}));
  assert.throws(() => parseAdResearchSelection({sources:[{...sources[0],content:'x'.repeat(16001)}]}));
  assert.throws(() => parseAdResearchSelection({images:Array(7).fill({url:'https://example.test/a',reason:'参考'})}));
  const normalized = parseAdResearchSelection({sources:[{...sources[0],url:sources[0].url+'#details'}]});
  assert.equal(normalized.sources[0].url,sources[0].url);
});

test('canvas rejects a selected image without a durable local file record', () => {
  assert.throws(() => upsertAdResearchNodes([], 'p', {sources:[],images:[{url:'https://example.test/a',reason:'参考'}]}, [], p=>p, ()=>'id'), /尚未下载/);
});
