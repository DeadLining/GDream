import {expect, test} from '@playwright/test';

test('workspace shows generated panel and shot production controls', async ({page}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', {name: '失窃的雨夜'})).toBeVisible();
  await expect(page.getByAltText('林默站在雨夜霓虹巷道的漫画分镜')).toBeVisible();
  await page.getByRole('button', {name: /镜头 2/}).click();
  await expect(page.getByRole('heading', {name: '镜头 2'})).toBeVisible();
  await expect(page.getByRole('button', {name: '生成画面'})).toBeVisible();
  await expect(page.getByText('待审核')).toBeVisible();
});

test('mobile shot selection opens the inspector without overlap', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-specific behavior');
  await page.goto('/');

  await page.getByRole('button', {name: /镜头 2/}).click();
  await expect(page.getByRole('heading', {name: '镜头 2'})).toBeVisible();
  await expect(page.getByRole('button', {name: '生成画面'})).toBeInViewport();
  await expect(page.getByRole('main')).toBeHidden();
});
