/** Real tool, isolated memory. No network, providers, or user-project writes. */
import assert from 'node:assert/strict';
import { installShims } from './preload.mjs';
installShims();window.crypto=globalThis.crypto;
globalThis.fetch=async()=>{throw new Error('Network forbidden');};
const h=await import('./.gen/harness.mjs');
const data=h.emptyWorkshopData('ad-read-fixture');
const content='完整产品证据'.repeat(6000);
data.creativeSpec={workKind:'product-ad',adSpec:{productName:'测试产品',productCategory:'physical',audience:['consumer'],objective:'awareness',durationSec:30,keyMessage:'',complianceSensitive:false,materials:{mode:'online',preparedAt:1,fingerprint:'test',sources:[{url:'https://example.test/product',title:'官网',content}],images:[],productImages:['product.png'],warnings:[]}}};
h.useWorkshopStore.setState({project:{id:data.projectId,name:'隔离项目',sources:[]},data});
const tool=h.createDefaultRegistry().get('workshop_get_state');
for(const section of ['prompts','breakdown','generate']){
 const response=await tool.execute({detail:'step',section});
 assert.equal(response.success,true);assert.ok(!response.output.includes(content));
 assert.match(response.output,/ad-materials/);
 assert.ok(response.output.length<8000,`${section} should not page on unrelated source text`);
}
let response=await tool.execute({detail:'step',section:'ad-materials'}),text='',pages=0;
while(true){
 assert.equal(response.success,true);
 const lines=response.output.split('\n');const header=JSON.parse(lines[0]);
 if(!header.output_id){text=response.output;break;}
 text+=lines.slice(2).join('\n');pages++;
 if(header.complete)break;
 assert.ok(pages<20);response=await tool.execute(header.next_call);
}
assert.equal(JSON.parse(text).adSpec.materials.sources[0].content,content);
assert.equal(h.useWorkshopStore.getState().data.creativeSpec.adSpec.materials.sources[0].content,content);
console.log(`PASS: 3 ordinary sections compact; full evidence losslessly restored over ${pages} pages; no mutation or network`);
