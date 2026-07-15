import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';


const css=readFileSync(resolve(process.cwd(),'app/styles/17-recast-review.css'),'utf8');

describe('review publish layout CSS',()=>{
  it('keeps the compact header inside its fixed workspace row',()=>{
    expect(css).toMatch(/\.review-publish-workspace\s*>\s*\.review-panel-header\s*\{[^}]*min-height:\s*72px/s);
    expect(css).toMatch(/\.review-header-copy\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.review-header-title\s*\{[^}]*display:\s*flex/s);
  });

  it('pins preview media to the player stage so intrinsic size cannot overflow',()=>{
    expect(css).toMatch(/\.review-player-stage\s*>\s*\.review-player-media\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*object-fit:\s*contain/s);
  });

  it('contains long review copy inside each queue row',()=>{
    expect(css).toMatch(/\.review-publish-workspace\s+\.review-row\s*\{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.review-publish-workspace\s+\.review-shot-context\s+small\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
  });
});
