/** Project navigation regression using real stores and isolated files. No paid submissions. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installShims } from './preload.mjs';

installShims();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gdream-generation-restore-'));
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls++;
  throw new Error('Network forbidden');
};
window.crypto = globalThis.crypto;
window.__TAURI_IPC__ = async ({ callback, error, __tauriModule, message }) => {
  try {
    const resolve = (name) => {
      const target = path.resolve(root, name);
      assert.ok(target.startsWith(root + path.sep));
      return target;
    };
    if (__tauriModule === 'Path') {
      window[`_${callback}`](root + path.sep);
      return;
    }
    if (__tauriModule === 'Http') networkCalls++;
    assert.equal(__tauriModule, 'Fs');
    let result;
    if (message.cmd === 'exists') result = await fs.access(resolve(message.path)).then(() => true, () => false);
    else if (message.cmd === 'createDir') await fs.mkdir(resolve(message.path), { recursive: true });
    else if (message.cmd === 'readTextFile') result = await fs.readFile(resolve(message.path), 'utf8');
    else if (message.cmd === 'writeFile') await fs.writeFile(resolve(message.path), Buffer.from(message.contents));
    else if (message.cmd === 'renameFile') await fs.rename(resolve(message.oldPath), resolve(message.newPath));
    else throw new Error(`Unexpected IPC: ${message.cmd}`);
    window[`_${callback}`](result);
  } catch (err) {
    window[`_${error}`](String(err));
  }
};

const h = await import('./.gen/harness.mjs');
const store = h.useWorkshopStore;
const tasks = h.useCanvasTaskStore;
const shot = () => store.getState().data.shots[0];

async function seed(id, extra = {}) {
  const project = {
    id, name: id, slug: id, sources: [], createdAt: 1, updatedAt: 1,
    status: 'draft', videoEngine: 'rhtv', stats: { shots: 1, scenes: 0, assets: 0, videosCompleted: 0 },
  };
  const data = h.emptyWorkshopData(id);
  data.shots = [{ id: `shot-${id}`, shotNo: '01-01', sceneId: '', characterIds: [], description: '', ...extra }];
  const dir = path.join(root, '.gdream/aigc-memory/projects', id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project));
  await fs.writeFile(path.join(dir, 'workshop.json'), JSON.stringify(data));
}

try {
  await seed('project-A', { genStatus: 'generating', genTaskId: 'task-A', generationToken: 'attempt-A' });
  await seed('project-B');
  tasks.setState({ tasks: [{
    id: 'task-A', projectId: 'project-A', workshopShotNo: '01-01', workshopShotKind: 'video',
    nodeId: '', kind: 'video', engineId: 'minimax-hailuo-h3', engineLabel: 'H3', endpoint: 'test', prompt: '',
    status: 'running', progress: 'SGLang 视频生成中… queued · 进度 0',
    rhTaskId: 'provider-A', resultPaths: [], resultUrls: [], createdAt: 1, inFlight: true,
  }] });

  await store.getState().openProject('project-A');
  assert.equal(shot().genStatus, 'generating', 'opening must not erase a live generation');
  assert.equal(shot().genTaskId, 'task-A');
  assert.match(shot().genProgress, /queued/);
  store.getState().setCurrentStep('prompts');
  store.getState().setCurrentStep('generate');
  assert.equal(shot().genTaskId, 'task-A', 'step navigation retains ownership');

  await store.getState().openProject('project-B');
  assert.equal(shot().genTaskId, undefined, 'same shot number in another project must stay untouched');
  await store.getState().openProject('project-A');
  assert.equal(shot().genStatus, 'generating', 'returning from another project restores the spinner');
  assert.equal(shot().genTaskId, 'task-A');

  store.getState().updateShot('01-01', { genStatus: 'idle', genTaskId: undefined, genProgress: undefined });
  await store.getState().commitNow();
  tasks.getState().updateTask('task-A', { progress: 'SGLang 视频生成中… processing · 进度 42' });
  await store.getState().reloadCurrent();
  assert.equal(shot().genTaskId, 'task-A', 'repair previously erased task links from the global queue');
  assert.match(shot().genProgress, /42/);

  await store.getState().generateShot('01-01', 'video');
  assert.equal(tasks.getState().tasks.length, 1, 'clicking again must not create another paid task');
  assert.equal(shot().genStatus, 'generating', 'duplicate prevention must preserve the original progress');

  tasks.getState().updateTask('task-A', { status: 'failed', error: 'provider failed', inFlight: false });
  await store.getState().reloadCurrent();
  assert.equal(shot().genStatus, 'failed', 'a failed task must not leave a stale spinner');
  assert.equal(shot().genError, 'provider failed');
  const oldImage = path.join(root, 'old.png');
  await fs.writeFile(oldImage, 'old frame');
  store.getState().updateShot('01-01', { imagePath: oldImage });
  await store.getState().commitNow();
  await store.getState().openProject('project-A');
  assert.equal(shot().genStatus, 'failed', 'an old frame cannot conceal a real video failure');
  assert.equal(shot().genError, 'provider failed');

  tasks.getState().updateTask('task-A', { status: 'running', error: undefined, inFlight: true });
  store.getState().updateShot('01-01', { genStatus: 'generating', genTaskId: 'task-A' });
  await store.getState().commitNow();
  const commitNow = store.getState().commitNow;
  let cancellationSave;
  store.setState({ commitNow: () => (cancellationSave = commitNow()) });
  store.getState().cancelShot('01-01');
  await cancellationSave;
  store.setState({ commitNow });
  await store.getState().openProject('project-A');
  assert.equal(shot().genStatus, 'idle', 'an explicitly cancelled task must not reappear');
  assert.equal(shot().genTaskId, undefined);
  assert.equal(networkCalls, 0);
  console.log('PASS: reopen, step navigation, cross-project isolation, lost-link repair, duplicate prevention, failure, cancellation; zero network requests');
} finally {
  store.setState({ project: null, data: null });
  tasks.setState({ tasks: [] });
  await fs.rm(root, { recursive: true, force: true });
}
