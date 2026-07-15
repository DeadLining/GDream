import {describe, expect, it} from 'vitest';

import {assertFullEpisodeClosure, buildFullEpisodeExecutionPlan, hasImageSignature, hasMp4Signature, parseScriptSse} from '../e2e/support/real-model-pipeline';


describe('real model E2E helpers', () => {
  it('reassembles streamed script chunks and surfaces provider errors', () => {
    expect(parseScriptSse([
      'event: chunk\ndata: {"text":"第一幕"}',
      'event: chunk\ndata: {"text":"：钟表店"}',
      'event: done\ndata: {"finish_reason":"stop"}',
      '',
    ].join('\n\n'))).toBe('第一幕：钟表店');

    expect(() => parseScriptSse('event: error\ndata: {"message":"provider failed"}\n\n'))
      .toThrow('provider failed');
  });

  it('accepts supported image signatures and MP4 ftyp data', () => {
    expect(hasImageSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(hasImageSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(hasImageSignature(Buffer.from('RIFF0000WEBP'))).toBe(true);
    expect(hasImageSignature(Buffer.from('not-an-image'))).toBe(false);

    expect(hasMp4Signature(Buffer.from('\u0000\u0000\u0000\u0018ftypmp42video'))).toBe(true);
    expect(hasMp4Signature(Buffer.from('not-a-video'))).toBe(false);
  });

  it('requires every shot and the final release chain to be complete', () => {
    const complete={
      episode:{scenes:[{shots:[{id:'shot-1',active_video_asset_id:'video-1',dialogue:[{id:'line-1',text:'向前走'}]},{id:'shot-2',active_video_asset_id:'video-2',dialogue:[]}]}]},
      shots:[{shot_id:'shot-1',panel:{bytes:20_000},video:{bytes:200_000}},{shot_id:'shot-2',panel:{bytes:21_000},video:{bytes:210_000}}],
      speech:[{dialogue_id:'line-1',asset:{bytes:4_000}}],
      render:{bytes:500_000,review:{overall_pass:true}},
      release:{candidate:{id:'candidate-1'},gate:{ready:true},publication:{id:'publication-1',status:'published'}},
    };

    expect(()=>assertFullEpisodeClosure(complete)).not.toThrow();
    expect(()=>assertFullEpisodeClosure({...complete,shots:complete.shots.slice(0,1)})).toThrow('Not every episode shot has a generated video');
    expect(()=>assertFullEpisodeClosure({...complete,speech:[]})).toThrow('Not every dialogue line has generated speech');
    expect(()=>assertFullEpisodeClosure({...complete,render:{...complete.render,review:{overall_pass:false}}})).toThrow('Render quality review did not pass');
    expect(()=>assertFullEpisodeClosure({...complete,release:{...complete.release,gate:{ready:false}}})).toThrow('Release gate did not pass');
  });

  it('plans every shot and every non-empty dialogue line in episode order',()=>{
    const plan=buildFullEpisodeExecutionPlan({scenes:[
      {shots:[{id:'shot-1',dialogue:[{id:'line-1',text:'第一句'},{id:'line-empty',text:'  '}]},{id:'shot-2',dialogue:[]}]},
      {shots:[{id:'shot-3',dialogue:[{id:'line-2',text:'第二句'}]}]},
    ]});

    expect(plan).toEqual({shotIds:['shot-1','shot-2','shot-3'],dialogueIds:['line-1','line-2']});
  });
});
