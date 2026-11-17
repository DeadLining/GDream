import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMiniMaxH3Model,
  projectH3SubmissionCounts,
  projectMiniMaxH3Ref2vaCapabilities,
  projectProviderCapabilities,
} from './providerCapabilities.ts';

test('recognizes both short and fully qualified MiniMax H3 model names', () => {
  assert.equal(isMiniMaxH3Model('minimax-h3'), true);
  assert.equal(isMiniMaxH3Model('MiniMaxAI/MiniMax-H3'), true);
  assert.equal(isMiniMaxH3Model('minimax-hailuo-h3'), true);
  assert.equal(isMiniMaxH3Model('seedance-2.0'), false);
});

test('MiniMax H3 projects all multimodal references as native', () => {
  const result = projectProviderCapabilities({ engineId: 'minimax-h3', imageCount: 7, audioCount: 2, videoCount: 2 });
  assert.equal(result.canSubmit, true);
  assert.ok(result.items.every((item) => item.status === 'native'));
});

test('MiniMax H3 blocks reference counts beyond conditions limits', () => {
  const result = projectProviderCapabilities({ engineId: 'minimax-h3', imageCount: 10, audioCount: 4, videoCount: 4 });
  assert.equal(result.canSubmit, false);
  assert.equal(result.items.find((item) => item.kind === 'image')?.status, 'unsupported');
  assert.equal(result.items.find((item) => item.kind === 'audio')?.status, 'unsupported');
  assert.equal(result.items.find((item) => item.kind === 'video')?.status, 'unsupported');
  assert.match(result.items.find((item) => item.kind === 'image')?.reason ?? '', /9/);
});

test('H3 submission counts mirror the actual task conditions', () => {
  assert.deepEqual(projectH3SubmissionCounts({
    task: 't2va',
    boundaryFrameCount: 2,
    assetImageCount: 8,
    audioCount: 3,
    videoCount: 2,
  }), { imageCount: 0, audioCount: 0, videoCount: 0 });

  assert.deepEqual(projectH3SubmissionCounts({
    task: 'i2va',
    boundaryFrameCount: 2,
    assetImageCount: 8,
    audioCount: 3,
    videoCount: 2,
  }), { imageCount: 1, audioCount: 0, videoCount: 0 });

  assert.deepEqual(projectH3SubmissionCounts({
    task: 'fl2va',
    boundaryFrameCount: 2,
    assetImageCount: 8,
    audioCount: 3,
    videoCount: 2,
  }), { imageCount: 2, audioCount: 0, videoCount: 0 });

  assert.deepEqual(projectH3SubmissionCounts({
    task: 'ref2va',
    boundaryFrameCount: 2,
    assetImageCount: 8,
    audioCount: 3,
    videoCount: 2,
  }), { imageCount: 8, audioCount: 3, videoCount: 2 });
});

test('i2va does not fail because asset references exceed the H3 image cap', () => {
  const counts = projectH3SubmissionCounts({
    task: 'i2va',
    boundaryFrameCount: 2,
    assetImageCount: 8,
    audioCount: 0,
    videoCount: 0,
  });
  const projection = projectProviderCapabilities({ engineId: 'minimax-h3', ...counts });
  assert.equal(projection.canSubmit, true);
  assert.equal(projection.items.find((item) => item.kind === 'image')?.count, 1);
});

test('MiniMax H3 ref2va requires at least one actual reference condition', () => {
  const empty = projectMiniMaxH3Ref2vaCapabilities({});
  assert.equal(empty.canSubmit, false);
  assert.match(empty.summary, /至少需要一项实际参考/);

  const withAudio = projectMiniMaxH3Ref2vaCapabilities({ audioCount: 1 });
  assert.equal(withAudio.canSubmit, true);
});

test('Seedance rejects references beyond declared limits', () => {
  const result = projectProviderCapabilities({ engineId: 'seedance-2.0', imageCount: 11, audioCount: 1 });
  assert.equal(result.canSubmit, false);
  assert.equal(result.items.find((item) => item.kind === 'image')?.status, 'unsupported');
});

test('Wan keeps multimodal references native within its limits', () => {
  const result = projectProviderCapabilities({ engineId: 'wan-3.0', imageCount: 2, audioCount: 2, videoCount: 1 });
  assert.equal(result.canSubmit, true);
  assert.ok(result.items.every((item) => item.status === 'native'));
});
