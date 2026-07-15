import {expect, test} from '@playwright/test';

import {runThemeToVideoPipeline} from './support/real-model-pipeline';


const enabled = process.env.AI_COMIC_E2E_REAL_MODELS === '1';
const timeoutMs = Number(process.env.AI_COMIC_E2E_TIMEOUT_MS ?? 30 * 60 * 1000);
const defaultTheme = [
  '旧城里，一名钟表修复师发现：每修好一块停摆的表，',
  '就会短暂看到失踪妹妹留下的一条新线索。',
  '生成一集竖屏悬疑动态漫画，只要一场核心戏和一个关键镜头，',
  '总时长控制在 15 秒以内，无对白，结尾留下反转。',
].join('');

test('@real-model given a theme, AI creates a playable shot video end to end', async ({page, request}, testInfo) => {
  test.skip(!enabled, 'Set AI_COMIC_E2E_REAL_MODELS=1 to call the configured real models.');
  test.skip(testInfo.project.name !== 'desktop', 'The expensive real-model flow runs once on desktop.');
  testInfo.setTimeout(timeoutMs);

  const result = await runThemeToVideoPipeline({
    request,
    theme: process.env.AI_COMIC_E2E_THEME?.trim() || defaultTheme,
    timeoutMs,
    onStage: stage => testInfo.annotations.push({type: 'stage', description: stage}),
  });

  await testInfo.attach('real-model-pipeline.json', {
    body: Buffer.from(JSON.stringify(result, null, 2)),
    contentType: 'application/json',
  });

  await page.addInitScript(({projectId, episodeId}) => {
    localStorage.setItem('ai-comic-project', projectId);
    localStorage.setItem('ai-comic-episode', episodeId);
  }, {projectId: result.project.id, episodeId: result.episode.id});
  await page.goto('/');

  await expect(page.getByLabel('选择项目')).toHaveValue(result.project.id);
  await expect(page.getByLabel('选择剧集')).toHaveValue(result.episode.id);
  await page.getByRole('tab', {name: '分镜'}).click();
  await page.getByRole('button', {name: new RegExp(`镜头 ${result.shot.position}`)}).click();

  const generatedVideo = page.locator('.video-versions video').filter({
    has: page.locator(`source[src*="${result.video.id}"]`),
  });
  const visibleVideo = generatedVideo.count().then(count => count > 0)
    ? generatedVideo.first()
    : page.locator('.video-versions video').first();
  await expect(visibleVideo).toBeVisible();
  await expect(visibleVideo).toHaveAttribute('src', new RegExp(result.video.media_url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expect.poll(
    () => visibleVideo.evaluate(video => (video as HTMLVideoElement).videoWidth),
    {timeout: 30_000, message: 'Generated MP4 should expose playable video metadata'},
  ).toBeGreaterThan(0);

  await page.screenshot({path: testInfo.outputPath('theme-to-video-complete.png'), fullPage: true});
});
