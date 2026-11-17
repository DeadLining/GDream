/** Production tools/stores/reference builders, only IO mocked. Never calls paid generation. */
import assert from 'node:assert/strict';
import {installShims} from './preload.mjs';
installShims(); window.crypto=globalThis.crypto;
window.__TAURI_METADATA__={__currentWindow:{label:'main'},__windows:[]};
const png=[...Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64')];
let network=[]; let failSearch=false; let failImage=false; let failWrite=false; let switchProject;
const writes=[];
window.__TAURI_IPC__=args=>{
 const done=value=>window[`_${args.callback}`]?.(value), fail=value=>window[`_${args.error}`]?.(value);
 if(args.cmd==='get_file_size') return failImage?fail('fixture image unavailable'):done(png.length);
 if(args.cmd==='write_text_file_private') return done(null);
 if(args.cmd==='get_home_dir') return done('/isolated/');
 if(args.__tauriModule==='Path') return done('/isolated/');
 if(args.__tauriModule==='Fs') {
  const cmd=args.message.cmd;
  if(cmd==='readFile') return done(png);
  if(cmd==='exists') return done(false);
  if(['createDir','writeFile','writeTextFile','renameFile'].includes(cmd)){
   if(failWrite && cmd==='writeFile') return fail('fixture disk full');
   writes.push(args.message);return done(null);
  }
 }
 if(args.__tauriModule==='Http' && args.message.cmd==='createClient') return done(1);
 if(args.__tauriModule==='Http' && args.message.cmd==='httpRequest'){
  const options=args.message.options; network.push(options);
  if(options.method==='GET'){
   assert.equal(options.headers?.Authorization,undefined);
   assert.equal(options.url,'https://images.example/product.png');
   return done({url:options.url,status:200,headers:{'content-type':'image/png'},data:png});
  }
  assert.equal(options.url,'https://mcp.tavily.com/mcp/','No model or paid generation request allowed');
  assert.equal(options.headers.Authorization,'Bearer fixture-tavily-only');
  const body=options.body.payload;
  if(failSearch) return done({url:options.url,status:429,headers:{},data:'quota'});
  if(switchProject){switchProject();switchProject=undefined;}
  const result=body.method==='initialize'?{protocolVersion:'2024-11-05'}:{content:[{type:'text',text:JSON.stringify({results:[{title:'产品官网',url:'https://example.com/product',content:'规格说明'}],images:['https://images.example/product.png']})}]};
  return done({url:options.url,status:body.id?200:202,headers:{},data:body.id?JSON.stringify({jsonrpc:'2.0',id:body.id,result}):''});
 }
 return fail(`Unexpected IPC: ${args.cmd ?? args.message?.cmd}`);
};
globalThis.fetch=async()=>{throw new Error('Unmocked network forbidden');};
const {createDefaultRegistry,useWorkshopStore:ws,useSettingsStore:settings,emptyWorkshopData,adAuditImageRefs,adAuditVideoRefs,buildNativeMediaBlocks}=await import('./.gen/harness.mjs');
const registry=createDefaultRegistry(), prepare=registry.get('workshop_prepare_ad_materials');
const baseAd={productName:'测试气泡水',productCategory:'fmcg',audience:['consumer'],objective:'conversion',durationSec:30,productImages:['/user/product.png']};
function reset(ad={...baseAd}){
 const data=emptyWorkshopData('ad-fixture');
 data.creativeSpec={workKind:'product-ad',adSpec:ad};
 ws.setState({project:{id:'ad-fixture',name:'测试广告',sources:[]},data});
 settings.setState({webSearchEnabled:true,credentials:[{id:'tav',apiKey:'fixture-tavily-only',label:'Tavily',baseUrl:'https://mcp.tavily.com/mcp/',createdAt:1}],credentialRefs:{tavily:'tav'}});
 network=[]; failSearch=false;failImage=false;failWrite=false;
}
reset();
const attachmentBlocks = await buildNativeMediaBlocks(['/user/product.png']);
assert.equal(attachmentBlocks[0].type,'image');assert.equal(attachmentBlocks[0].source.type,'base64');assert.equal(network.length,0);
failImage=true;await assert.rejects(buildNativeMediaBlocks(['/missing.png']),/附件读取失败/);failImage=false;
for(const name of ['workshop_set_breakdown','workshop_set_shots','workshop_generate']){
 const result=await registry.get(name).execute({kind:'asset'});
 assert.equal(result.success,false);assert.match(result.error,/workshop_prepare_ad_materials/);
}
await assert.rejects(ws.getState().generateAsset('prop','not-yet-existing'),/workshop_prepare_ad_materials/);
await assert.rejects(ws.getState().generateShot('1','image'),/workshop_prepare_ad_materials/);
assert.equal(network.length,0);
settings.setState({webSearchEnabled:false});
assert.equal((await prepare.execute({})).success,false);assert.equal(network.length,0);
assert.equal(ws.getState().data.creativeSpec.adSpec.materials,undefined);
settings.setState({webSearchEnabled:true});
let result=await prepare.execute({});
assert.equal(result.success,true,result.error);assert.equal(result.media.length,2);
let ad=ws.getState().data.creativeSpec.adSpec;
assert.equal(ad.materials.sources.length,1);assert.equal(ad.materials.images.length,1);
assert.deepEqual(ad.productImages,['/user/product.png'],'Search images never replace user product identity');
assert.match(ad.materials.images[0].path,/ad-materials/);assert.ok(writes.length>0);
assert.equal(network.length,4,'initialize, initialized, search, read original image');
ws.getState().setShots([{shotNo:'1',characterIds:[],propIds:[],description:'产品特写'}]);
let data=ws.getState().data, shot=data.shots[0];
assert.deepEqual(shot.productReferenceImages,['/user/product.png']);
assert.ok(adAuditImageRefs(shot,{scenes:[],characters:[],props:[]}).some(r=>r.path==='/user/product.png'));
for(const refs of [adAuditImageRefs(shot,data),adAuditVideoRefs(shot,data)]) assert.ok(refs.some(r=>r.path==='/user/product.png'));
// Updating/removing identity images invalidates preparation AND updates persisted reference snapshots.
ws.getState().setCreativeSpec({...data.creativeSpec,adSpec:{...ad,productImages:['/user/new-product.png']}});
data=ws.getState().data; shot=data.shots[0];
assert.deepEqual(shot.productReferenceImages,['/user/new-product.png']);assert.equal(shot.promptNeedsRefresh,true);
assert.equal((await registry.get('workshop_generate').execute({kind:'asset'})).success,false);
assert.ok(adAuditImageRefs(shot,data).some(r=>r.path==='/user/new-product.png'));
assert.ok(!adAuditImageRefs(shot,data).some(r=>r.path==='/user/product.png'));
reset();failSearch=true;
assert.equal((await prepare.execute({})).success,false);assert.equal(ws.getState().data.creativeSpec.adSpec.materials,undefined);
reset({...baseAd,researchMode:'provided-only'});failWrite=true;
result=await prepare.execute({});assert.equal(result.success,false);assert.match(result.error,/写入失败/);assert.equal(ws.getState().data.creativeSpec.adSpec.materials,undefined,'Failed persistence cannot unlock generation');failWrite=false;
reset();failImage=true;
assert.equal((await prepare.execute({})).success,false);assert.equal(network.length,0);
reset({...baseAd,researchMode:'provided-only'});settings.setState({webSearchEnabled:false});
result=await prepare.execute({});assert.equal(result.success,true,result.error);assert.equal(result.media.length,1);assert.equal(network.length,0);assert.match(result.output,/未联网/);
reset();const controller=new AbortController();controller.abort();
assert.equal((await prepare.execute({},controller.signal)).success,false);assert.equal(network.length,0);
reset();switchProject=()=>ws.setState({project:{id:'other',name:'other',sources:[]},data:emptyWorkshopData('other')});
assert.equal((await prepare.execute({})).success,false);assert.equal(ws.getState().data.creativeSpec,undefined);
// Product-upload tool persists originals, refuses unconfirmed remote URLs, and never calls a generator.
reset({...baseAd,productImages:[]});
const bind=registry.get('workshop_set_ad_product_images');
assert.equal((await bind.execute({paths:['https://images.example/product.png']})).success,false);
result=await bind.execute({paths:['/user/upload.png']});assert.equal(result.success,true,result.error);
assert.match(ws.getState().data.creativeSpec.adSpec.productImages[0],/ad-materials/);assert.equal(network.length,0);
console.log('PASS: ad preparation -> native images + saved evidence -> actual image/video references; gate failures, offline choice, changed refs, cancellation and project isolation all covered. No paid generation.');
