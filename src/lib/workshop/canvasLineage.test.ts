import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { emptyWorkshopData } from './types.ts';
import * as provenance from './mediaProvenance.ts';
import * as policy from './liveCanvasPolicy.ts';
const ts = createRequire(import.meta.url)('typescript');

async function fixture(recorded = true) {
  const data = emptyWorkshopData('p');
  data.canvasProjectId = 'canvas';
  data.shots = [
    { shotNo: '01-03', description: '', characterIds: [], videoPath: '/03.mp4',
      acceptedVideoTail: { videoPath: '/03.mp4', framePath: '/03-tail-frame.png', extractionId: 'extract-03' } },
    { shotNo: '01-04', description: '', characterIds: [], videoPath: '/04.mp4',
      videoCandidates: [{ path: '/04.mp4', createdAt: 1, source: 'generate', productionPacket: {
        referencePaths: recorded ? ['/scene.png', '/03-tail-frame.png'] : ['/scene.png'],
        referenceLabels: ['场景', '上一镜尾帧（跨镜连续性）'], prompt: 'submitted',
      } as any }] },
  ];
  const original = { id: 'existing-tail', type: 'image', position: { x: 1900, y: 123 }, data: {
    localPath: '/03-tail-frame.png', lineageManaged: true, lineageLabel: '生成输入尾帧',
    workshopRef: { projectId: 'p', kind: 'shot', id: 'tail', role: 'prompt-reference' },
  } };
  const store: any = { nodes: [original], edges: [], setNodes(nodes: any) { this.nodes = nodes; },
    setEdges(edges: any) { this.edges = edges; } };
  let saves = 0;
  const modules: Record<string, any> = {
    './mediaProvenance': provenance, './liveCanvasPolicy': policy,
    '@tauri-apps/api/tauri': { convertFileSrc: (p: string) => p },
    '@tauri-apps/api/fs': { exists: async () => false, BaseDirectory: { Home: 1 } }, '@tauri-apps/api/path': {},
    '@/stores/canvasStore': { useCanvasStore: { getState: () => store } },
    '@/stores/workshopStore': { useWorkshopStore: { getState: () => ({ project: { id: 'p' }, data }) } },
    '@/stores/projectStore': { useProjectStore: { getState: () => ({ activeProjectId: 'canvas', switching: false,
      flushActiveCanvas: async () => { saves++; } }) } },
    '@/lib/canvas/grouping': {}, '@/lib/canvas/layout': { defaultNodeStyle: () => ({ width: 320 }) },
    '@/lib/workshop/shotRefs': { buildImageRefBindings: () => [], buildVideoRefBindings: () => [] },
    '@/lib/workshop/productionLifecycle': {},
  };
  const compiled = ts.transpileModule(readFileSync(new URL('./canvasSync.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  runInNewContext(compiled, { exports, require: (id: string) => { assert.ok(modules[id], id); return modules[id]; } });
  const sync = () => exports.syncWorkshopLineageToCanvas();
  await sync();
  return { store, data, sync, saves: () => saves };
}

test('saved tail input restores extraction-to-reference chain without duplicates across syncs', async () => {
  const { store, sync, saves } = await fixture();
  for (let i = 0; i < 2; i++) {
    const tails = store.nodes.filter((n: any) => n.data.localPath === '/03-tail-frame.png');
    assert.equal(tails.length, 1);
    assert.equal(tails[0].id, 'existing-tail');
    assert.equal(tails[0].position.x, 1900);
    const video = (path: string) => store.nodes.find((n: any) => n.data.localPath === path);
    assert.ok(store.edges.some((e: any) => e.source === video('/03.mp4').id && e.target === tails[0].id));
    assert.ok(store.edges.some((e: any) => e.source === tails[0].id && e.target === video('/04.mp4').id));
    await sync();
  }
  assert.equal(saves(), 3);
});

test('a tail that was not submitted is not connected to the next video', async () => {
  const { store } = await fixture(false);
  const next = store.nodes.find((n: any) => n.data.localPath === '/04.mp4');
  assert.ok(!store.edges.some((e: any) => e.source === 'existing-tail' && e.target === next.id));
});


test('unadopted latest candidate replaces stale canvas media and uses its own frozen references', async () => {
  const { store, data, sync } = await fixture();
  const shot = data.shots[1];
  shot.videoPath = undefined;
  shot.videoCandidates!.push({ ...shot.videoCandidates![0], path: '/05.mp4', createdAt: 5,
    productionPacket: { ...shot.videoCandidates![0].productionPacket!, prompt: 'candidate five' } });
  await sync();
  const node = store.nodes.find((n: any) => n.data.workshopRef?.role === 'shot-video' && n.data.workshopRef.id === '01-04');
  assert.equal(node.data.localPath, '/05.mp4');
  assert.equal(node.data.adoptedVersionPath, undefined);
  assert.equal(node.data.description, 'candidate five');
  assert.ok(store.edges.some((e: any) => e.source === 'existing-tail' && e.target === node.id));
  assert.equal(shot.videoPath, undefined);
  shot.videoPath = '/04.mp4';
  await sync();
  const adopted = store.nodes.find((n: any) => n.id === node.id);
  assert.equal(adopted.data.localPath, '/04.mp4');
  assert.equal(adopted.data.description, 'submitted');
});
