import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQualityReviewRequestDescriptor } from './qualityReviewRequest.ts';

test('builds boundary review content in start-frame then end-frame order', () => {
  const request = buildQualityReviewRequestDescriptor({
    baseUrl: 'http://127.0.0.1:30377/v1/',
    model: 'qwen3.8-27b',
    apiKey: ' secret ',
    kind: 'boundary-frames',
    prompt: '完整镜头提示词',
    startFrameUrl: 'data:image/png;base64,start',
    endFrameUrl: 'data:image/png;base64,end',
  });
  assert.equal(request.url, 'http://127.0.0.1:30377/v1/chat/completions');
  assert.deepEqual(request.headers, { Authorization: 'Bearer secret' });
  const user = request.payload.messages[1];
  assert.equal(user.role, 'user');
  if (user.role !== 'user') return;
  assert.deepEqual(user.content.map((part) => part.type), ['text', 'text', 'image_url', 'text', 'image_url']);
  assert.equal(user.content[2].type === 'image_url' ? user.content[2].image_url.url : '', 'data:image/png;base64,start');
  assert.equal(user.content[4].type === 'image_url' ? user.content[4].image_url.url : '', 'data:image/png;base64,end');
  const system = request.payload.messages[0];
  assert.equal(system.role, 'system');
  if (system.role === 'system') assert.match(system.content, /target=.*start-frame/);
});

test('builds video review without an authorization header when no key is configured', () => {
  const request = buildQualityReviewRequestDescriptor({
    baseUrl: 'http://127.0.0.1:30377',
    model: 'qwen3.8-27b',
    kind: 'video',
    prompt: '视频提示词',
    videoUrl: 'data:video/mp4;base64,video',
  });
  assert.equal(request.headers, undefined);
  const user = request.payload.messages[1];
  assert.equal(user.role, 'user');
  if (user.role !== 'user') return;
  const video = user.content.find((part) => part.type === 'video_url');
  assert.equal(video?.type === 'video_url' ? video.video_url.url : '', 'data:video/mp4;base64,video');
});
