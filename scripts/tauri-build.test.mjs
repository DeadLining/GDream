import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { publicResourceOverlay, trackedPublicResources } from './tauri-build.mjs';

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gdream-tauri-build-'));
  mkdirSync(join(root, 'skills'), { recursive: true });
  mkdirSync(join(root, 'aigc-memory'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), 'skills/ignored.md\n');
  writeFileSync(join(root, 'skills/tracked.md'), 'tracked');
  writeFileSync(join(root, 'skills/ignored.md'), 'ignored');
  writeFileSync(join(root, 'skills/untracked.md'), 'untracked');
  writeFileSync(join(root, 'aigc-memory/tracked.md'), 'tracked');
  git(root, ['init', '-q']);
  git(root, ['add', '--', 'skills/tracked.md', 'aigc-memory/tracked.md']);
  return root;
}

test('public resources include tracked regular files only', () => {
  const root = fixture();
  try {
    const resources = trackedPublicResources(root);

    assert.deepEqual(resources, ['../aigc-memory/tracked.md', '../skills/tracked.md']);
    assert.equal(resources.includes('../skills/ignored.md'), false);
    assert.equal(resources.includes('../skills/untracked.md'), false);

    const overlay = publicResourceOverlay(root);
    assert.deepEqual(overlay.tauri.bundle.resources, [
      '../aigc-memory/tracked.md',
      '../skills/tracked.md',
      '../scripts/render-worker.mjs',
      '../scripts/motion-runtime.js',
      '../dsh-runtime/**/*',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public resources omit tracked symlinks', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'outside.txt'), 'outside');
    symlinkSync(join(root, 'outside.txt'), join(root, 'skills/link.txt'));
    git(root, ['add', '--', 'skills/link.txt']);

    assert.deepEqual(trackedPublicResources(root), ['../aigc-memory/tracked.md', '../skills/tracked.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public resources reject symlinked parent directories', () => {
  const root = fixture();
  try {
    mkdirSync(join(root, 'private'));
    writeFileSync(join(root, 'private/tracked.md'), 'private');
    rmSync(join(root, 'skills'), { recursive: true });
    symlinkSync(join(root, 'private'), join(root, 'skills'), 'dir');
    assert.throws(() => trackedPublicResources(root), /resource path contains a symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public resources reject missing files, traversal and unmerged entries', () => {
  const root = fixture();
  try {
    rmSync(join(root, 'skills/tracked.md'));
    assert.throws(() => trackedPublicResources(root), /cannot inspect/);
    const entry = (path, stage = 0) => () => ({
      status: 0, stdout: `100644 ${'0'.repeat(40)} ${stage}\t${path}\0`,
    });
    assert.throws(() => trackedPublicResources(root, entry('skills/../../private.md')), /invalid path/);
    assert.throws(() => trackedPublicResources(root, entry('skills/tracked.md', 1)), /unmerged/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public resource enumeration fails closed when git cannot enumerate', () => {
  assert.throws(
    () => trackedPublicResources('/unused', () => ({ status: 128, stdout: '', error: new Error('not a repository') })),
    /Unable to enumerate tracked resources: not a repository/,
  );
});
