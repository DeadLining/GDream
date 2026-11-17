import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../components/canvas/nodes/TextNode.tsx',import.meta.url),'utf8');
test('preview and editor opt out of React Flow wheel panning',()=>{
 assert.match(source,/className="cv-md nowheel nodrag nopan/);
 assert.match(source,/className="nowheel nodrag nopan w-full h-full/);
 assert.match(source,/overscroll-contain/);
});
