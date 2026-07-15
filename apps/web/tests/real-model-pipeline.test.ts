import {describe, expect, it} from 'vitest';

import {hasImageSignature, hasMp4Signature, parseScriptSse} from '../e2e/support/real-model-pipeline';


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
});
