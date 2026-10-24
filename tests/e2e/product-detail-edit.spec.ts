import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test('产品详情里点「编辑产品」直接打开同一个产品的编辑器', async ({ page }) => {
  const stamp = Date.now();
  const name = `E2E详情编辑${stamp}`;
  const created = await page.request.post('/api/products', {
    data: { name, status: 'active', packaging: [{ name: '彩盒包装', packCount: 10 }] },
  });
  expect(created.ok()).toBe(true);
  const product = (await created.json()).data as { id: string; sku: string };

  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
    await page.locator('.products-page .page-toolbar .search-control input').fill(product.sku);
    await expect(page.locator('.product-gallery-card')).toHaveCount(1);
    await page.locator('.product-gallery-open').first().click();

    const detail = page.getByRole('dialog', { name: /产品详情/ });
    await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: '编辑产品' }).click();
    // 详情关闭，编辑器打开，且带的是同一个产品。
    await expect(detail).toHaveCount(0);
    const editor = page.getByRole('dialog', { name: '编辑产品' });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel('品名')).toHaveValue(name);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});
