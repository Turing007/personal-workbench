import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test('配件带重量：编辑器可维护，计算器自动计入配件价格与实重', async ({ page }) => {
  expect((await page.request.put('/api/settings/volume-divisor', { data: { divisor: 8000 } })).ok()).toBe(true);
  const stamp = Date.now();
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E配件计费${stamp}`,
      status: 'active',
      category: '电锤',
      purchaseQuotes: [{ supplier: 'E2E供应商', variant: '', price: 100, isDefault: true }],
      // 产品 0.5kg + 配件 0.5kg = 实重 1kg；外箱 120000cm³ ÷ 10 台 ÷ 8000 = 抛重 1.5kg → 按 1.5kg 计运费。
      packaging: [{ name: '彩盒包装', packCount: 10, innerWeight: 0.5, outerSize: '60×50×40', purchasePrice: 0 }],
      accessoryPrices: [
        { name: '套筒', price: 10.25, weight: 0.4 },
        { name: '说明书', price: 0, weight: 0.1 },
      ],
    },
  });
  expect(created.ok()).toBe(true);
  const product = (await created.json()).data as { id: number; sku: string };

  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
    await page.locator('.products-page .page-toolbar .search-control input').fill(product.sku);
    await page.waitForTimeout(500);

    // 编辑器：配件表带「重量 kg」列，已保存的重量回显正确。
    await page.locator('button[title="编辑产品"]:visible').first().click();
    const editor = page.getByRole('dialog', { name: /编辑产品/ });
    await expect(editor.getByLabel('产品配件1重量')).toHaveValue('0.4');
    await expect(editor.getByLabel('产品配件2重量')).toHaveValue('0.1');
    await editor.getByRole('button', { name: '取消' }).click();
    await expect(editor).toHaveCount(0);

    // 计算器：自动带出配件汇总；实重 1kg、抛重 1.5kg，运费 1.5 × 1.5 = 2.25。
    await page.locator('.price-calc-entry:visible').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('售价计算');
    await expect(dialog.locator('.price-calc2-accessories-head')).toContainText('¥10.25 · 0.5kg');
    await expect(dialog.locator('.price-calc2-accessories-list')).toContainText('套筒 ¥10.25 · 0.4kg');
    await expect(dialog.locator('.price-calc2-accessories-list')).toContainText('说明书 · 0.1kg');
    await expect(dialog.locator('.price-calc2-shipweight')).toContainText('实重 1kg');
    await expect(dialog.locator('.price-calc2-shipweight')).toContainText('抛重 1.5kg');
    await expect(dialog.getByLabel('运费金额')).toHaveValue('2.25');
    // 成本 = 采购 100 + 配件 10.25 + 运费 2.25 = 112.5（毛利默认 0）。
    await expect(dialog.locator('.price-calc2-bare')).toContainText('成本 ¥112.5');

    // 保存方案：服务端按明细重算，配件价必须一并计入。
    await dialog.getByLabel('毛利率').fill('0');
    await dialog.getByLabel('方案名').fill('配件计费方案');
    await dialog.getByRole('button', { name: '保存为方案' }).click();
    const planCard = dialog.locator('.price-calc-plan', { hasText: '配件计费方案' });
    await expect(planCard).toContainText('裸机 ¥112.5');
    await expect(planCard).toContainText('毛利 ¥0');
  } finally {
    await page.request.put('/api/settings/volume-divisor', { data: { divisor: 8000 } });
    await page.request.delete(`/api/products/${product.id}`);
  }
});
