import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

import {expect, request as playwrightRequest, test} from '@playwright/test';

import {resolveRealModelTimeoutMs, runThemeToVideoPipeline, type ThemeToVideoResult} from './support/real-model-pipeline';


const enabled = process.env.AI_COMIC_E2E_REAL_MODELS === '1';
const timeoutMs = resolveRealModelTimeoutMs(process.env.AI_COMIC_E2E_TIMEOUT_MS);
const defaultTheme = [
  '旧城里，一名钟表修复师发现：每修好一块停摆的表，',
  '就会短暂看到失踪妹妹留下的一条新线索。',
  '生成一集竖屏悬疑动态漫画，用三到五个连续镜头讲完一场核心戏，',
  '加入两句简短对白，总时长控制在 30 秒以内，结尾留下反转。',
].join('');

test('@real-model given a theme, AI creates and registers a playable full episode', async ({page}, testInfo) => {
  test.skip(!enabled, 'Set AI_COMIC_E2E_REAL_MODELS=1 to call the configured real models.');
  test.skip(testInfo.project.name !== 'desktop', 'The expensive real-model flow runs once on desktop.');
  testInfo.setTimeout(timeoutMs);

  const resultPath = process.env.AI_COMIC_E2E_RESULT_PATH?.trim();
  let result: ThemeToVideoResult;
  if (resultPath && existsSync(resultPath)) {
    result = JSON.parse(await readFile(resultPath, 'utf8')) as ThemeToVideoResult;
    testInfo.annotations.push({type: 'stage', description: 'reuse-real-model-result'});
  } else {
    const api = await playwrightRequest.newContext({
      baseURL: process.env.AI_COMIC_E2E_API_URL ?? 'http://127.0.0.1:8000',
    });
    result = await runThemeToVideoPipeline({
      request: api,
      theme: process.env.AI_COMIC_E2E_THEME?.trim() || defaultTheme,
      timeoutMs,
      onStage: stage => testInfo.annotations.push({type: 'stage', description: stage}),
    }).finally(() => api.dispose());
    if (resultPath) {
      await mkdir(dirname(resultPath), {recursive: true});
      await writeFile(resultPath, JSON.stringify(result, null, 2));
    }
  }

  await testInfo.attach('real-model-pipeline.json', {
    body: Buffer.from(JSON.stringify(result, null, 2)),
    contentType: 'application/json',
  });

  await page.addInitScript(({projectId, episodeId}) => {
    localStorage.setItem('ai-comic-project', projectId);
    localStorage.setItem('ai-comic-episode', episodeId);
  }, {projectId: result.project.id, episodeId: result.episode.id});
  await page.goto('/');

  await expect(page.locator('#project-switcher')).toHaveValue(result.project.id);
  await expect(page.locator('.episode-item[aria-current="page"]')).toContainText(result.episode.title);
  await page.getByRole('tab', {name: '分镜'}).click();
  const selectedShot = page.locator('.shot-card[aria-pressed="true"]');
  await expect(selectedShot).toHaveCount(1);
  await selectedShot.click();

  const visibleVideo = page.locator('.video-versions video').first();
  await expect(visibleVideo).toBeVisible();
  await expect(visibleVideo).toHaveAttribute('src', new RegExp(result.video.media_url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expect.poll(
    () => visibleVideo.evaluate(video => (video as HTMLVideoElement).videoWidth),
    {timeout: 30_000, message: 'Generated MP4 should expose playable video metadata'},
  ).toBeGreaterThan(0);

  expect(result.shots).toHaveLength(result.episode.scenes.flatMap(scene=>scene.shots).length);
  expect(result.shots.length).toBeGreaterThan(1);
  expect(result.release.publication.status).toBe('published');

  await page.getByRole('button',{name:'审核发布'}).click();
  await page.getByRole('button',{name:'终审成片'}).click();
  const finalVideo=page.getByLabel('终审成片视频');
  await expect(finalVideo).toBeVisible();
  await expect(finalVideo).toHaveAttribute('src',new RegExp(result.render.media_url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  await expect.poll(
    ()=>finalVideo.evaluate(video=>(video as HTMLVideoElement).videoWidth),
    {timeout:30_000,message:'Final episode MP4 should expose playable video metadata'},
  ).toBeGreaterThan(0);

  await page.screenshot({path: testInfo.outputPath('theme-to-video-complete.png'), fullPage: true});
});
