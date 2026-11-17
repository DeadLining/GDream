/** Render the actual generation page with local IPC fixtures; never submit media. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const chrome = process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browserFixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import StepGenerate from './src/components/workshop/steps/StepGenerate';
import { useWorkshopStore } from './src/stores/workshopStore';
import { useCanvasTaskStore } from './src/stores/canvasTaskStore';
import { emptyWorkshopData } from './src/lib/workshop/types';
const project = { id: 'ui-project', name: 'Progress test', sources: [], createdAt: 1, updatedAt: 1, stats: {}, status: 'draft' };
const data = emptyWorkshopData(project.id);
data.h3InputMode = 'ref2va';
data.videoModel = 'minimax-hailuo-h3';
data.videoRatio = '16:9';
data.currentStep = 'generate';
data.shots = [{ id: 'ui-shot', shotNo: '01-01', description: '声音修理店', sceneId: '', characterIds: [], genStatus: 'generating', genTaskId: 'ui-task' }];
const files = new Map([
  ['.gdream/aigc-memory/projects/ui-project/project.json', JSON.stringify(project)],
  ['.gdream/aigc-memory/projects/ui-project/workshop.json', JSON.stringify(data)],
]);
window.__TAURI_IPC__ = ({ callback, error, __tauriModule, message }) => {
  try {
    let result;
    if (__tauriModule === 'Path') result = '/fixture/';
    else if (__tauriModule === 'Fs') {
      if (message.cmd === 'exists') result = files.has(message.path);
      else if (message.cmd === 'readTextFile') result = files.get(message.path) || '[]';
      else if (message.cmd === 'writeFile') files.set(message.path, new TextDecoder().decode(new Uint8Array(message.contents)));
      else if (message.cmd === 'renameFile') { files.set(message.newPath, files.get(message.oldPath)); files.delete(message.oldPath); }
      else if (message.cmd !== 'createDir') throw new Error('Unexpected FS call: ' + message.cmd);
    } else if (__tauriModule === 'Event') result = 1;
    else throw new Error('Unexpected IPC: ' + __tauriModule);
    window['_' + callback](result);
  } catch (err) { window['_' + error](String(err)); }
};
useCanvasTaskStore.setState({ tasks: [{
  id: 'ui-task', projectId: project.id, workshopShotNo: '01-01', workshopShotKind: 'video',
  kind: 'video', nodeId: '', engineId: 'minimax-hailuo-h3', engineLabel: 'H3', endpoint: 'test', prompt: '',
  status: 'running', progress: 'SGLang 视频生成中… queued · 进度 0', rhTaskId: 'provider-ui',
  resultPaths: [], resultUrls: [], createdAt: 1, inFlight: true,
}] });
const root = createRoot(document.getElementById('root'));
window.progressTest = {
  async show() { await useWorkshopStore.getState().openProject(project.id); root.render(<StepGenerate />); },
  hide() { root.render(<div>其他页面</div>); },
  progress() { useCanvasTaskStore.getState().updateTask('ui-task', { progress: 'SGLang 视频生成中… processing · 进度 42' }); },
  eraseLink() { files.set('.gdream/aigc-memory/projects/ui-project/workshop.json', JSON.stringify({ ...data, shots: [{ ...data.shots[0], genStatus: 'idle', genTaskId: undefined }] })); },
  pendingTaskId() { return useWorkshopStore.getState().data.shots[0].genTaskId; },
};
window.progressTest.show();
`;

const bundle = await esbuild.build({
  stdin: { contents: browserFixture, resolveDir: repo, loader: 'tsx' },
  absWorkingDir: repo, bundle: true, write: false, platform: 'browser', format: 'iife',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  plugins: [{
    name: 'vite-fixture-assets',
    setup(build) {
      build.onResolve({ filter: /\?(raw|url|inline)$/ }, (args) => ({
        path: path.resolve(args.resolveDir, args.path.split('?')[0]), namespace: 'fixture-asset',
      }));
      build.onLoad({ filter: /.*/, namespace: 'fixture-asset' }, async (args) => ({
        contents: `export default ${JSON.stringify(await fs.readFile(args.path, 'utf8'))};`, loader: 'js',
      }));
    },
  }], logLevel: 'silent',
});
const assets = path.join(repo, 'dist/assets');
const cssName = (await fs.readdir(assets)).find((name) => /^main-.*\.css$/.test(name));
assert.ok(cssName, 'Run npm run build first');
const css = await fs.readFile(path.join(assets, cssName), 'utf8');
const server = http.createServer((req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(bundle.outputFiles[0].text); }
  else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<html><head><meta charset="utf-8"><style>${css}</style></head><body class="canvas-dark" style="background:#111"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.error('UI error:', error.message); });
  page.on('console', (message) => { if (message.type() === 'error') console.error('UI console:', message.text()); });
  page.setDefaultTimeout(10_000);
  await page.setRequestInterception(true);
  page.on('request', (request) => request.url().startsWith('http://127.0.0.1:') ? request.continue() : request.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector('[data-shot-no="01-01"]')?.textContent.includes('queued · 进度 0'));
  await page.evaluate(() => window.progressTest.hide());
  await page.waitForFunction(() => document.body.textContent.includes('其他页面'));
  await page.evaluate(() => { window.progressTest.progress(); window.progressTest.eraseLink(); });
  await page.evaluate(() => window.progressTest.show());
  await page.waitForFunction(() => document.querySelector('[data-shot-no="01-01"]')?.textContent.includes('processing · 进度 42'));
  assert.equal(await page.evaluate(() => window.progressTest.pendingTaskId()), 'ui-task');
  assert.ok(await page.$eval('[data-shot-no="01-01"]', (card) => [...card.querySelectorAll('button')].some((button) => button.textContent.includes('取消'))));
  assert.deepEqual(errors, []);
  const screenshot = path.join(repo, 'scripts/pipeline-probe/.gen/generation-progress-return.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(`PASS: actual card remount shows live progress and Cancel; screenshot: ${screenshot}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
