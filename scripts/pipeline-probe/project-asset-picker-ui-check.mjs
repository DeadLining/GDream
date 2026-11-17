/** Actual generation UI, in-memory project files, and no provider requests. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const chrome = process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import StepGenerate from './src/components/workshop/steps/StepGenerate';
import { useWorkshopStore } from './src/stores/workshopStore';
import { emptyWorkshopData } from './src/lib/workshop/types';
window.__TAURI__ = { convertFileSrc: (file) => location.origin + '/images/' + encodeURIComponent(file.split('/').pop()) };
const project = { id: 'asset-picker-ui', name: '项目资产测试', sources: [], createdAt: 1, updatedAt: 1, stats: {}, status: 'draft' };
const data = emptyWorkshopData(project.id);
Object.assign(data, {
  h3InputMode: 'ref2va', videoModel: 'minimax-hailuo-h3', videoRatio: '16:9', currentStep: 'generate', videoPromptTemplate: 'universal',
  characters: [
    { id: 'suhe', name: '苏禾', personality: '', appearance: '', assetImagePath: '/fixture/suhe.png' },
    { id: 'chenyu', name: '陈宇', personality: '', appearance: '', assetImagePath: '/fixture/chenyu.png' },
  ],
  scenes: [{ id: 'studio', name: '日间工作室', description: '', assetImagePath: '/fixture/studio.png' }],
  props: [{ id: 'draft', name: '设计手稿', description: '', assetImagePath: '/fixture/draft.png' }],
  colorPalettes: [{ id: 'palette', name: '工作室色卡', createdAt: 1, assetImagePath: '/fixture/palette.png' }],
  globalColorPaletteId: 'palette',
  shots: [{ id: 'ui-shot', shotNo: '01-01', description: '苏禾在工作室查看手稿', sceneId: 'studio', characterIds: ['suhe'],
    imagePath: '/fixture/studio.png', durationSec: 6, genStatus: 'idle',
    universalVideoPrompt: 'subject_definitions: <Subject 1>: Based on <Picture 2>.\\n\\nsummary: Preserve the colors of <Picture 3>.' }],
});
const workshopFile = '.gdream/aigc-memory/projects/' + project.id + '/workshop.json';
const files = new Map([[workshopFile, JSON.stringify(data)]]);
const unexpected = [];
window.__TAURI_IPC__ = ({ callback, error, __tauriModule, message, cmd }) => {
  try {
    let result;
    if (__tauriModule === 'Path') result = '/fixture/';
    else if (__tauriModule === 'Event') result = 1;
    else if (__tauriModule === 'Fs') {
      if (message.cmd === 'exists') result = files.has(message.path);
      else if (message.cmd === 'readTextFile') result = files.get(message.path) || '[]';
      else if (message.cmd === 'writeFile') files.set(message.path, new TextDecoder().decode(new Uint8Array(message.contents)));
      else if (message.cmd === 'renameFile') { files.set(message.newPath, files.get(message.oldPath)); files.delete(message.oldPath); }
      else if (message.cmd !== 'createDir') throw new Error('Unexpected FS: ' + message.cmd);
    } else { unexpected.push(__tauriModule || cmd); throw new Error('Unexpected IPC: ' + (__tauriModule || cmd)); }
    window['_' + callback](result);
  } catch (cause) { window['_' + error](String(cause)); }
};
useWorkshopStore.setState({ project, data });
const commit = useWorkshopStore.getState().commitNow;
window.assetPickerTest = {
  current: () => useWorkshopStore.getState().data.shots[0],
  saved: () => JSON.parse(files.get(workshopFile)).shots[0],
  unexpected: () => unexpected,
  failNextCommit() {
    let failed = false;
    useWorkshopStore.setState({ commitNow: async () => {
      if (!failed) { failed = true; throw new Error('模拟保存失败'); }
      return commit();
    } });
  },
  clearAssets() { const current = useWorkshopStore.getState().data; useWorkshopStore.setState({ data: { ...current, characters: [], scenes: [], props: [], colorPalettes: [] } }); },
};
createRoot(document.getElementById('root')).render(<StepGenerate />);
`;

const bundle = await esbuild.build({
  stdin: { contents: fixture, resolveDir: repo, loader: 'tsx' },
  absWorkingDir: repo, bundle: true, write: false, platform: 'browser', format: 'iife',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  plugins: [{
    name: 'fixture-assets',
    setup(build) {
      build.onResolve({ filter: /\?(raw|url|inline)$/ }, (args) => ({ path: path.resolve(args.resolveDir, args.path.split('?')[0]), namespace: 'fixture-asset' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture-asset' }, async (args) => ({ contents: `export default ${JSON.stringify(await fs.readFile(args.path, 'utf8'))};`, loader: 'js' }));
    },
  }], logLevel: 'silent',
});
const assets = path.join(repo, 'dist/assets');
const cssName = (await fs.readdir(assets)).find((name) => /^main-.*\.css$/.test(name));
assert.ok(cssName, 'Run npm run build first');
const css = await fs.readFile(path.join(assets, cssName), 'utf8');
const imageRoot = path.resolve(repo, '../output/imagegen/9-29-reference-refresh');
const imageFiles = {
  'suhe.png': 'suhe-identity-reference.png',
  'chenyu.png': 'chenyu-identity-reference.png',
  'studio.png': 'studio_day-gpt-image-2.5.png',
  'draft.png': 'studio_day-gpt-image-2.5.png',
  'palette.png': 'studio_day-gpt-image-2.5.png',
};
// Keep the regression runnable in code-only checkouts without the demo images.
const fallback = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1i8AAAAASUVORK5CYII=', 'base64');
const images = new Map(await Promise.all(Object.entries(imageFiles).map(async ([name, file]) => [name, await fs.readFile(path.join(imageRoot, file)).catch(() => fallback)])));
const server = http.createServer((req, res) => {
  if (req.url === '/fixture.js') {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.end(bundle.outputFiles[0].text);
  } else if (req.url?.startsWith('/images/')) {
    res.setHeader('Content-Type', 'image/png');
    res.end(images.get(decodeURIComponent(req.url.slice('/images/'.length))) || fallback);
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body class="canvas-dark" style="background:#111"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(30_000);
  const errors = [];
  const blocked = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (process.env.DEBUG_ASSET_PICKER) {
    page.on('request', (request) => console.log('request', request.url()));
    page.on('response', (response) => console.log('response', response.status(), response.url()));
    page.on('console', (message) => console.log('console', message.type(), message.text()));
    page.on('pageerror', (error) => console.log('pageerror', error.message));
  }
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith('http://127.0.0.1:')) void request.continue();
    else { blocked.push(request.url()); void request.abort(); }
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-shot-no="01-01"]');
  await page.click('[data-shot-no="01-01"] button[title="展开详情"]');
  const openPicker = async () => {
    await page.click('[data-shot-no="01-01"] button[title="添加参考图"]');
    const menu = await page.$eval('[role="menu"]', (element) => {
      const rect = element.getBoundingClientRect();
      return { text: element.textContent, left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
    });
    for (const label of ['上传本地图', '从当前项目资产添加', '从素材库选']) assert.ok(menu.text.includes(label));
    assert.ok(menu.left >= 0 && menu.right <= menu.width && menu.bottom <= menu.height, JSON.stringify(menu));
    await page.click('[role="menu"] button:nth-child(2)');
    await page.waitForSelector('[role="dialog"][aria-label="当前项目资产"]');
  };
  const clickTab = async (label) => page.evaluate((text) => [...document.querySelectorAll('[role="tab"]')].find((button) => button.textContent === text).click(), label);
  await openPicker();
  assert.equal(await page.$$eval('[role="dialog"] input[type="checkbox"]', (inputs) => inputs.length), 2);
  assert.equal(await page.$$eval('[role="dialog"] img', (items) => items.length), 5);
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] img')].every((image) => image.complete && image.naturalWidth > 0));
  await clickTab('角色');
  await page.click('input[aria-label="选择 角色 陈宇"]');
  await clickTab('道具');
  await page.click('input[aria-label="选择 道具 设计手稿"]');
  await clickTab('全部');
  await page.type('input[aria-label="搜索项目资产"]', '不存在的资产');
  await page.waitForFunction(() => document.querySelector('[role="dialog"]').textContent.includes('没有匹配的资产'));
  await page.$eval('input[aria-label="搜索项目资产"]', (input) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForSelector('input[aria-label="选择 角色 陈宇"]');
  const out = path.join(repo, 'scripts/pipeline-probe/.gen');
  await fs.mkdir(out, { recursive: true });
  await page.screenshot({ path: path.join(out, 'project-asset-picker-desktop.png') });
  await page.evaluate(() => window.assetPickerTest.failNextCommit());
  await page.click('[role="dialog"] footer button:last-child');
  await page.waitForSelector('[role="alert"]');
  assert.equal(await page.$eval('[role="dialog"] footer button:last-child', (button) => button.disabled), false);
  await page.click('[role="dialog"] footer button:last-child');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const current = await page.evaluate(() => window.assetPickerTest.current());
  assert.deepEqual(current.extraRefImages, ['/fixture/chenyu.png', '/fixture/draft.png']);
  assert.deepEqual(current.characterIds, ['suhe']);
  assert.equal(current.sceneId, 'studio');
  assert.equal(current.referenceRevision, 1, 'retry must not duplicate references or renumber again');
  assert.match(current.universalVideoPrompt, /colors of <Picture 5>/);
  assert.deepEqual(await page.evaluate(() => window.assetPickerTest.saved().extraRefImages), current.extraRefImages);
  await openPicker();
  assert.equal(await page.$$eval('[role="dialog"] input[type="checkbox"]', (inputs) => inputs.length), 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await page.setViewport({ width: 375, height: 812 });
  await openPicker();
  const bounds = await page.$eval('[role="dialog"]', (element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight, overflow: element.scrollWidth > element.clientWidth };
  });
  assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.top >= 0 && bounds.bottom <= bounds.height && !bounds.overflow, JSON.stringify(bounds));
  await page.screenshot({ path: path.join(out, 'project-asset-picker-mobile.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.assetPickerTest.clearAssets());
  await openPicker();
  assert.ok(await page.$eval('[role="dialog"]', (element) => element.textContent.includes('当前项目暂无可用资产图片')));
  assert.equal(await page.$eval('[role="dialog"] footer button:last-child', (button) => button.disabled), true);
  assert.deepEqual(await page.evaluate(() => window.assetPickerTest.unexpected()), []);
  assert.deepEqual(blocked, []);
  assert.deepEqual(errors, []);
  console.log(`PASS: actual input menu, categories/search, multiselect, existing-ref deduplication, save retry, persistence, Escape, empty state, desktop/mobile; zero external requests. Screenshots: ${out}/project-asset-picker-{desktop,mobile}.png`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
