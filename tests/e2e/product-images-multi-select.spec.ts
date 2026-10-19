import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
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

/** 两张精修图 + 两张实拍图：连选要能跨文件夹，且顺序与文件夹展示顺序一致。 */
async function seedProductWithImages(page: Page, stamp: number) {
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E多选图片${stamp}`,
      supplier: 'E2E供应商',
      status: 'active',
      packaging: [{ name: '彩盒包装', innerSize: '10×5×3', innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8, packCount: 24 }],
    },
  });
  if (!created.ok()) throw new Error(`创建产品失败：HTTP ${created.status()} ${await created.text()}`);
  const product = (await created.json()).data as { id: string; sku: string };
  for (const [name, category] of [['a-精修1.png', 'product'], ['b-精修2.png', 'product'], ['c-实拍1.png', 'customer'], ['d-实拍2.png', 'customer']] as const) {
    const uploaded = await page.request.post(`/api/products/${product.id}/images?category=${category}`, {
      multipart: { file: { name, mimeType: 'image/png', buffer: PNG_1X1 } },
    });
    if (!uploaded.ok()) throw new Error(`上传图片失败：HTTP ${uploaded.status()} ${await uploaded.text()}`);
  }
  return product;
}

async function openImagesModal(page: Page, sku: string) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(sku);
  await page.locator('.product-image-button:visible').first().click();
  const modal = page.locator('.product-images-content');
  await expect(modal).toBeVisible();
  return modal;
}

const countText = (page: Page, text: string) => page.locator('.product-images-selection-toolbar').getByText(text);

test.describe('产品图片多选', () => {
  test('Shift 点击按文件夹展示顺序连选，锚点不随 Shift 移动', async ({ page }) => {
    const product = await seedProductWithImages(page, Date.now());
    try {
      await openImagesModal(page, product.sku);
      const thumbs = page.locator('.product-image-thumbnail');
      await expect(thumbs).toHaveCount(4);
      await expect(countText(page, '已选 0 / 4')).toBeVisible();

      // 普通点击 a：只选一张，同时成为锚点。
      await thumbs.nth(0).click();
      await expect(countText(page, '已选 1 / 4')).toBeVisible();

      // Shift 点 c：a→c 之间的 a、b、c 全部选中（b 在另一个文件夹里也参与）。
      await thumbs.nth(2).click({ modifiers: ['Shift'] });
      await expect(countText(page, '已选 3 / 4')).toBeVisible();
      await expect(thumbs.nth(0)).toHaveAttribute('aria-pressed', 'true');
      await expect(thumbs.nth(1)).toHaveAttribute('aria-pressed', 'true');
      await expect(thumbs.nth(2)).toHaveAttribute('aria-pressed', 'true');
      await expect(thumbs.nth(3)).toHaveAttribute('aria-pressed', 'false');

      // 锚点仍是 a：Shift 点 d 直接扩到 a→d 全部，而不是从 c 起算。
      await thumbs.nth(3).click({ modifiers: ['Shift'] });
      await expect(countText(page, '已选 4 / 4')).toBeVisible();

      // 普通点击 d 取消它，并把锚点移到 d；再 Shift 点 b 会框住 b、c、d。
      await thumbs.nth(3).click();
      await expect(countText(page, '已选 3 / 4')).toBeVisible();
      await thumbs.nth(1).click({ modifiers: ['Shift'] });
      await expect(countText(page, '已选 4 / 4')).toBeVisible();
      await expect(thumbs.nth(0)).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });

  test('下载成功后自动清空勾选，可以直接挑下一批', async ({ page }) => {
    const product = await seedProductWithImages(page, Date.now());
    try {
      await openImagesModal(page, product.sku);
      const thumbs = page.locator('.product-image-thumbnail');
      const downloadButton = page.locator('.product-images-download-button');

      await thumbs.nth(0).click();
      await thumbs.nth(2).click();
      await expect(countText(page, '已选 2 / 4')).toBeVisible();

      const firstDownload = page.waitForEvent('download');
      await downloadButton.click();
      const file = await firstDownload;
      expect(file.suggestedFilename()).toMatch(/\.png$/);

      await expect(page.locator('.product-images-copy-message')).toContainText('已开始下载 2 张图片');
      await expect(countText(page, '已选 0 / 4')).toBeVisible();
      await expect(downloadButton).toBeDisabled();
      await expect(thumbs.nth(0)).toHaveAttribute('aria-pressed', 'false');

      // 无需先取消旧勾选：直接选一张就能再次下载。
      await thumbs.nth(3).click();
      await expect(downloadButton).toContainText('下载所选图片（1）');
      const secondDownload = page.waitForEvent('download');
      await downloadButton.click();
      await secondDownload;
      await expect(countText(page, '已选 0 / 4')).toBeVisible();
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });

  test('图片抓取失败时保留勾选，不白丢一次选择', async ({ page }) => {
    const product = await seedProductWithImages(page, Date.now());
    // 直接让网页抓图的 fetch 失败：预览 <img> 已把原图放进缓存，用 route 拦网络时 fetch 会命中缓存而"成功"。
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        if (url.includes('/files/')) return Promise.reject(new Error('模拟抓图失败'));
        return originalFetch(input, init);
      }) as typeof window.fetch;
    });
    try {
      await openImagesModal(page, product.sku);
      const thumbs = page.locator('.product-image-thumbnail');
      await thumbs.nth(0).click();
      await expect(countText(page, '已选 1 / 4')).toBeVisible();

      await page.locator('.product-images-download-button').click();

      await expect(page.locator('.product-images-copy-message')).toContainText('图片下载失败');
      await expect(countText(page, '已选 1 / 4')).toBeVisible();
      await expect(thumbs.nth(0)).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });
});
