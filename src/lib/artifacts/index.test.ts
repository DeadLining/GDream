import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

async function loadIndex(manifestExists: boolean, image = '/test-home/.gdream/outputs/frame.png') {
  const calls = { exists: [] as string[], reads: [] as string[], scans: [] as string[] };
  const fixture = {
    exists: async (path: string) => { calls.exists.push(path); return manifestExists; },
    readTextFile: async (path: string) => {
      calls.reads.push(path);
      return JSON.stringify({ entries: [{ path: image, type: 'image', size: 0, createdAt: 10, prompt: 'keep metadata' }] });
    },
    invoke: async (_command: string, options: { path: string }) => {
      calls.scans.push(options.path);
      return image.startsWith(`${options.path}/`) ? [{ path: image, size: 128, mtime_ms: 20 }] : [];
    },
  };
  const key = `__artifactTest${Math.random().toString(36).slice(2)}`;
  (globalThis as Record<string, unknown>)[key] = fixture;
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./index.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'tauri-fixture', setup(builder) {
      builder.onResolve({ filter: /^@tauri-apps\/api\// }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        const fixture = globalThis[${JSON.stringify(key)}];
        export const BaseDirectory = { Home: 1 };
        export const exists = fixture.exists;
        export const readTextFile = fixture.readTextFile;
        export const invoke = fixture.invoke;
        export const homeDir = async () => '/test-home/';
        export const writeTextFile = async () => {};
      ` }));
    } }],
  });
  const index = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  return { index, calls, image, dispose: () => { delete (globalThis as Record<string, unknown>)[key]; } };
}

test('asset listing reads only the current manifest and scans the four GDream roots', async () => {
  const fixture = await loadIndex(false);
  try {
    const entries = await fixture.index.listArtifacts();
    assert.deepEqual(fixture.calls.exists, ['.gdream/artifacts-manifest.json']);
    assert.deepEqual(fixture.calls.reads, []);
    assert.deepEqual(fixture.calls.scans, ['workspace', 'projects', 'aigc-memory', 'outputs'].map(dir => `/test-home/.gdream/${dir}`));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].path, fixture.image);
  } finally { fixture.dispose(); }
});

test('asset listing preserves manifest metadata and fills file size without duplicating output', async () => {
  const fixture = await loadIndex(true);
  try {
    const entries = await fixture.index.listArtifacts();
    assert.deepEqual(fixture.calls.reads, ['.gdream/artifacts-manifest.json']);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].prompt, 'keep metadata');
    assert.equal(entries[0].size, 128);
    assert.equal(entries[0].createdAt, 10);
  } finally { fixture.dispose(); }
});

test('asset listing associates scanned workshop media with the current project', async () => {
  const fixture = await loadIndex(false, '/test-home/.gdream/aigc-memory/projects/project-1/assets/frame.png');
  try {
    const entries = await fixture.index.listArtifacts();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].projectId, 'project-1');
    assert.equal(entries[0].scanned, true);
  } finally { fixture.dispose(); }
});
