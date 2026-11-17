import test from 'node:test';
import assert from 'node:assert/strict';
import { adMaterialsFingerprint, adMaterialsError, parseAdSearchResult } from './adMaterials.ts';
import { buildProductAdPrompt, type AdCreativeSpec } from './adSpec.ts';
import { buildImageRefBindings, buildVideoRefBindings, shotReferenceSignature, compactStoryboardFrameReferences, remapShotPromptRefs } from './shotRefs.ts';
import type { WsShot } from './types.ts';
const ad: AdCreativeSpec = {productName:'产品',productCategory:'fmcg',audience:['consumer'],objective:'conversion',durationSec:30,productImages:['/project/product.png']};
test('ads require current materials; drama unaffected; changed product invalidates receipt',()=>{
 assert.equal(adMaterialsError({workKind:'drama'}), undefined);
 assert.match(adMaterialsError({workKind:'product-ad',adSpec:ad})!, /workshop_prepare_ad_materials/);
 const prepared={...ad, materials:{fingerprint:adMaterialsFingerprint(ad),preparedAt:1,mode:'online' as const,sources:[{url:'https://example.com',title:'官网',content:'说明'}],images:[],productImages:ad.productImages!,warnings:[]}};
 assert.equal(adMaterialsError({workKind:'product-ad',adSpec:prepared}),undefined);
 assert.ok(adMaterialsError({workKind:'product-ad',adSpec:{...prepared,productName:'不同产品'}}));
 assert.ok(adMaterialsError({workKind:'product-ad',adSpec:{...prepared,productImages:['/new.png']}}));
 assert.ok(adMaterialsError({workKind:'product-ad',adSpec:{...prepared,researchMode:'provided-only'}}));
});
test('Tavily evidence parser retains sources and safe image URLs, rejects missing sources',()=>{
 const result=parseAdSearchResult('[前缀]\n'+JSON.stringify({results:[{title:'产品官网',url:'https://example.com',content:'事实'}],images:['https://example.com/p.png','javascript:bad']}));
 assert.equal(result.sources.length,1); assert.deepEqual(result.images,['https://example.com/p.png']);
 assert.throws(()=>parseAdSearchResult('No results'),/来源/);
});
test('product references reach actual image AND video bindings, not just model input',()=>{
 const shot={id:'s',shotNo:'1',characterIds:[],propIds:[],extraRefImages:['/project/product.png']} as unknown as WsShot;
 const ctx={scenes:[],characters:[],props:[],creativeSpec:{workKind:'product-ad' as const,adSpec:ad}};
 for(const refs of [buildImageRefBindings(shot,ctx),buildVideoRefBindings(shot,ctx)]){
  assert.equal(refs.filter(r=>r.path==='/project/product.png').length,1);
  assert.match(refs.find(r=>r.path==='/project/product.png')!.label,/产品/);
 }
 assert.notEqual(shotReferenceSignature(shot,ctx),shotReferenceSignature(shot,{...ctx,creativeSpec:{...ctx.creativeSpec,adSpec:{...ad,productImages:['/new.png']}}}));
});
test('ad prompt mandates preparation, factual attribution and product identity preservation',()=>{
 const prompt=buildProductAdPrompt('brief',ad);
 assert.match(prompt,/workshop_prepare_ad_materials/); assert.match(prompt,/不得替代/); assert.match(prompt,/产品图/);
});

test('storyboard compaction cannot discard product identity; replacing it removes stale snapshot refs',()=>{
 const old={id:'s',shotNo:'1',characterIds:[],productReferenceImages:['/old.png'],extraRefImages:['/scene.png'],storyboardFrames:[{id:'f',prompt:'@图片二 场景',refImagePaths:['/old.png','/scene.png']}]} as unknown as WsShot;
 const ctx={scenes:[],characters:[],props:[]};
 const compact=compactStoryboardFrameReferences(old,old.storyboardFrames![0],ctx);
 assert.ok(compact.bindings.some(r=>r.path==='/old.png'));
 const next={...old,productReferenceImages:['/new.png']};
 const patch=remapShotPromptRefs(old,next,ctx);
 const paths=patch.storyboardFrames![0].refImagePaths!;
 assert.ok(paths.includes('/new.png'));assert.ok(!paths.includes('/old.png'));
});

test('a product image shared with a prop is deduplicated but remains mandatory',()=>{
 const shot={shotNo:'1',characterIds:[],propIds:['p'],productReferenceImages:['/product.png']} as unknown as WsShot;
 const ctx={scenes:[],characters:[],props:[{id:'p',assetImagePath:'/product.png'}]};
 const refs=compactStoryboardFrameReferences(shot,{prompt:'@图片二 灵感',refImagePaths:['/product.png','/inspiration.png']},ctx).bindings;
 assert.equal(refs.filter(ref=>ref.path==='/product.png').length,1);
 assert.equal(refs.find(ref=>ref.path==='/product.png')!.productIdentity,true);
});

test('ad generation refs keep product identity separate and require curated web images', async () => {
 const { getAdGenerationReferences } = await import('./adMaterials.ts');
 const ad:any = {
  productName:'P', productCategory:'physical', audience:['public'], objective:'awareness', researchMode:'online', productImages:['/product.png'],
  materials:{ fingerprint:'', preparedAt:1, mode:'online', productImages:['/product.png'], warnings:[],
    sources:[{url:'https://example.test',title:'官网',content:'事实'}],
    images:[{url:'https://img.example/inspiration.png',path:'/inspiration.png',purpose:'inspiration'}],
    curatedImageUrls:['https://img.example/inspiration.png'] },
 };
 ad.materials.fingerprint = (await import('./adMaterials.ts')).adMaterialsFingerprint(ad);
 assert.deepEqual(getAdGenerationReferences(ad), [
  {path:'/product.png', role:'product-identity'},
  {path:'/inspiration.png', role:'creative-reference', sourceUrl:'https://img.example/inspiration.png'},
 ]);
 ad.materials.curatedImageUrls=[];
 assert.deepEqual(getAdGenerationReferences(ad), [{path:'/product.png', role:'product-identity'}]);
});

test('stale ad materials never leak into generation refs', async () => {
 const { getAdGenerationReferences } = await import('./adMaterials.ts');
 const ad:any = { productName:'P', productCategory:'physical', audience:[], objective:'awareness', productImages:['/product.png'], materials:{ fingerprint:'stale', productImages:['/product.png'], images:[], sources:[], warnings:[], mode:'provided-only' } };
 assert.deepEqual(getAdGenerationReferences(ad), []);
});
