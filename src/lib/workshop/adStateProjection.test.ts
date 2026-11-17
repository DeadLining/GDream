import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAdCreativeSpec } from './adStateProjection.ts';
test('ordinary state removes duplicated source bodies, not stored evidence or identity references',()=>{
 const spec:any={workKind:'product-ad',adSpec:{productName:'p',productImages:['product.png'],materials:{sources:[{url:'https://example.test',title:'官方资料',content:'原始证据'.repeat(10000)}],images:[{url:'ref',path:'ref.png',purpose:'inspiration'}],fingerprint:'f',warnings:['未核实'],preparedAt:1}}};
 const before=JSON.stringify(spec), projected:any=projectAdCreativeSpec(spec);
 assert.equal(JSON.stringify(spec),before);
 assert.equal(projected.adSpec.materials.sources[0].content,undefined);
 assert.equal(projected.adSpec.materials.sources[0].contentChars,40000);
 assert.equal(projected.adSpec.materials.readFullEvidence.section,'ad-materials');
 assert.deepEqual(projected.adSpec.productImages,spec.adSpec.productImages);
 assert.deepEqual(projected.adSpec.materials.images,spec.adSpec.materials.images);
 assert.ok(JSON.stringify(projected).length < before.length/10);
});
test('drama and unprepared ads remain unchanged',()=>{
 const drama:any={workKind:'drama'};const ad:any={workKind:'product-ad',adSpec:{productName:'p'}};
 assert.equal(projectAdCreativeSpec(drama),drama);assert.equal(projectAdCreativeSpec(ad),ad);
});
