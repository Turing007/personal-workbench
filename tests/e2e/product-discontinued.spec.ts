import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';
import { useProductListView } from './helpers/products-view';

let sessionCookie: string;
const stamp = Date.now();

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

async function seedProduct(page: Page, name: string) {
  const created = await page.request.post('/api/products', {
    data: { name, status: 'active', category: `E2E停售类${stamp}`, packaging: [{ name: '彩盒包装', innerSize: '10×5×3', innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8, packCount: 24 }] },
  });
  if (!created.ok()) throw new Error(`创建产品失败：HTTP ${created.status()}`);
  return (await created.json()).data as { id: string; sku: string; name: string };
}

async function openProducts(page: Page, query: string) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(query);
}

const statusFilter = (page: Page) => page.locator('.products-page select[aria-label="产品状态筛选"]');

test('三种视图都不再有删除按钮', async ({ page }) => {
  const product = await seedProduct(page, `E2E无删除入口${stamp}`);
  try {
    // 大图（默认视图）。
    await openProducts(page, product.sku);
    await expect(page.locator('.products-gallery .product-gallery-card')).toHaveCount(1);
    await expect(page.locator('.products-gallery [title="删除产品"]')).toHaveCount(0);

    // 桌面表格。
    await page.locator('.products-page .products-view-toggle').click();
    await expect(page.locator('.products-table-desktop tbody tr')).toHaveCount(1);
    await expect(page.locator('.products-table-desktop [title="删除产品"]')).toHaveCount(0);
    // 表格里的编辑与复制还在。
    await expect(page.locator('.products-table-desktop [title="编辑产品"]')).toHaveCount(1);
    await expect(page.locator('.products-table-desktop [title="复制产品为新建产品"]')).toHaveCount(1);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('手机卡片列表也没有删除按钮', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const context = page.context();
  await useProductListView(context);
  const product = await seedProduct(page, `E2E手机无删除${stamp}`);
  try {
    await page.goto('/');
    await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
    await page.locator('.products-page .page-toolbar .search-control input').fill(product.sku);
    await expect(page.locator('.products-card-list .product-card:visible')).toHaveCount(1);
    await expect(page.locator('.products-card-list [title="删除产品"]')).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('详情页停售 → 列表灰标与筛选 → 恢复在售', async ({ page }) => {
  const product = await seedProduct(page, `E2E停售流程${stamp}`);
  try {
    await openProducts(page, product.sku);
    await page.locator('.products-gallery .product-gallery-open').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // 在售产品看到的是「停售」，还没有「恢复在售」。
    await expect(dialog.getByRole('button', { name: '停售' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '恢复在售' })).toHaveCount(0);

    page.once('dialog', (confirmation) => void confirmation.accept());
    await dialog.getByRole('button', { name: '停售' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 列表上出现灰色「停售」标，默认仍然显示（不用切筛选就能看见）。
    const card = page.locator('.products-gallery .product-gallery-card', { hasText: product.sku });
    await expect(card.locator('.badge-neutral', { hasText: '停售' })).toHaveCount(1);

    // 状态筛选里能单独看停售与在售。
    await statusFilter(page).selectOption('discontinued');
    await expect(card).toHaveCount(1);
    await statusFilter(page).selectOption('active');
    await expect(page.locator('.products-gallery .product-gallery-card')).toHaveCount(0);
    await statusFilter(page).selectOption('all');
    await expect(card).toHaveCount(1);

    // 再进详情，按钮换成「恢复在售」，点一下回到在售。
    await card.locator('.product-gallery-open').click();
    await expect(dialog.getByRole('button', { name: '恢复在售' })).toBeVisible();
    await dialog.getByRole('button', { name: '恢复在售' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(card.locator('.badge-neutral')).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('编辑停售产品保存后仍是停售', async ({ page }) => {
  const product = await seedProduct(page, `E2E停售编辑${stamp}`);
  try {
    await page.request.post(`/api/products/${product.id}/status`, { data: { status: 'discontinued' } });
    await openProducts(page, product.sku);
    await page.locator('.products-gallery button[title="编辑产品"]').click();
    const editor = page.getByRole('dialog');
    await editor.getByRole('textbox', { name: '品名' }).fill(`E2E停售改过${stamp}`);
    await editor.getByRole('button', { name: '保存产品' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const card = page.locator('.products-gallery .product-gallery-card', { hasText: product.sku });
    await expect(card).toContainText(`E2E停售改过${stamp}`);
    await expect(card.locator('.badge-neutral', { hasText: '停售' })).toHaveCount(1);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('详情页可以删除产品，取消确认则不删', async ({ page }) => {
  const kept = await seedProduct(page, `E2E删除取消${stamp}`);
  const gone = await seedProduct(page, `E2E删除确认${stamp}`);
  try {
    await openProducts(page, `E2E删除`);
    await expect(page.locator('.products-gallery .product-gallery-card')).toHaveCount(2);

    // 先取消：产品还在。
    await page.locator('.products-gallery .product-gallery-card', { hasText: kept.sku }).locator('.product-gallery-open').click();
    page.once('dialog', (confirmation) => void confirmation.dismiss());
    await page.getByRole('dialog').getByRole('button', { name: '删除产品' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.getByRole('dialog').locator('.modal-close').click();
    await expect(page.locator('.products-gallery .product-gallery-card', { hasText: kept.sku })).toHaveCount(1);

    // 再确认：产品消失。
    await page.locator('.products-gallery .product-gallery-card', { hasText: gone.sku }).locator('.product-gallery-open').click();
    page.once('dialog', (confirmation) => void confirmation.accept());
    await page.getByRole('dialog').getByRole('button', { name: '删除产品' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.products-gallery .product-gallery-card', { hasText: gone.sku })).toHaveCount(0);
  } finally {
    for (const product of [kept, gone]) await page.request.delete(`/api/products/${product.id}`).catch(() => undefined);
  }
});
