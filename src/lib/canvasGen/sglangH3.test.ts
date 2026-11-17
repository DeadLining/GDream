import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSglangH3Payload,
  buildSglangH3Conditions,
  buildSglangH3ConditionsForTask,
  extractSglangH3Status,
  extractSglangH3TaskId,
  extractSglangH3ResultUrl,
  extractSglangH3Phase,
  extractSglangH3Progress,
  extractSglangH3RequestId,
  resolveSglangH3ResourceUrl,
  normalizeSglangH3PromptReferences,
  prepareSglangH3PromptForTask,
  SGLANG_H3_POLL_INTERVAL_MS,
  sglangH3TaskUsesBoundaryFrames,
  sglangH3TaskUsesReferenceAssets,
  sglangH3TaskIsSupported,
  sglangH3ApiTask,
} from './sglangH3.ts';

test('polls SGLang MiniMax-H3 tasks every ten seconds', () => {
  assert.equal(SGLANG_H3_POLL_INTERVAL_MS, 10_000);
});

test('distinguishes required boundary-frame modes from reference-asset mode', () => {
  assert.equal(sglangH3TaskUsesBoundaryFrames('fl2va'), true);
  assert.equal(sglangH3TaskUsesBoundaryFrames('ref2va'), false);
  assert.equal(sglangH3TaskUsesReferenceAssets('ref2va'), true);
  assert.equal(sglangH3TaskUsesReferenceAssets('t2va'), false);
});

test('matches the deployed SGLang task contract', () => {
  assert.equal(sglangH3TaskIsSupported('i2va'), true);
  assert.equal(sglangH3TaskIsSupported('fl2va'), true);
  assert.equal(sglangH3TaskIsSupported('ref2va'), true);
  assert.equal(sglangH3TaskIsSupported('t2va'), true);
});

test('maps single endpoint frames to the fl2va API task', () => {
  assert.equal(sglangH3ApiTask('i2va'), 'fl2va');
  assert.doesNotThrow(() => buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: 'continue from the first frame',
    conditions: [{ type: 'image', uri: 'file:///first.png', role: 'keyframe', frame_index: 0 }],
    durationSeconds: 5,
    task: sglangH3ApiTask('i2va'),
  }));
  assert.deepEqual(buildSglangH3ConditionsForTask({
    task: 'i2va',
    boundaryFrameUris: ['file:///first.png'],
  }), [{ type: 'image', uri: 'file:///first.png', role: 'keyframe', frame_index: 0 }]);
});

test('converts internal media mentions to MiniMax multimodal tags', () => {
  assert.equal(
    normalizeSglangH3PromptReferences('结合@图片一、@图片十二、@音频2和@视频三，并承接 <Picture 4>（@图片四）。'),
    '结合<Picture 1>、<Picture 12>、<Audio 2>和<Video 3>，并承接 <Picture 4>。',
  );
});

test('builds the strict SGLang MiniMax-H3 ref2va JSON payload', () => {
  assert.deepEqual(buildSglangH3Payload({
    model: 'MiniMax-H3',
    prompt: 'Use <Picture 1> as the visual subject and style reference.',
    conditions: [{ type: 'image', uri: 'file:///tmp/reference.png', role: 'reference' }],
    task: 'ref2va',
    durationSeconds: 5,
  }), {
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: 'Use <Picture 1> as the visual subject and style reference.',
    seconds: 5,
    task: 'ref2va',
    conditions: [{ type: 'image', uri: 'file:///tmp/reference.png', role: 'reference' }],
    target: { short_edge: 768, aspect_ratio: 'auto', duration_seconds: 5 },
    quality: 'lossless',
    num_outputs_per_prompt: 1,
    num_inference_steps: 8,
    flow_shift: 12,
    audio_flow_shift: 3,
    seed: 3104,
  });
});

test('keeps only supported fields and accepts user overrides', () => {
  const payload = buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: 'test',
    conditions: [{ type: 'image', uri: 'data:image/png;base64,AA==', role: 'reference' }],
    task: 'ref2va',
    durationSeconds: 8,
    shortEdge: '1024',
    aspectRatio: '16:9',
    quality: 'balanced',
    numOutputsPerPrompt: '2',
    numInferenceSteps: '36',
    flowShift: '0',
    audioFlowShift: '1.5',
    seed: '0',
  });

  assert.deepEqual(Object.keys(payload), [
    'model', 'prompt', 'seconds', 'task', 'conditions', 'target', 'quality',
    'num_outputs_per_prompt', 'num_inference_steps', 'flow_shift', 'audio_flow_shift', 'seed',
  ]);
  assert.equal(payload.flow_shift, 0);
  assert.equal(payload.audio_flow_shift, 1.5);
  assert.equal(payload.seed, 0);
});

test('preserves an explicit SGLang task override', () => {
  const payload = buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: 'test',
    conditions: [{ type: 'image', uri: 'data:image/png;base64,AA==', role: 'reference' }],
    durationSeconds: 5,
    task: 'ref2va',
  });
  assert.equal(payload.task, 'ref2va');
});

test('normalizes prompt references in the submitted payload', () => {
  const payload = buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: '让@图片一中的人物走向@图片2中的柜台。',
    conditions: [
      { type: 'image', uri: 'data:image/png;base64,AA==', role: 'reference' },
      { type: 'image', uri: 'data:image/png;base64,AQ==', role: 'reference' },
    ],
    durationSeconds: 5,
    task: 'ref2va',
  });
  assert.equal(payload.prompt, '让<Picture 1>中的人物走向<Picture 2>中的柜台。');
});

test('preserves complete long-form H3 prompts without silent truncation', () => {
  const prompt = `开场状态。${'时间轴动作、空间关系、对白与连续性约束。'.repeat(900)}尾帧必须完成核心动作。`;
  assert.ok(prompt.length > 12_000);
  const payload = buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt,
    conditions: [],
    durationSeconds: 6,
    task: 't2va',
  });
  assert.equal(payload.prompt, prompt);
  assert.match(String(payload.prompt), /尾帧必须完成核心动作。$/);
});

test('preserves image, audio, and video condition order', () => {
  const payload = buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: 'Combine all references.',
    conditions: [
      { type: 'image', uri: 'data:image/png;base64,AA==', role: 'reference' },
      { type: 'image', uri: 'data:image/png;base64,AQ==', role: 'reference' },
      { type: 'audio', uri: 'data:audio/mpeg;base64,Ag==', role: 'reference' },
      { type: 'audio', uri: 'data:audio/mpeg;base64,Aw==', role: 'reference' },
      { type: 'video', uri: 'data:video/mp4;base64,BA==', role: 'reference', start_time_seconds: 0 },
      { type: 'video', uri: 'data:video/mp4;base64,BQ==', role: 'reference', start_time_seconds: 0 },
    ],
    durationSeconds: 5,
    task: 'ref2va',
  });

  assert.deepEqual(payload.conditions, [
    { type: 'image', uri: 'data:image/png;base64,AA==', role: 'reference' },
    { type: 'image', uri: 'data:image/png;base64,AQ==', role: 'reference' },
    { type: 'audio', uri: 'data:audio/mpeg;base64,Ag==', role: 'reference' },
    { type: 'audio', uri: 'data:audio/mpeg;base64,Aw==', role: 'reference' },
    { type: 'video', uri: 'data:video/mp4;base64,BA==', role: 'reference', start_time_seconds: 0 },
    { type: 'video', uri: 'data:video/mp4;base64,BQ==', role: 'reference', start_time_seconds: 0 },
  ]);
});

test('removes unavailable media references from fl2va and t2va prompts', () => {
  const source = '从@图片一的起点自然走向<Picture 2>的终点，保留@音频一的节奏。';
  assert.doesNotMatch(prepareSglangH3PromptForTask(source, 'fl2va'), /@|<Picture|<Audio/);
  assert.doesNotMatch(prepareSglangH3PromptForTask(source, 't2va'), /@|<Picture|<Audio/);
  assert.equal(prepareSglangH3PromptForTask(source, 'ref2va'), '从<Picture 1>的起点自然走向<Picture 2>的终点，保留<Audio 1>的节奏。');
});

test('selects only endpoint keyframes for fl2va', () => {
  assert.deepEqual(buildSglangH3ConditionsForTask({
    task: 'fl2va',
    boundaryFrameUris: ['data:image/png;base64,start', 'data:image/png;base64,end'],
    imageUris: ['data:image/png;base64/asset-1', 'data:image/png;base64/asset-2'],
  }), [
    { type: 'image', uri: 'data:image/png;base64,start', role: 'keyframe', frame_index: 0 },
    { type: 'image', uri: 'data:image/png;base64,end', role: 'keyframe', frame_index: -1 },
  ]);
});

test('selects reference assets for ref2va and no conditions for t2va', () => {
  const input = {
    imageUris: ['data:image/png;base64/asset-1'],
    audioUris: ['data:audio/mpeg;base64/audio-1'],
    videoUris: ['data:video/mp4;base64/video-1'],
    boundaryFrameUris: ['data:image/png;base64/start', 'data:image/png;base64/end'],
  };
  assert.equal(buildSglangH3ConditionsForTask({ task: 'ref2va', ...input }).length, 5);
  assert.deepEqual(buildSglangH3ConditionsForTask({ task: 't2va', ...input }), []);
});

test('allows an empty condition list only for t2va payloads', () => {
  assert.doesNotThrow(() => buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: '纯文本生成',
    conditions: [],
    durationSeconds: 5,
    task: 't2va',
  }));
  assert.throws(() => buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: '需要参考图',
    conditions: [],
    durationSeconds: 5,
    task: 'fl2va',
  }), /首帧.*尾帧/);
});

test('builds H3 conditions from every resolved asset and ignores blank entries', () => {
  const conditions = buildSglangH3Conditions({
    imageUris: [' data:image/png;base64,image-1 ', '', 'data:image/png;base64,image-2'],
    audioUris: ['data:audio/mpeg;base64,audio-1'],
    videoUris: [' data:video/mp4;base64,video-1 '],
  });
  assert.deepEqual(conditions, [
    { type: 'image', uri: 'data:image/png;base64,image-1', role: 'reference' },
    { type: 'image', uri: 'data:image/png;base64,image-2', role: 'reference' },
    { type: 'audio', uri: 'data:audio/mpeg;base64,audio-1', role: 'reference' },
    { type: 'video', uri: 'data:video/mp4;base64,video-1', role: 'reference', start_time_seconds: 0 },
  ]);
});

test('preserves duplicate reference images so prompt indexes stay aligned', () => {
  const repeated = { type: 'image' as const, uri: 'data:image/png;base64,AA==', role: 'reference' as const };
  const payload = buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: 'Combine <Picture 1> and <Picture 2>.',
    conditions: [repeated, { ...repeated }],
    durationSeconds: 5,
    task: 'ref2va',
  });
  assert.equal((payload.conditions as unknown[]).length, 2);
  assert.equal(payload.prompt, 'Combine <Picture 1> and <Picture 2>.');
});

test('rejects H3 requests without reference conditions', () => {
  assert.throws(() => buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: 'test',
    conditions: [],
    durationSeconds: 5,
    task: 'ref2va',
  }), /ref2va 必须至少指定一个参考素材/);
});

test('requires an ordered first keyframe and optional last keyframe for fl2va', () => {
  assert.doesNotThrow(() => buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: 'continue',
    conditions: [{ type: 'image', uri: 'data:image/png;base64,AA==', role: 'keyframe', frame_index: 0 }],
    durationSeconds: 5,
    task: 'fl2va',
  }));
  assert.throws(() => buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: 'continue',
    conditions: [
      { type: 'image', uri: 'data:image/png;base64,AA==', role: 'keyframe', frame_index: -1 },
      { type: 'image', uri: 'data:image/png;base64,AQ==', role: 'keyframe', frame_index: 0 },
    ],
    durationSeconds: 5,
    task: 'fl2va',
  }), /首帧.*尾帧/);
  assert.doesNotThrow(() => buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: 'continue',
    conditions: [
      { type: 'image', uri: 'data:image/png;base64,AA==', role: 'keyframe', frame_index: 0 },
      { type: 'image', uri: 'data:image/png;base64,AQ==', role: 'keyframe', frame_index: -1 },
    ],
    durationSeconds: 5,
    task: 'fl2va',
  }));
});

test('rejects task-incompatible condition roles', () => {
  assert.throws(() => buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: 'reference',
    conditions: [{ type: 'image', uri: 'data:image/png;base64,AA==', role: 'keyframe', frame_index: 0 }],
    durationSeconds: 5,
    task: 'ref2va',
  }), /至少指定一个参考素材/);
  assert.throws(() => buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: 'text only',
    conditions: [{ type: 'image', uri: 'data:image/png;base64,AA==', role: 'reference' }],
    durationSeconds: 5,
    task: 't2va',
  }), /不得提交/);
});

test('rejects H3 requests beyond MiniMax H3 modality limits', () => {
  assert.throws(() => buildSglangH3Payload({
    model: 'MiniMaxAI/MiniMax-H3',
    prompt: 'test',
    conditions: Array.from({ length: 10 }, (_, index) => ({
      type: 'image' as const,
      uri: `file:///tmp/${index}.png`,
      role: 'reference' as const,
    })),
    durationSeconds: 5,
    task: 'ref2va',
  }), /image.*最多 9/);
});

test('extracts nested SGLang result URLs from completed responses', () => {
  assert.equal(extractSglangH3ResultUrl({ content: { url: 'https://example.test/a.mp4' } }), 'https://example.test/a.mp4');
  assert.equal(extractSglangH3ResultUrl({ data: { result: { video_url: 'https://example.test/b.mp4' } } }), 'https://example.test/b.mp4');
  assert.equal(extractSglangH3ResultUrl({ result: { download_url: 'https://example.test/c.mp4' } }), 'https://example.test/c.mp4');
  assert.equal(extractSglangH3ResultUrl({ status: 'running' }), '');
});

test('extracts nested task ids, statuses, and result URLs', () => {
  const response = {
    data: {
      task: {
        id: 'task-42',
        status: 'COMPLETED',
        content: { url: '/outputs/task-42.mp4' },
      },
    },
  };
  assert.equal(extractSglangH3TaskId(response), 'task-42');
  assert.equal(extractSglangH3Status(response), 'completed');
  assert.equal(extractSglangH3ResultUrl(response), '/outputs/task-42.mp4');
});

test('extracts provider phase, raw progress, and request id', () => {
  const response = { data: { task: { phase: 'denoise', progress: 42, request_id: 'req-7' } } };
  assert.equal(extractSglangH3Phase(response), 'denoise');
  assert.equal(extractSglangH3Progress(response), 42);
  assert.equal(extractSglangH3RequestId(response), 'req-7');
});

test('resolves relative SGLang result paths against the configured endpoint', () => {
  assert.equal(resolveSglangH3ResourceUrl('http://127.0.0.1:7863', '/outputs/a.mp4'), 'http://127.0.0.1:7863/outputs/a.mp4');
  assert.equal(resolveSglangH3ResourceUrl('http://127.0.0.1:7863/', 'outputs/b.mp4'), 'http://127.0.0.1:7863/outputs/b.mp4');
  assert.equal(resolveSglangH3ResourceUrl('http://127.0.0.1:7863', 'https://cdn.test/c.mp4'), 'https://cdn.test/c.mp4');
});


test('ref2va retains scene-first Picture order while anchoring the inherited fourth image at frame zero', () => {
  const images = ['scene', 'suhe', 'chenyu', 'accepted-tail'];
  const conditions = buildSglangH3ConditionsForTask({
    task: 'ref2va', imageUris: images, boundaryFrameUris: ['accepted-tail'],
  });
  assert.deepEqual(conditions.filter(c => c.role === 'reference').map(c => c.uri), images);
  assert.deepEqual(conditions.filter(c => c.role === 'keyframe'), [
    { type: 'image', uri: 'accepted-tail', role: 'keyframe', frame_index: 0 },
  ]);
  const payload = buildSglangH3Payload({
    model: 'MiniMax-H3', task: 'ref2va', durationSeconds: 4,
    prompt: 'Open on <Picture 4>; <Picture 1> defines the room.', conditions,
  });
  assert.equal(payload.prompt, 'Open on <Picture 4>; <Picture 1> defines the room.');
  assert.deepEqual(payload.conditions, conditions);
});

test('ref2va never turns the first scene reference into an implicit opening frame', () => {
  const conditions = buildSglangH3ConditionsForTask({ task: 'ref2va', imageUris: ['scene', 'character'] });
  assert.ok(conditions.every(c => c.role === 'reference'));
});

test('ref2va rejects invalid anchor signatures and references with keyframe indices', () => {
  const reference = { type: 'image' as const, role: 'reference' as const, uri: 'scene' };
  const anchor = { type: 'image' as const, role: 'keyframe' as const, uri: 'tail', frame_index: 0 };
  const build = (conditions: Parameters<typeof buildSglangH3Payload>[0]['conditions']) =>
    buildSglangH3Payload({ model: 'MiniMax-H3', task: 'ref2va', prompt: 'action', durationSeconds: 4, conditions });
  assert.throws(() => build([anchor]), /至少指定一个参考素材/);
  assert.throws(() => build([reference, anchor, anchor]), /关键帧/);
  assert.throws(() => build([reference, { ...anchor, type: 'audio' }]), /关键帧/);
  assert.throws(() => build([{ ...reference, frame_index: 0 }]), /不能携带/);
});
