import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

/**
 * 回归：保存产品时「该删哪些图片」必须按服务端现状算。
 * 旧实现拿前端列表快照做差，编辑器开着时图片被别处删过（手机、另一个标签页、上一次失败的保存），
 * 就会对已经不存在的 id 发 DELETE，404 把整个保存打断在上传新图之前，产品图永远换不上。
 */
let sessionCookie: string;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const stamp = Date.now();

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

async function seedProduct(page: Page, imageCount: number) {
  const response = await page.request.post('/api/products', {
    data: { name: `E2E图片同步${stamp}`, status: 'active', packaging: [{ name: '彩盒包装', packCount: 10 }] },
  });
  if (!response.ok()) throw new Error(`创建产品失败：HTTP ${response.status()}`);
  const product = (await response.json()).data as { id: number; sku: string };
  const imageIds: number[] = [];
  for (let index = 0; index < imageCount; index += 1) {
    const uploaded = await page.request.post(`/api/products/${product.id}/images`, {
      multipart: { file: { name: `旧图${index}.png`, mimeType: 'image/png', buffer: PNG } },
    });
    imageIds.push((await uploaded.json()).data.id);
  }
  return { ...product, imageIds };
}

async function openEditor(page: Page, sku: string) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(sku);
  await page.locator('.products-page button[title="编辑产品"]:visible').first().click();
  const editor = page.getByRole('dialog');
  await expect(editor).toBeVisible();
  return editor;
}

async function deleteAllImages(editor: Locator) {
  while (await editor.locator('[aria-label="删除图片"]').count()) {
    await editor.locator('[aria-label="删除图片"]').first().click();
    await editor.page().waitForTimeout(120);
  }
}

async function serverImageNames(page: Page, id: number) {
  const response = await page.request.get(`/api/products/${id}`);
  return ((await response.json()).data.images as Array<{ originalName: string }>).map((item) => item.originalName);
}

test('编辑器打开后图片被别处删过，仍能删光重传并保存成功', async ({ page }) => {
  const product = await seedProduct(page, 3);
  try {
    const editor = await openEditor(page, product.sku);
    // 模拟另一个入口（手机 / 另一个标签页 / 上一次失败的保存）把列表里的一张图删掉。
    await page.request.delete(`/api/products/${product.id}/images/${product.imageIds[0]}`);

    await deleteAllImages(editor);
    await editor.locator('input[type=file]').first().setInputFiles([{ name: '新图.png', mimeType: 'image/png', buffer: PNG }]);
    await expect(editor.locator('[aria-label="删除图片"]')).toHaveCount(1);

    await editor.getByRole('button', { name: '保存产品' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // 保存会立刻弹一条「产品已保存，N 个文件正在后台上传」；上传完成后还会再弹一条，
    // 所以这里按文本过滤，不能用未过滤的 .toast（会同时命中两条）。
    await expect(page.locator('.toast', { hasText: '产品已保存' })).toBeVisible();

    // 上传改成后台队列后，编辑器先关、图片随后才到，所以这里要等结果而不是立刻读。
    // 旧图全部清掉、新图进来：不再卡在「产品图片不存在」。
    await expect.poll(() => serverImageNames(page, product.id), { timeout: 20_000, message: '新图该在后台传完并落库' })
      .toEqual(['新图.png']);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('连点保存不会把同一张图传两遍', async ({ page }) => {
  const product = await seedProduct(page, 2);
  try {
    const editor = await openEditor(page, product.sku);
    await deleteAllImages(editor);
    await editor.locator('input[type=file]').first().setInputFiles([{ name: '一张.png', mimeType: 'image/png', buffer: PNG }]);
    await expect(editor.locator('[aria-label="删除图片"]')).toHaveCount(1);

    const uploads: string[] = [];
    page.on('request', (request) => {
      if (/^\/api\/products\/\d+\/images$/.test(new URL(request.url()).pathname) && request.method() === 'POST') {
        uploads.push(request.url());
      }
    });

    const saveButton = editor.locator('.modal-footer button.button-primary');
    await saveButton.click();
    // 第二次点击落在禁用态上：Playwright 会因元素不可用而拒绝，正是我们要的行为，超时收掉即可。
    await saveButton.click({ timeout: 500 }).catch(() => {});

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => serverImageNames(page, product.id), { timeout: 20_000 }).toEqual(['一张.png']);
    // 真正的不可变量：同一张图只发过一次上传请求（连点没有让它重跑一遍）。
    expect(uploads).toHaveLength(1);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});
