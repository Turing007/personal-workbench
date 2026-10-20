import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';
import { useProductListView } from './helpers/products-view';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
  await useProductListView(context);
});

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** 造 20 张图：够把缩略图区撑得比弹窗还长，验证列表本身能滚。 */
async function seedProductWithImages(page: Page, stamp: number) {
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E大图弹窗${stamp}`,
      supplier: 'E2E供应商',
      status: 'active',
      packaging: [{ name: '彩盒包装', innerSize: '10×5×3', innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8, packCount: 24 }],
    },
  });
  if (!created.ok()) throw new Error(`创建产品失败：HTTP ${created.status()} ${await created.text()}`);
  const product = (await created.json()).data as { id: string; sku: string };
  for (let index = 0; index < 20; index += 1) {
    const uploaded = await page.request.post(`/api/products/${product.id}/images?category=product`, {
      multipart: { file: { name: `viewer-${stamp}-${index}.png`, mimeType: 'image/png', buffer: PNG_1X1 } },
    });
    if (!uploaded.ok()) throw new Error(`上传图片失败：HTTP ${uploaded.status()} ${await uploaded.text()}`);
  }
  return product;
}

async function openImagesModal(page: Page, sku: string, mobile = false) {
  await page.goto('/');
  if (mobile) await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(sku);
  await page.locator('.product-image-button:visible').first().click();
  await expect(page.locator('.product-images-content')).toBeVisible();
  return page.locator('.product-images-content');
}

/** 用 CDP 发真实触摸事件：滑动手势只有走触摸路径才和手机一致。 */
async function swipe(context: BrowserContext, page: Page, fromX: number, toX: number, y: number) {
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] });
  for (let step = 1; step <= 8; step += 1) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: fromX + ((toX - fromX) * step) / 8, y }],
    });
    await page.waitForTimeout(12);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
}

test.describe('产品大图弹窗：缩略图 + 放大镜', () => {
  test('弹窗里不再常驻大图；点缩略图和放大镜都弹出大图浮层，且都不产生勾选', async ({ page }) => {
    const product = await seedProductWithImages(page, Date.now());
    try {
      await openImagesModal(page, product.sku);
      const thumbs = page.locator('.product-image-thumbnail');
      const selectButtons = page.locator('.product-image-thumbnail-select');
      await expect(thumbs).toHaveCount(20);

      // 顶部那个常驻大图已经去掉：弹窗里第一眼就是缩略图。
      await expect(page.locator('.product-images-preview')).toHaveCount(0);
      await expect(page.locator('.product-image-zoom')).toHaveCount(0);

      // 点缩略图：弹出大图浮层，计数从 1 开始，勾选仍为 0。
      await thumbs.nth(2).locator('.product-image-thumbnail-preview').click();
      const zoom = page.locator('.product-image-zoom');
      await expect(zoom).toBeVisible();
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('3 / 20');
      await expect(zoom.locator('.product-image-zoom-stage img')).toBeVisible();
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 0 / 20');
      await expect(selectButtons.nth(2)).toHaveAttribute('aria-pressed', 'false');

      // 桌面端用底部「上一张 / 下一张」切图，仍然不勾选。
      // 按钮必须真的可点：原图按自然尺寸撑出浮层时会把底部操作条盖住，Playwright 会报 intercepted。
      const imageBox = await zoom.locator('.product-image-zoom-stage img').boundingBox();
      const footerBox = await zoom.locator('.product-image-zoom-footer').boundingBox();
      expect(imageBox && footerBox && imageBox.y + imageBox.height, '大图不能压到底部操作条').toBeLessThanOrEqual((footerBox?.y ?? 0) + 1);
      await zoom.getByRole('button', { name: '下一张' }).click();
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('4 / 20');
      await zoom.getByRole('button', { name: '上一张' }).click();
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('3 / 20');
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 0 / 20');

      // Esc 关闭浮层，图库弹窗本身还在。
      await page.keyboard.press('Escape');
      await expect(zoom).toHaveCount(0);
      await expect(page.locator('.product-images-content')).toBeVisible();

      // 底栏放大镜打开同一张图；点空白处关闭。
      await thumbs.nth(0).locator('.product-image-thumbnail-zoom').click();
      await expect(zoom).toBeVisible();
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('1 / 20');
      await zoom.locator('.product-image-zoom-stage').click({ position: { x: 5, y: 5 } });
      await expect(zoom).toHaveCount(0);

      // 勾选仍只认底栏圆钮。
      await selectButtons.nth(2).click();
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 1 / 20');
      await expect(selectButtons.nth(2)).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });
});

test.describe('手机端', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('缩略图列表自身可滚，大图浮层铺满屏幕', async ({ page }) => {
    const product = await seedProductWithImages(page, Date.now());
    try {
      await page.setViewportSize({ width: 390, height: 600 });
      await openImagesModal(page, product.sku, true);
      const body = page.locator('.modal-body');

      // 没有常驻大图占位后，缩略图从弹窗顶部就开始；列表超出时由内容区滚动。
      const scrollable = await body.evaluate((node) => node.scrollHeight - node.clientHeight);
      expect(scrollable, '内容区应当可以滚动').toBeGreaterThan(0);

      await page.locator('.product-image-thumbnail-preview').first().click();
      const zoom = page.locator('.product-image-zoom');
      await expect(zoom).toBeVisible();
      const metrics = await page.evaluate(() => {
        const node = document.querySelector('.product-image-zoom') as HTMLElement;
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
      });
      // 浮层铺满视口，大图才够大；不再被弹窗正文的高度限制。
      expect(Math.abs(metrics.width - metrics.viewportWidth)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.height - metrics.viewportHeight)).toBeLessThanOrEqual(1);
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });

  test('大图浮层左滑切下一张、右滑切上一张，到头停住不循环', async ({ page, context }) => {
    const product = await seedProductWithImages(page, Date.now());
    try {
      await openImagesModal(page, product.sku, true);
      await page.locator('.product-image-thumbnail-preview').first().click();
      const zoom = page.locator('.product-image-zoom');
      await expect(zoom).toBeVisible();
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('1 / 20');

      const stage = zoom.locator('.product-image-zoom-stage');
      const box = await stage.boundingBox();
      if (!box) throw new Error('大图区域不可见');
      const y = box.y + box.height / 2;

      // 第一张右滑（想去上一张）：到头停住。
      await swipe(context, page, box.x + 20, box.x + box.width - 20, y);
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('1 / 20');

      // 左滑 = 下一张，再左滑 = 再下一张。
      await swipe(context, page, box.x + box.width - 20, box.x + 20, y);
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('2 / 20');
      await swipe(context, page, box.x + box.width - 20, box.x + 20, y);
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('3 / 20');

      // 右滑 = 上一张。
      await swipe(context, page, box.x + 20, box.x + box.width - 20, y);
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('2 / 20');

      // 滑动只换图，不产生勾选；手机上显示滑动提示。
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 0 / 20');
      await expect(zoom.locator('.product-image-zoom-hint')).toBeVisible();
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });
});
