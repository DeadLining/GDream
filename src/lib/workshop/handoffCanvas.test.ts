import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileHandoffNodes, placeNewHandoffNodes } from './handoffCanvas.ts';
const node = (id: string, path: string, x = 0): any => ({ id, type:'video', position:{x,y:0}, data:{localPath:path,workshopRef:{projectId:'p',kind:'shot',role:'shot-video',id:'01-01'}} });
test('legacy handoff copies merge into canonical node preserving position, versions and connections', () => {
 const canonical=node('lineage','new.mp4',700);canonical.data.lineageManaged=true;
 const legacy=node('node-ws-p-01-01','old.mp4');
 const r=reconcileHandoffNodes([canonical,legacy], [{id:'e',source:legacy.id,target:'other'}] as any, 'p');
 assert.equal(r.nodes.length,1);assert.equal(r.nodes[0].position.x,700);
 assert.equal(r.nodes[0].data.localPath,'new.mp4');assert.ok(r.nodes[0].data.assetVersions.some((v:any)=>v.path==='old.mp4'));
 assert.equal(r.edges[0].source,'lineage');
 assert.deepEqual(reconcileHandoffNodes(r.nodes,r.edges,'p'),r);
});
test('never merges another project or user-created node', () => {
 const a=node('manual','a');const b=node('node-ws-p-01-01','b');b.data.workshopRef.projectId='q';
 assert.equal(reconcileHandoffNodes([a,b],[],'p').nodes.length,2);
});
test('only new nodes move out of occupied rectangles', () => {
 const a=node('a','a');const b=node('b','b');
 const r=placeNewHandoffNodes([a,b],new Set(['a']));
 assert.deepEqual(r[0].position,a.position);assert.ok(r[1].position.y>=240);
});
test('legacy shot number joins the stable shot identity used by live sync', () => {
 const a=node('lineage','new.mp4');a.data.lineageManaged=true;a.data.workshopRef.shotId='stable';
 const b=node('node-ws-p-01-01','old.mp4');
 assert.equal(reconcileHandoffNodes([a,b],[],'p').nodes.length,1);
});
