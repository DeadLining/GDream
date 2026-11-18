import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

// tauri-build.mjs — packaging wrapper (see docs: 开源计划 06).
//
// Public builds overlay only tracked skill and memory resources, excluding
// ignored or untracked personal files. A private.defaults.json checkout keeps
// the existing opt-in personal resource overlay.

const root = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_RESOURCE_ROOTS = ['skills', 'aigc-memory'];
const PUBLIC_STATIC_RESOURCES = [
  '../scripts/render-worker.mjs',
  '../scripts/motion-runtime.js',
  '../dsh-runtime/**/*',
];

function runGit(args, options) {
  return spawnSync('git', args, options);
}

/**
 * Return only regular files that are both in Git's index and present as
 * regular files in the working tree. Git's index check prevents ignored and
 * untracked personal files from entering a public bundle; lstat prevents a
 * worktree symlink from redirecting a resource outside the repository.
 */
export function trackedPublicResources(rootDir = root, gitRunner = runGit) {
  const result = gitRunner(
    ['ls-files', '--cached', '--stage', '-z', '--', ...PUBLIC_RESOURCE_ROOTS],
    { cwd: rootDir, encoding: 'utf8' },
  );

  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
    const detail = result.error?.message || `git exited with status ${result.status}`;
    throw new Error(`[public] Unable to enumerate tracked resources: ${detail}`);
  }

  const resources = [];
  for (const record of result.stdout.split('\0')) {
    if (!record) continue;
    const separator = record.indexOf('\t');
    if (separator < 0) {
      throw new Error('[public] Unable to enumerate tracked resources: invalid git output');
    }

    const metadata = /^(\d{6}) [a-f0-9]{40,64} 0$/.exec(record.slice(0, separator));
    if (!metadata) {
      throw new Error('[public] Unable to enumerate tracked resources: invalid or unmerged git entry');
    }
    const mode = metadata[1];
    const relativePath = record.slice(separator + 1);
    // 100644 and 100755 are Git's regular-file modes. Ignore symlinks,
    // submodules, and any other non-regular index entries entirely.
    if (mode !== '100644' && mode !== '100755') continue;
    if (!PUBLIC_RESOURCE_ROOTS.some((name) => relativePath.startsWith(`${name}/`))) {
      throw new Error(`[public] Unable to enumerate tracked resources: invalid path ${relativePath}`);
    }
    if (isAbsolute(relativePath) || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`[public] Unable to enumerate tracked resources: invalid path ${relativePath}`);
    }

    const absolutePath = resolve(rootDir, relativePath);
    const withinRoot = relative(rootDir, absolutePath);
    if (withinRoot === '..' || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)) {
      throw new Error(`[public] Unable to enumerate tracked resources: path escapes repository ${relativePath}`);
    }

    let file;
    try {
      // Check ancestors too: lstat(file) alone follows symlinked directories.
      let current = resolve(rootDir);
      for (const segment of withinRoot.split(sep)) {
        current = join(current, segment);
        file = lstatSync(current);
        if (file.isSymbolicLink()) {
          throw new Error('resource path contains a symlink');
        }
      }
    } catch (error) {
      throw new Error(
        `[public] Unable to enumerate tracked resources: cannot inspect ${relativePath}: ${error.message}`,
      );
    }
    if (!file.isFile() || file.isSymbolicLink()) {
      throw new Error(`[public] Refusing non-regular public resource: ${relativePath}`);
    }
    resources.push(`../${relativePath}`);
  }

  return resources;
}

export function publicResourceOverlay(rootDir = root, gitRunner = runGit) {
  return {
    tauri: {
      bundle: {
        resources: [...trackedPublicResources(rootDir, gitRunner), ...PUBLIC_STATIC_RESOURCES],
      },
    },
  };
}

async function main() {
  // Keep prepare-private's existing side effect for real builds, but do not
  // execute it when this module is imported by focused tests.
  await import('./prepare-private.mjs');

  const isPrivate = existsSync(join(root, 'private.defaults.json'));
  const args = ['tauri', 'build'];
  if (isPrivate) {
    const resources = [
      '../AGENT.md',
      '../skills/**/*',
      '../aigc-memory/**/*',
      '../scripts/render-worker.mjs',
      '../scripts/motion-runtime.js',
      '../dsh-runtime/**/*',
      '../.local-browsers/**/*',
    ];
    // Tauri 1.x merges --config JSON over tauri.conf.json; arrays replace.
    args.push('--config', JSON.stringify({ tauri: { bundle: { resources } } }));
    console.log('[private] packaging WITH personal resources (AGENT.md et al.)');
  } else {
    args.push('--config', JSON.stringify(publicResourceOverlay()));
    console.log('[public] packaging tracked resources only');
  }

  const result = spawnSync('npx', args, { stdio: 'inherit', cwd: root, shell: false });
  if (result.error) console.error('[build] Unable to launch Tauri:', result.error.message);
  process.exit(result.status ?? 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
