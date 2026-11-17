/** Real registered tool, no providers or user project IO. */
import assert from 'node:assert/strict';
import { installShims } from './preload.mjs';
installShims();
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const h = await import('./.gen/harness.mjs');
const data = h.emptyWorkshopData('paging-fixture');
data.currentStep = 'breakdown';
data.synopsis = '分页事实正文'.repeat(5000);
h.useWorkshopStore.setState({data,project:{id:'paging-fixture',name:'Paging fixture',sources:[]}});
const tool = h.createDefaultRegistry().get('workshop_get_state');
const payload = {detail:'step',episode:'',offset:0,output_id:'',section:'current',shot_no:'',work_unit_id:''};
const first = await tool.execute(payload);
const bridged = await h.pagingAuditDshCall({name:'workshop_get_state',arguments:payload},h.createDefaultRegistry(),{onToolStart(){},onToolEnd(){}},new AbortController().signal);
assert.equal(bridged.success,true,bridged.error);
assert.equal(bridged.output,first.output,'DSH and ordinary tools use the same input contract');
assert.equal(first.success,true,first.error);
assert.equal((await tool.execute({detail:'step',section:'current'})).output,first.output);
assert.equal((await tool.execute({...payload,output_id:null,offset:null})).output,first.output);
let result=first, pages=0, all='';
for (;;) {
 const [header,,...body]=result.output.split('\n');
 const meta=JSON.parse(header);
 all+=body.join('\n'); pages++;
 if(meta.complete)break;
 result=await tool.execute({...payload,...meta.next_call});
 assert.equal(result.success,true,result.error);
 assert.ok(pages<50);
}
assert.ok(pages>1);
assert.ok(all.includes(data.synopsis));
for(const args of [{...payload,offset:1},{...payload,offset:'0'},{output_id:'unknown',offset:0},{output_id:JSON.parse(first.output.split('\n')[0]).output_id,offset:null}]) {
 assert.equal((await tool.execute(args)).success,false,'Invalid cursors must never fall back to first page');
}
const cursor=JSON.parse(first.output.split('\n')[0]).next_call;
h.useWorkshopStore.setState({project:{id:'another-project'},data});
assert.equal((await tool.execute(cursor)).success,false,'Cross-project cursor must fail');
assert.equal(payload.output_id,'','Do not mutate the recorded model call');
console.log(`PASS: real model empty-default call -> registered tool -> ${pages} complete pages; strict cursor and project guards preserved. No network or paid generation.`);
