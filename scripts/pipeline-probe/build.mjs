/**
 * 把仓库里真实的纯逻辑模块打包成可在 Node 下直接 import 的 ESM bundle。
 *
 * 目的：让「模块化流水线测试」用到的提示词、工具 schema、校验器
 * 与桌面应用运行时完全同源，避免手写副本导致测出来的结论不算数。
 *
 * 需要处理 Vite 特有的 `?raw` / `?url` 导入（esbuild 原生不认识）。
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const outfile = path.join(here, '.gen/harness.mjs');

/** 让 `import x from './foo.js?raw'` 变成文件内容字符串。 */
const viteQueryPlugin = {
  name: 'vite-query-suffix',
  setup(build) {
    build.onResolve({ filter: /\?(raw|url|inline)$/ }, (args) => {
      const [p, query] = args.path.split('?');
      const resolved = path.resolve(args.resolveDir, p);
      return { path: `${resolved}?${query}`, namespace: 'vite-query' };
    });
    build.onLoad({ filter: /.*/, namespace: 'vite-query' }, (args) => {
      const [file, query] = args.path.split('?');
      if (!fs.existsSync(file)) return { errors: [{ text: `文件不存在: ${file}` }] };
      const content = fs.readFileSync(file, 'utf8');
      if (query === 'raw') return { contents: `export default ${JSON.stringify(content)};`, loader: 'js' };
      // ?url 在 Node 语境下没有意义，退化成路径字符串
      return { contents: `export default ${JSON.stringify(file)};`, loader: 'js' };
    });
  },
};

/**
 * html2canvas 在模块求值阶段就会访问真实 DOM（创建 <a> 元素），Node 下必崩。
 * 它只被默认导入，因此单独桩掉即可；其余浏览器库交给 preload.mjs 的全局垫片。
 */
const BROWSER_ONLY = ['html2canvas'];

const stubPlugin = {
  name: 'browser-only-stub',
  setup(build) {
    const filter = new RegExp(`^(${BROWSER_ONLY.map((n) => n.replace(/[/@.]/g, '\\$&')).join('|')})$`);
    build.onResolve({ filter }, (args) => ({ path: args.path, namespace: 'browser-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'browser-stub' }, () => ({
      contents: STUB_SOURCE,
      loader: 'js',
    }));
  },
};

const STUB_SOURCE = `
const stub = new Proxy(function () {}, {
  get: () => stub,
  apply: () => stub,
  construct: () => stub,
});
export default stub;
export const noop = stub;
`;

fs.mkdirSync(path.dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(here, 'entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile,
  external: ['@tauri-apps/*'],
  plugins: [viteQueryPlugin, stubPlugin],
  logLevel: 'warning',
  absWorkingDir: repo,
});

const kb = (fs.statSync(outfile).size / 1024).toFixed(0);
console.log(`✓ 已生成 ${path.relative(repo, outfile)} (${kb} KB)`);
