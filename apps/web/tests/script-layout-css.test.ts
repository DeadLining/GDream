import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const css=readFileSync(resolve(process.cwd(),'app/styles/10-script.css'),'utf8');

describe('script workspace layout CSS',()=>{
  it('lets the rendered script fill the available editor width',()=>{
    expect(css).toMatch(/\.script-markdown\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none[^}]*box-sizing:\s*border-box/s);
  });
});
