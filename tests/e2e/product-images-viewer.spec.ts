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

/** 造 20 张图：够把缩略图区撑到需要滚动，验证大图吸顶。 */
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

test.describe('产品大图弹窗：查看与勾选分离', () => {
  test('点缩略图只切换大图，勾选走独立圆钮；桌面端仍用两侧按钮切图', async ({ page }) => {
    const product = await seedProductWithImages(page, Date.now());
    try {
      await openImagesModal(page, product.sku);
      const previewName = page.locator('.product-images-preview-name');
      const thumbs = page.locator('.product-image-thumbnail');
      const selectButtons = page.locator('.product-image-thumbnail-select');
      await expect(thumbs).toHaveCount(20);
      const firstName = await previewName.textContent();

      // 点缩略图：大图切过去，但勾选数保持 0。
      await thumbs.nth(2).locator('.product-image-thumbnail-preview').click();
      await expect(previewName).not.toHaveText(firstName ?? '');
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 0 / 20');
      await expect(selectButtons.nth(2)).toHaveAttribute('aria-pressed', 'false');

      // 点底栏圆钮才勾选；再点一次取消。
      await selectButtons.nth(2).click();
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 1 / 20');
      await expect(selectButtons.nth(2)).toHaveAttribute('aria-pressed', 'true');
      await selectButtons.nth(2).click();
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 0 / 20');

      // 桌面端按钮切图：点「下一张」大图变化，且不产生勾选。
      const beforeNext = await previewName.textContent();
      await page.getByRole('button', { name: '下一张图片' }).click();
      await expect(previewName).not.toHaveText(beforeNext ?? '');
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 0 / 20');
      // 桌面端不显示「左右滑动切换」提示。
      await expect(page.locator('.product-images-swipe-hint')).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });
});

test.describe('手机端', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('缩略图往下翻时大图固定在顶部', async ({ page }) => {
    const product = await seedProductWithImages(page, Date.now());
    try {
      // 高度压到 600：20 张缩略图必定撑出内容区滚动，才能验证吸顶（844 高时整页恰好放得下）。
      await page.setViewportSize({ width: 390, height: 600 });
      await openImagesModal(page, product.sku, true);
      const body = page.locator('.modal-body');
      const preview = page.locator('.product-images-preview');

      // 先记录大图初始位置，再把内容区滚到底（缩略图多，够滚动）。
      const before = await preview.evaluate((node) => Math.round(node.getBoundingClientRect().top));
      const scrollable = await body.evaluate((node) => node.scrollHeight - node.clientHeight);
      expect(scrollable, '内容区应当可以滚动，才能验证吸顶').toBeGreaterThan(0);
      await body.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await page.waitForTimeout(200);

      const after = await preview.evaluate((node) => Math.round(node.getBoundingClientRect().top));
      // 吸顶后与滚动前基本同高（允许 2px 取整误差），而不是被滚出屏幕。
      expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
      await expect(preview).toBeVisible();
      // 大图不能占满整屏，给下面的缩略图留出滚动空间。
      const metrics = await page.evaluate(() => {
        const image = document.querySelector('.product-images-preview') as HTMLElement;
        return { height: image.getBoundingClientRect().height, viewport: window.innerHeight };
      });
      expect(metrics.height).toBeLessThan(metrics.viewport * 0.6);
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });

  test('大图左滑切下一张、右滑切上一张，到头停住不循环', async ({ page, context }) => {
    const product = await seedProductWithImages(page, Date.now());
    try {
      await openImagesModal(page, product.sku, true);
      const nameText = () => page.locator('.product-images-preview-name-text').textContent();
      const preview = page.locator('.product-images-preview');
      const box = await preview.boundingBox();
      if (!box) throw new Error('大图区域不可见');
      const y = box.y + box.height / 2;
      const first = await nameText();
      expect(first).toContain('-0.png');

      // 在第一张上往右滑（想去上一张）：到头停住。
      await swipe(context, page, box.x + 20, box.x + box.width - 20, y);
      expect(await nameText()).toBe(first);

      // 左滑 = 下一张，再左滑 = 再下一张。
      await swipe(context, page, box.x + box.width - 20, box.x + 20, y);
      const second = await nameText();
      expect(second).not.toBe(first);
      await swipe(context, page, box.x + box.width - 20, box.x + 20, y);
      const third = await nameText();
      expect(third).not.toBe(second);

      // 右滑 = 上一张，回到第二张。
      await swipe(context, page, box.x + 20, box.x + box.width - 20, y);
      await expect(page.locator('.product-images-preview-name-text')).toHaveText(second ?? '');

      // 滑动只换图，不产生勾选；手机上显示滑动提示。
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 0 / 20');
      await expect(page.locator('.product-images-swipe-hint')).toBeVisible();
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });
});
