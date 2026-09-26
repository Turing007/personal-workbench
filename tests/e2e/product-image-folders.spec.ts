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

async function seedProductWithImages(page: Page, stamp: number) {
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E分类文件夹${stamp}`,
      supplier: 'E2E供应商',
      status: 'active',
      packaging: [{ name: '彩盒包装', innerSize: '10×5×3', innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8, packCount: 24 }],
    },
  });
  expect(created.ok()).toBeTruthy();
  const product = (await created.json()).data as { id: string; sku: string };
  // 两张精修图（product）+ 一张实拍图（customer），再加一张不带分类的历史图。
  for (const [name, category] of [['a-精修.png', 'product'], ['b-精修.png', 'product'], ['c-实拍.png', 'customer'], ['d-历史.png', '']] as const) {
    const uploaded = await page.request.post(`/api/products/${product.id}/images${category ? `?category=${category}` : ''}`, {
      multipart: { file: { name, mimeType: 'image/png', buffer: PNG_1X1 } },
    });
    expect(uploaded.ok()).toBeTruthy();
  }
  return product;
}

async function openProductEditor(page: Page, sku: string) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(sku);
  await page.locator('[title="编辑产品"]:visible').first().click();
  await expect(page.getByRole('dialog').locator('.product-editor')).toBeVisible();
}

/** 往指定文件夹的上传块塞文件（DataTransfer + 手动 change，测的是真实前端管线）。 */
async function pickIntoFolder(page: Page, folderLabel: string, name: string) {
  await page.evaluate(({ folderLabel, name }) => {
    const folder = Array.from(document.querySelectorAll('.image-folder')).find((el) => el.querySelector('.image-folder-header')?.textContent?.includes(folderLabel));
    if (!folder) throw new Error(`找不到文件夹：${folderLabel}`);
    const input = folder.querySelector('input[type=file]') as HTMLInputElement;
    if (!input) throw new Error('文件夹里没有上传入口');
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], name, { type: 'image/png' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { folderLabel, name });
}

test.describe('产品图片按分类文件夹管理', () => {
  test('图片按文件夹分区展示，历史图归入精修图，上传直接进对应文件夹', async ({ page }) => {
    const stamp = Date.now();
    const product = await seedProductWithImages(page, stamp);
    try {
      await openProductEditor(page, product.sku);
      const editor = page.getByRole('dialog').locator('.product-editor');
      const folders = editor.locator('.image-folder');
      await expect(folders).toHaveCount(5);

      // 注意不能按整块 hasText 匹配：每张卡片的分类下拉里含全部分类名，会误命中所有文件夹。
      const refineFolder = editor.locator('.image-folder:has(.image-folder-header:has-text("精修图"))');
      const realShotFolder = editor.locator('.image-folder:has(.image-folder-header:has-text("实拍图"))');
      // 精修图 = 两张 product + 一张历史无分类图；实拍图 = 一张 customer。
      await expect(refineFolder.locator('.image-card')).toHaveCount(3);
      await expect(realShotFolder.locator('.image-card')).toHaveCount(1);
      await expect(refineFolder.locator('.image-folder-count')).toHaveText('3 张');
      await expect(realShotFolder.locator('.image-folder-count')).toHaveText('1 张');

      // 折叠精修图后卡片从 DOM 移除，再展开恢复
      await refineFolder.getByRole('button', { name: '收起精修图' }).click();
      await expect(refineFolder.locator('.image-card')).toHaveCount(0);
      await refineFolder.getByRole('button', { name: '展开精修图' }).click();
      await expect(refineFolder.locator('.image-card')).toHaveCount(3);

      // 默认粘贴目标是第一个文件夹（精修图），选中别的文件夹后高亮跟着走
      await expect(refineFolder.locator('.image-folder-select')).toHaveAttribute('aria-pressed', 'true');
      const realShotSelect = realShotFolder.locator('.image-folder-select');
      await realShotSelect.click();
      await expect(realShotSelect).toHaveAttribute('aria-pressed', 'true');
      await expect(refineFolder.locator('.image-folder-select')).toHaveAttribute('aria-pressed', 'false');
      await expect(editor.locator('.image-upload-header .image-upload-hint')).toHaveText('Ctrl+V 粘贴到「实拍图」');

      // 粘贴：图片直接进当前选中的实拍图，不用事后再逐张改分类
      await page.evaluate((name) => {
        const box = document.querySelector('.product-editor .image-upload');
        if (!box) throw new Error('找不到图片上传区');
        const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], name, { type: 'image/png' }));
        box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
      }, `粘贴-实拍-${stamp}.png`);
      await expect(realShotFolder.locator('.image-card')).toHaveCount(2);
      await expect(realShotFolder.locator('.image-card-category').last()).toHaveValue('customer');
      await expect(refineFolder.locator('.image-card')).toHaveCount(3);

      // 文件夹内自己的上传入口同样直接归入该文件夹
      await pickIntoFolder(page, '实拍图', `e2e-folders-${stamp}.png`);
      await expect(realShotFolder.locator('.image-card')).toHaveCount(3);
      await expect(realShotFolder.locator('.image-folder-count')).toHaveText('3 张');

      // 保存后服务端分类与数量一致：4 张旧图 + 粘贴 1 张 + 文件夹内上传 1 张
      await expect(page.getByRole('dialog').locator('button.button-primary', { hasText: '保存产品' })).toBeVisible();
      await page.getByRole('dialog').locator('button.button-primary').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const detail = await page.request.get(`/api/products/${product.id}`);
      const images = ((await detail.json()).data as { images: Array<{ category: string }> }).images;
      expect(images).toHaveLength(6);
      expect(images.filter((image) => image.category === 'customer')).toHaveLength(3);
    } finally {
      const cleanup = await page.request.delete(`/api/products/${product.id}`);
      expect(cleanup.ok()).toBeTruthy();
    }
  });

  test('图片浏览弹窗同样按文件夹分区，折叠后该组缩略图隐藏', async ({ page }) => {
    const stamp = Date.now();
    const product = await seedProductWithImages(page, stamp);
    try {
      await page.goto('/');
      await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
      await page.locator('.products-page .page-toolbar .search-control input').fill(product.sku);
      // 浏览弹窗从列表的图片按钮打开；桌面表格与手机卡片各有一份 DOM，取可见的那个。
      await page.locator('.product-image-button:visible').first().click();
      await expect(page.locator('.product-images-content')).toBeVisible();
      const folders = page.locator('.product-images-content .image-folder');
      // 只有实际有图的分类才出文件夹：精修图 3（含历史图）、实拍图 1。
      await expect(folders).toHaveCount(2);
      await expect(folders.filter({ has: page.locator('.image-folder-header:has-text("精修图")') }).locator('.product-image-thumbnail')).toHaveCount(3);
      await expect(folders.filter({ has: page.locator('.image-folder-header:has-text("实拍图")') }).locator('.product-image-thumbnail')).toHaveCount(1);

      const refineHeader = folders.filter({ has: page.locator('.image-folder-header:has-text("精修图")') }).locator('.image-folder-header');
      await refineHeader.click();
      await expect(folders.filter({ has: page.locator('.image-folder-header:has-text("精修图")') }).locator('.product-image-thumbnail')).toHaveCount(0);
      await refineHeader.click();
      await expect(folders.filter({ has: page.locator('.image-folder-header:has-text("精修图")') }).locator('.product-image-thumbnail')).toHaveCount(3);

      // 折叠不影响勾选与保存：全选仍覆盖全部图片
      await page.locator('.product-images-select-all').click();
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 4 / 4');
    } finally {
      const cleanup = await page.request.delete(`/api/products/${product.id}`);
      expect(cleanup.ok()).toBeTruthy();
    }
  });
});
