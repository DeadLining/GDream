import test from 'node:test';
import assert from 'node:assert/strict';
import { minimaxImageEndpoint, buildMinimaxImagePayload, parseMinimaxImageResponse, isMinimaxImageSlot } from './minimax.ts';

test('recognizes configured official endpoint without changing generic providers', () => {
  assert.equal(isMinimaxImageSlot('https://api.minimax.io/v1/image_generation', 'image-01'), true);
  assert.equal(isMinimaxImageSlot('http://127.0.0.1:7865', 'Qwen'), false);
  assert.equal(isMinimaxImageSlot('https://api.minimax.io.evil.test', 'other'), false);
  for (const suffix of ['', '/', '/v1', '/v1/image_generation/']) {
    assert.equal(minimaxImageEndpoint(`https://api.minimax.io${suffix}`), 'https://api.minimax.io/v1/image_generation');
  }
});
test('builds one explicit t2i request and never truncates prompt or discards references', () => {
  assert.deepEqual(buildMinimaxImagePayload({prompt:'白灰台面', aspectRatio:'16:9'}), {
    model:'image-01', prompt:'白灰台面', aspect_ratio:'16:9', n:1, response_format:'url', prompt_optimizer:false,
  });
  assert.deepEqual(buildMinimaxImagePayload({
    prompt:'保持产品外观，置于白灰台面',
    subjectReferences:[{type:'character', image_file:'https://cdn.example/product.png'}],
    hasReferences:true,
  }), {
    model:'image-01', prompt:'保持产品外观，置于白灰台面', aspect_ratio:'16:9',
    subject_reference:[{type:'character', image_file:'https://cdn.example/product.png'}],
    n:1, response_format:'url', prompt_optimizer:false,
  });
  assert.throws(() => buildMinimaxImagePayload({prompt:'x'.repeat(1501)}), /1500/);
  assert.throws(() => buildMinimaxImagePayload({prompt:'scene', hasReferences:true}), /subject_reference/);
  assert.throws(() => buildMinimaxImagePayload({prompt:'scene', aspectRatio:'7:8'}), /比例/);
});
test('parses business status and genuine output; refuses malformed successful receipts', () => {
  assert.deepEqual(parseMinimaxImageResponse({base_resp:{status_code:0},data:{image_urls:['https://cdn.example/a.png']}}), {url:'https://cdn.example/a.png'});
  assert.deepEqual(parseMinimaxImageResponse({base_resp:{status_code:0},data:{image_base64:['aGVsbG8=']}}), {b64:'aGVsbG8='});
  assert.throws(() => parseMinimaxImageResponse({base_resp:{status_code:1008,status_msg:'secret echo'}}), /1008/);
  assert.throws(() => parseMinimaxImageResponse({base_resp:{status_code:2049,status_msg:'credential echo'}}), error => {
    assert.match(String(error), /2049.*API Key 无效/);
    assert.doesNotMatch(String(error), /credential echo/);
    return true;
  });
  assert.throws(() => parseMinimaxImageResponse({base_resp:{status_code:0},data:{}}), /没有可用图片/);
  assert.throws(() => parseMinimaxImageResponse({data:{image_urls:['https://cdn.example/a.png']}}), /回执/);
});

test('custom routing does not advertise unsupported native modes', async () => {
 const { supportsCustomImageMode } = await import('./minimax.ts');
 assert.equal(supportsCustomImageMode('https://api.minimax.cn/v1/image_generation','image-01','image-to-image'),true);
 assert.equal(supportsCustomImageMode('https://api.minimax.cn','image-01','text-to-image'),true);
 assert.equal(supportsCustomImageMode('http://127.0.0.1:7865','/opt/models/Qwen-Image-Edit-2509','text-to-image'),false);
 assert.equal(supportsCustomImageMode('http://127.0.0.1:7865','/opt/models/Qwen-Image-Edit-2509','image-to-image'),true);
});
