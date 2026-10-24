import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test('运费按体积重计费：点运费可改全局体积参数并立即重算', async ({ page }) => {
  // 统一从默认 8000 开始，避免受其他用例残留影响。
  expect((await page.request.put('/api/settings/volume-divisor', { data: { divisor: 8000 } })).ok()).toBe(true);
  const stamp = Date.now();
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E体积重${stamp}`,
      status: 'active',
      category: '电动工具',
      purchaseQuotes: [{ supplier: 'E2E供应商', variant: '', price: 100, isDefault: true }],
      // 外箱 60×50×40cm、10 台/箱、单台 0.5kg：
      // 8000 → 单台体积重 = 120000 ÷ 10 ÷ 8000 = 1.5kg（大于实重 0.5，按 1.5 计费）；
      // 6000 → 2kg（按 2 计费）。
      packaging: [{ name: '彩盒包装', packCount: 10, innerWeight: 0.5, outerSize: '60×50×40', purchasePrice: 0 }],
    },
  });
  expect(created.ok()).toBe(true);
  const product = (await created.json()).data as { id: number; sku: string };

  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
    await page.locator('.products-page .page-toolbar .search-control input').fill(product.sku);
    await page.waitForTimeout(500);
    await page.locator('.price-calc-entry:visible').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('售价计算');

    const hint = dialog.locator('.price-calc2-shipweight');
    await expect(hint).toContainText('实重 0.5kg');
    await expect(hint).toContainText('体积重 1.5kg');
    // 默认单价 1.5 元/kg → 1.5 × 1.5 = 2.25。
    await expect(dialog.getByLabel('运费金额')).toHaveValue('2.25');

    // 点运费金额打开体积参数弹窗：默认 8000。
    await dialog.getByLabel('运费金额').click();
    const volumeDialog = page.getByRole('dialog', { name: '运费体积参数' });
    await expect(volumeDialog).toBeVisible();
    await expect(volumeDialog.getByLabel('体积参数')).toHaveValue('8000');
    await expect(volumeDialog).toContainText('体积重 1.5kg');

    // 改成 6000 并保存：所有产品共用，本次计算立即按 2kg 计费 → 3 元。
    await volumeDialog.getByLabel('体积参数').fill('6000');
    await volumeDialog.getByRole('button', { name: /保存/ }).click();
    await expect(volumeDialog).toHaveCount(0);
    await expect(hint).toContainText('体积重 2kg');
    await expect(dialog.getByLabel('运费金额')).toHaveValue('3');
    expect((await (await page.request.get('/api/settings/volume-divisor')).json()).data.divisor).toBe(6000);

    // 没有外箱尺寸的产品退回实重：手动改回 8000 后在本用例里不再验，避免影响其他用例。
  } finally {
    await page.request.put('/api/settings/volume-divisor', { data: { divisor: 8000 } });
    await page.request.delete(`/api/products/${product.id}`);
  }
});
