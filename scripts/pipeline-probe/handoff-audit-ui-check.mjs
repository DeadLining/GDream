/** Render the real handoff audit with isolated state, no live writes or remote requests. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import puppeteer from 'puppeteer-core';
import tailwindConfig from '../../tailwind.config.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import StepHandoff from './src/components/workshop/steps/StepHandoff';
import { useWorkshopStore } from './src/stores/workshopStore';
import { useSettingsStore } from './src/stores/settingsStore';
import { emptyWorkshopData } from './src/lib/workshop/types';
const data = emptyWorkshopData('audit-fixture');
data.shots = Array.from({length: 12}, (_, index) => ({
  shotNo: '01-' + String(index + 1).padStart(2, '0'), description: '', characterIds: [], videoPath: '/fixture/video.mp4',
}));
window.__TAURI_IPC__ = ({ callback }) => window['_' + callback](null);
useWorkshopStore.setState({ data, project: { id: data.projectId, name: 'audit', sources: [] },
  scheduleSave() {}, commitNow: async () => {}, restoreAdoptedVideoCandidatesFromCanvas: async () => 0,
});
useSettingsStore.setState({ qualityReviewEnabled: false });
createRoot(document.getElementById('root')).render(<StepHandoff />);
`;
const bundle = await esbuild.build({
  stdin: { contents: fixture, resolveDir: repo, loader: 'tsx' },
  absWorkingDir: repo, bundle: true, write: false, platform: 'browser', format: 'iife',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  plugins: [{ name: 'fixture-assets', setup(build) {
    build.onResolve({ filter: /\?(raw|url|inline)$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.split('?')[0]), namespace: 'fixture-asset',
    }));
    build.onLoad({ filter: /.*/, namespace: 'fixture-asset' }, async (args) => ({
      contents: 'export default ' + JSON.stringify(await fs.readFile(args.path, 'utf8')) + ';', loader: 'js',
    }));
  } }], logLevel: 'silent',
});
const css = (await postcss([tailwindcss({ ...tailwindConfig, content: [path.join(repo, 'src/**/*.{ts,tsx}')] })])
  .process(await fs.readFile(path.join(repo, 'src/index.css'), 'utf8'), { from: path.join(repo, 'src/index.css') })).css;
const server = http.createServer((req, res) => {
  if (req.url === '/fixture.js') {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.end(bundle.outputFiles[0].text);
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<html><head><meta charset="utf-8"><style>' + css + '</style></head><body class="canvas-dark" style="background:#111"><div id="root"></div><script src="/fixture.js"></script></body></html>');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => request.url().startsWith('http://127.0.0.1:') ? request.continue() : request.abort());
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await page.setViewport({ width, height });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => [...document.querySelectorAll('h3')].some((node) => node.textContent.includes('生产审计')));
    const audit = await page.$('section:has(h3)');
    const layout = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h3')].find((node) => node.textContent.includes('生产审计'));
      const section = heading.closest('section');
      const elements = [...section.querySelectorAll('div')].filter((node) => node.children.length === 0 && node.textContent.trim());
      return {
        details: section.textContent,
        clipped: elements.filter((node) => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1).map((node) => node.textContent),
        overflow: section.getBoundingClientRect().right > innerWidth,
      };
    });
    assert.match(layout.details, /未启用 AI 终审/);
    assert.match(layout.details, /01-12/);
    assert.equal(layout.overflow, false);
    assert.deepEqual(layout.clipped, []);
    // Expand only the capture height so the scrollable panel is visible in its entirety.
    const auditHeight = (await audit.boundingBox()).height;
    await page.setViewport({ width, height: Math.max(height, Math.ceil(auditHeight) + 64) });
    await audit.screenshot({ path: path.join(repo, 'scripts/pipeline-probe/.gen/handoff-audit-' + width + '.png') });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: real handoff audit, desktop/mobile text wrapping, no clipped details, disabled-review disclosure; screenshots in .gen/handoff-audit-*.png');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
