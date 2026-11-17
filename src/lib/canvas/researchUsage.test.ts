import test from 'node:test';import assert from 'node:assert/strict';
import {researchUsageEdges} from './researchUsage.ts';
const ns=[{id:'r',position:{x:0,y:0},data:{adResearchStatus:'reference',localPath:'/r',generatedImageUrl:'asset:r',sourceUrl:'https://example.test/image.png'}}];

test('only actual supplied research refs with a successful receipt get an informational edge',()=>{
 assert.equal(researchUsageEdges(ns,'out',[], '/out','task').length,0);
 assert.equal(researchUsageEdges(ns,'out',['/r'], '/out','').length,0);
 const edges=researchUsageEdges(ns,'out',['asset:r'],'/out','task');
 assert.equal(edges.length,1);assert.equal(edges[0].data.relation,'provenance');
 assert.equal(edges[0].data.mediaProvenance.sourcePath,'/r');
 assert.equal(researchUsageEdges(ns,'r',['/r'],'/out','task').length,0);
});

test('matches source URLs and asset localhost URLs for video references too',()=>{
 const byUrl=researchUsageEdges(ns,'video',['https://example.test/image.png'],'/video.mp4','task-video');
 assert.equal(byUrl.length,1);
 assert.equal(byUrl[0].data.mediaProvenance.operation,'media-reference');
 const byAsset=researchUsageEdges(ns,'video',['asset://localhost/%2Fr'],'/video.mp4','task-video');
 assert.equal(byAsset.length,1);
});
