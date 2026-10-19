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

async function seedSystemProductWithImage(page: Page, stamp: number) {
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E系统产品${stamp}`,
      sku: '',
      status: 'active',
      packaging: [{ name: '彩盒包装', innerSize: '10×5×3', innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8, packCount: 24 }],
    },
  });
  if (!created.ok()) throw new Error(`创建系统产品失败：HTTP ${created.status()}`);
  const product = (await created.json()).data as { id: string; sku: string };
  const uploaded = await page.request.post(`/api/products/${product.id}/images?category=product`, {
    multipart: { file: { name: `system-${stamp}.png`, mimeType: 'image/png', buffer: PNG_1X1 } },
  });
  if (!uploaded.ok()) throw new Error(`上传系统产品图片失败：HTTP ${uploaded.status()}`);
  return product;
}

async function seedCustomer(page: Page, stamp: number) {
  const created = await page.request.post('/api/customers', {
    data: { name: `E2E图片删除客户${stamp}`, contactName: '张三', contactPhone: '13900000001', shippingInfo: '杭州市西湖区' },
  });
  if (!created.ok()) throw new Error(`创建客户失败：HTTP ${created.status()}`);
  return (await created.json()).data as { id: number };
}

async function openCustomerProducts(page: Page, customerName: string) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '客户', exact: true }).click();
  await page.locator('.customer-list-item:visible').filter({ hasText: customerName }).first().click();
  await expect(page.locator('.customer-products-panel')).toBeVisible();
}

test('客户产品：同一系统 SKU 可匹配多条，且删掉借用的系统图后不会复活', async ({ page }) => {
  const stamp = Date.now();
  const system = await seedSystemProductWithImage(page, stamp);
  const customer = await seedCustomer(page, stamp);
  const secondProduct = await page.request.post('/api/products', {
    data: {
      name: `E2E系统产品二${stamp}`,
      sku: '',
      status: 'active',
      packaging: [{ name: '彩盒包装', innerSize: '', innerWeight: 0, outerSize: '', outerWeight: 0, packCount: 12 }],
    },
  });
  const second = (await secondProduct.json()).data as { id: string };
  try {
    // 同一客户连续两次导入同一个系统产品：现在应都成功（不同规格各一条）。
    const firstImport = await page.request.post(`/api/customers/${customer.id}/products/from-library`, { data: { systemProductId: Number(system.id) } });
    expect(firstImport.status(), await firstImport.text()).toBe(201);
    const firstId = ((await firstImport.json()).data as { id: number }).id;
    const secondImport = await page.request.post(`/api/customers/${customer.id}/products/from-library`, { data: { systemProductId: Number(system.id) } });
    expect(secondImport.status(), await secondImport.text()).toBe(201);

    await openCustomerProducts(page, `E2E图片删除客户${stamp}`);
    // 两条同名客户产品都在（匹配同一系统 SKU）。
    const rows = page.locator('.customer-products-table-desktop tbody tr', { hasText: `E2E系统产品${stamp}` });
    await expect(rows).toHaveCount(2);

    // 借用的系统图：编辑器里能看见，删掉保存后不再回退显示系统首图。
    await rows.first().getByRole('button', { name: '编辑客户产品' }).click();
    const editor = page.getByRole('dialog');
    await expect(editor).toBeVisible();
    const imageCard = editor.locator('.image-card').first();
    await expect(imageCard).toBeVisible();
    await imageCard.getByRole('button', { name: '删除图片' }).click();
    await expect(editor.locator('.image-card')).toHaveCount(0);
    await editor.getByRole('button', { name: '保存产品' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 列表里这张产品不再有图，刷新后依旧没有（不是假删除）。
    const firstRow = page.locator('.customer-products-table-desktop tbody tr').first();
    await expect(firstRow.locator('td').nth(2).locator('img')).toHaveCount(0);
    const list = await page.request.get(`/api/customers/${customer.id}/products`);
    const saved = (await list.json()).data.items as Array<{ id: number; imageRelativePath: string | null }>;
    expect(saved).toHaveLength(2);
    // 只清掉被编辑的那条；另一条仍在借用系统首图。
    expect(saved.filter((item) => item.imageRelativePath === null)).toHaveLength(1);
    expect(saved.filter((item) => item.imageRelativePath?.startsWith('product-images/'))).toHaveLength(1);

    // 系统产品自己的图片不能被连带删除。
    const systemDetail = await page.request.get(`/api/products/${system.id}`);
    expect(((await systemDetail.json()).data as { images: unknown[] }).images).toHaveLength(1);

    // 另一条客户产品仍可正常关联系统产品（多对一没有破坏原有映射）。
    const other = await page.request.post('/api/customers', { data: { name: `E2E图片删除客户B${stamp}`, contactName: '', contactPhone: '', shippingInfo: '' } });
    const otherCustomer = (await other.json()).data as { id: number };
    const linked = await page.request.post(`/api/customers/${otherCustomer.id}/products/from-library`, { data: { systemProductId: Number(second.id) } });
    expect(linked.status()).toBe(201);
    await page.request.delete(`/api/customers/${otherCustomer.id}`);
  } finally {
    await page.request.delete(`/api/customers/${customer.id}`);
    await page.request.delete(`/api/products/${system.id}`);
    await page.request.delete(`/api/products/${second.id}`);
  }
});

test('客户产品：删掉自有的客户图后再保存，也不会回退系统图', async ({ page }) => {
  const stamp = Date.now();
  const system = await seedSystemProductWithImage(page, stamp);
  const customer = await seedCustomer(page, stamp);
  try {
    const imported = await page.request.post(`/api/customers/${customer.id}/products/from-library`, { data: { systemProductId: Number(system.id) } });
    const customerProduct = (await imported.json()).data as { id: number };
    // 先给客户产品传一张自己的图。
    const uploaded = await page.request.post(`/api/customer-products/${customerProduct.id}/images`, {
      multipart: { file: { name: `own-${stamp}.png`, mimeType: 'image/png', buffer: PNG_1X1 } },
    });
    expect(uploaded.status(), await uploaded.text()).toBe(201);

    await openCustomerProducts(page, `E2E图片删除客户${stamp}`);
    const row = page.locator('.customer-products-table-desktop tbody tr').first();
    await expect(row.locator('img')).toHaveCount(1);
    await row.getByRole('button', { name: '编辑客户产品' }).click();
    const editor = page.getByRole('dialog');
    await expect(editor.locator('.image-card')).toHaveCount(1);
    await editor.locator('.image-card').first().getByRole('button', { name: '删除图片' }).click();
    await editor.getByRole('button', { name: '保存产品' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const detail = await page.request.get(`/api/customer-products/${customerProduct.id}`);
    expect((await detail.json()).data.imageRelativePath).toBeNull();
    await expect(page.locator('.customer-products-table-desktop tbody tr').first().locator('img')).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/customers/${customer.id}`);
    await page.request.delete(`/api/products/${system.id}`);
  }
});
