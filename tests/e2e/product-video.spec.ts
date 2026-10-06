import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

/**
 * 产品视频：编辑器添加 → 保存后进后台上传队列 → 详情里可播放。
 * 视频文件内容是假的（不校验能否解码），只验证整条链路：选文件、保存、上传、展示、打开播放器。
 */
let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test.describe.configure({ timeout: 90_000 });

const FAKE_VIDEO = { name: '测试视频.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(150_000, 7) };

test('产品视频：添加、可移除，保存后上传，详情里能打开播放器', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .button-primary').click();
  await expect(page.getByRole('dialog').locator('.product-editor')).toBeVisible();

  const name = `E2E产品视频${Date.now()}`;
  await page.getByRole('dialog').getByRole('textbox', { name: '品名' }).fill(name);

  const videoSection = page.getByRole('dialog').locator('.section-box').filter({ hasText: '产品视频' });
  const videoInput = videoSection.locator('input[aria-label="添加产品视频"]');

  // 添加 → 移除 → 再添加：编辑器里的增删都要生效
  await videoInput.setInputFiles(FAKE_VIDEO);
  await expect(videoSection.locator('.product-video-row')).toHaveCount(1);
  await expect(videoSection.locator('.product-video-pending')).toHaveText('待上传');
  await videoSection.getByRole('button', { name: /移除/ }).click();
  await expect(videoSection.locator('.product-video-row')).toHaveCount(0);
  await videoInput.setInputFiles(FAKE_VIDEO);
  await expect(videoSection.locator('.product-video-row')).toHaveCount(1);

  const createResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/products' && response.request().method() === 'POST'
  ));
  await page.getByRole('dialog').getByRole('button', { name: '保存产品' }).click();
  const productId = String((await (await createResponse).json()).data.id);
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 4000 });

  // 后台上传完成：服务端确有 1 个视频
  await expect.poll(async () => {
    const response = await page.request.get(`/api/products/${productId}`);
    const body = await response.json();
    return (body.data?.videos ?? []).length;
  }, { timeout: 40_000 }).toBe(1);

  // 卡片带「视频 1」标记；打开详情能点播放
  await page.locator('.search-control input').fill(name);
  await expect(page.locator('.product-gallery-card')).toHaveCount(1);
  await expect(page.locator('.product-gallery-card .badge', { hasText: '视频 1' })).toBeVisible();

  await page.locator('.product-gallery-card .product-gallery-open').click();
  const detail = page.getByRole('dialog');
  const videoRow = detail.locator('.product-video-row').first();
  await expect(videoRow).toContainText('测试视频.mp4');
  await videoRow.getByRole('button', { name: /播放/ }).click();
  await expect(page.locator('video.video-player')).toBeVisible();
});
