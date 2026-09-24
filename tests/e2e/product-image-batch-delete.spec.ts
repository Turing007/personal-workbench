import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** 建一个带 count 张产品图的产品，图片全部落在 product 分类。 */
async function seedProductWithImages(page: Page, stamp: number, count: number) {
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E批量删图${stamp}`,
      supplier: 'E2E供应商',
      status: 'active',
      packaging: [{ name: '彩盒包装', innerSize: '10×5×3', innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8, packCount: 24 }],
    },
  });
  expect(created.ok()).toBeTruthy();
  const product = (await created.json()).data as { id: string; sku: string };
  for (let index = 0; index < count; index += 1) {
    const uploaded = await page.request.post(`/api/products/${product.id}/images?category=product`, {
      multipart: { file: { name: `e2e-${stamp}-${index}.png`, mimeType: 'image/png', buffer: PNG_1X1 } },
    });
    expect(uploaded.ok()).toBeTruthy();
  }
  return product;
}

/** 与 mobile-tabs 时的可见性 trick 无关：桌面行操作按钮和手机卡片的 DOM 同时存在，必须 :visible 过滤。 */
async function openProductEditor(page: Page, sku: string) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(sku);
  await page.locator('[title="编辑产品"]:visible').first().click();
  await expect(page.getByRole('dialog').locator('.product-editor')).toBeVisible();
}

test.describe('产品图片多选与批量删除', () => {
  test('勾选两张并批量删除，保存后图库只剩选中保留的那张', async ({ page }) => {
    test.setTimeout(60_000);
    const stamp = Date.now();
    const product = await seedProductWithImages(page, stamp, 3);
    try {
      await openProductEditor(page, product.sku);
      const editor = page.getByRole('dialog').locator('.product-editor');
      const wall = editor.locator('.image-upload').first();
      await expect(editor.locator('.image-card')).toHaveCount(3);

      await wall.locator('.image-select-toggle').click();
      const bar = wall.locator('.image-select-bar');
      await expect(bar.locator('.image-select-count')).toHaveText('已选 0 / 3 张');

      // 点缩略图勾选，勾上的卡片有选中态样式
      await editor.locator('.image-card-thumb').nth(0).click();
      await editor.locator('.image-card-thumb').nth(1).click();
      await expect(bar.locator('.image-select-count')).toHaveText('已选 2 / 3 张');
      await expect(editor.locator('.image-card.is-selected')).toHaveCount(2);

      // 全选 ↔ 取消全选跟随当前选中数切换
      await bar.getByRole('button', { name: '全选', exact: true }).click();
      await expect(bar.locator('.image-select-count')).toHaveText('已选 3 / 3 张');
      await bar.getByRole('button', { name: '取消全选', exact: true }).click();
      await expect(bar.locator('.image-card.is-selected')).toHaveCount(0);
      await editor.locator('.image-card-thumb').nth(0).click();
      await editor.locator('.image-card-thumb').nth(1).click();

      // window.confirm 必须显式接受，Playwright 默认 dismiss 会直接让删除落空
      page.on('dialog', (dialog) => void dialog.accept());      await bar.locator('button.is-danger').click();
      await expect(editor.locator('.image-upload-message')).toHaveText('已删除 2 张图片');
      await expect(editor.locator('.image-card')).toHaveCount(1);
      await expect(bar.locator('.image-select-count')).toHaveText('已选 0 / 1 张');

      // 别用 getByRole 找保存按钮：lucide 的 <Save> 图标会让 accessible name 带 aria 内容，
      // 桌面/手机双 DOM 又各渲染一份，直接锚定 footer 主按钮。
      await expect(page.getByRole('dialog').locator('button.button-primary', { hasText: '保存产品' })).toBeVisible();
      await page.getByRole('dialog').locator('button.button-primary').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const detail = await page.request.get(`/api/products/${product.id}`);
      const images = ((await detail.json()).data as { images: Array<{ id: number }> }).images;
      expect(images).toHaveLength(1);
    } finally {
      const cleanup = await page.request.delete(`/api/products/${product.id}`);
      expect(cleanup.ok()).toBeTruthy();
    }
  });

  test('确认弹窗被取消时什么都不删', async ({ page }) => {
    test.setTimeout(60_000);
    const stamp = Date.now();
    const product = await seedProductWithImages(page, stamp, 2);
    try {
      await openProductEditor(page, product.sku);
      const editor = page.getByRole('dialog').locator('.product-editor');
      const wall = editor.locator('.image-upload').first();
      await wall.locator('.image-select-toggle').click();
      await editor.locator('.image-card-thumb').nth(0).click();
      // 不注册 accept 处理：Playwright 默认 dismiss，等价于用户点了「取消」
      await wall.locator('button.is-danger').click();
      await expect(wall.locator('.image-select-count')).toHaveText('已选 1 / 2 张');
      await expect(editor.locator('.image-card')).toHaveCount(2);
    } finally {
      const cleanup = await page.request.delete(`/api/products/${product.id}`);
      expect(cleanup.ok()).toBeTruthy();
    }
  });
});
