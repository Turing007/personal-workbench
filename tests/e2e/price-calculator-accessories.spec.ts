import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test('配件默认不选：勾选后价格进成本、重量进实重，方案保存与载入还原选择', async ({ page }) => {
  expect((await page.request.put('/api/settings/volume-divisor', { data: { divisor: 8000 } })).ok()).toBe(true);
  const stamp = Date.now();
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E配件计费${stamp}`,
      status: 'active',
      category: '电锤',
      purchaseQuotes: [{ supplier: 'E2E供应商', variant: '', price: 100, isDefault: true }],
      // 产品 0.5kg + 配件 0.5kg = 实重 1kg；外箱 120000cm³ ÷ 10 台 ÷ 8000 = 体积重 1.5kg → 按 1.5kg 计运费。
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

    // 计算器：配件默认不选（成本只含采购价与运费）。
    // 实重 0.5kg < 体积重 1.5kg → 运费 1.5 × 1.5 = 2.25；成本 102.25（界面按 0.5 取整显示 102.5）。
    await page.locator('.price-calc-entry:visible').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('售价计算');
    const accessoryTrigger = dialog.getByRole('button', { name: '选择配件' });
    await expect(accessoryTrigger).toContainText('未选择');
    await expect(dialog.locator('.price-calc2-accessories-head')).toContainText('未选');
    await expect(dialog.locator('.price-calc2-accessories-list')).toHaveCount(0);
    await expect(dialog.locator('.price-calc2-shipweight')).toContainText('实重 0.5kg');
    await expect(dialog.locator('.price-calc2-shipweight')).toContainText('体积重 1.5kg');
    await expect(dialog.getByLabel('运费金额')).toHaveValue('2.25');
    await expect(dialog.locator('.price-calc2-bare')).toContainText('成本 ¥102.5');

    // 下拉幕布里全选：配件价与重量一起计入；实重 1kg、体积重 1.5kg，运费仍是 2.25。
    await accessoryTrigger.click();
    const curtain = dialog.getByRole('group', { name: '选择配件' });
    await expect(curtain).toContainText('选择配件（价格与重量一起计入）');
    await expect(curtain.getByRole('button', { name: /^套筒/ })).toHaveAttribute('aria-pressed', 'false');
    await curtain.getByRole('button', { name: '全选' }).click();
    await expect(accessoryTrigger).toContainText('全部 2 项');
    await expect(dialog.locator('.price-calc2-accessories-head')).toContainText('¥10.25 · 0.5kg');
    await expect(dialog.locator('.price-calc2-accessories-list')).toContainText('套筒、说明书');
    await expect(dialog.locator('.price-calc2-shipweight')).toContainText('实重 1kg');
    await expect(dialog.getByLabel('运费金额')).toHaveValue('2.25');
    // 成本 = 采购 100 + 配件 10.25 + 运费 2.25 = 112.5（毛利默认 0）。
    await expect(dialog.locator('.price-calc2-bare')).toContainText('成本 ¥112.5');

    // 取消「套筒」：只剩说明书 0.1kg，配件价归零。
    // 实重 0.6kg < 体积重 1.5kg，运费仍是 2.25；成本 = 100 + 2.25 = 102.25（界面按 0.5 取整显示 102.5）。
    await curtain.getByRole('button', { name: /^套筒/ }).click();
    await expect(accessoryTrigger).toContainText('已选 1/2 项');
    await expect(dialog.locator('.price-calc2-accessories-head')).toContainText('¥0 · 0.1kg');
    await expect(dialog.locator('.price-calc2-shipweight')).toContainText('实重 0.6kg');
    await expect(dialog.locator('.price-calc2-bare')).toContainText('成本 ¥102.5');
    await curtain.getByRole('button', { name: '完成' }).click();
    await expect(curtain).toHaveCount(0);

    // 保存方案：服务端按明细重算，配件价必须与当前选择一致（这次只有说明书，0 元）。
    await dialog.getByLabel('毛利率').fill('0');
    await dialog.getByLabel('方案名').fill('配件计费方案');
    await dialog.getByRole('button', { name: '保存为方案' }).click();
    const planCard = dialog.locator('.price-calc-plan', { hasText: '配件计费方案' });
    await expect(planCard).toContainText('裸机 ¥102.5');
    await expect(planCard).toContainText('毛利 ¥0');

    // 载入方案：配件选择按名称还原（方案里存的是「只要说明书」），结果与保存时一致。
    await accessoryTrigger.click();
    await curtain.getByRole('button', { name: '清空' }).click();
    await expect(accessoryTrigger).toContainText('未选择');
    await curtain.getByRole('button', { name: '完成' }).click();
    await planCard.getByRole('button', { name: '载入' }).click();
    await expect(accessoryTrigger).toContainText('已选 1/2 项');
    await expect(dialog.locator('.price-calc2-accessories-head')).toContainText('¥0 · 0.1kg');
    await expect(dialog.locator('.price-calc2-bare')).toContainText('成本 ¥102.5');
  } finally {
    await page.request.put('/api/settings/volume-divisor', { data: { divisor: 8000 } });
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('计算器只列本产品自己的配件：同类目默认配件不混进来', async ({ page }) => {
  const stamp = Date.now();
  const category = `E2E配件类目${stamp}`;
  // 类目默认配件只用于新建产品时的预填，不该出现在没维护过配件的产品的计算器里。
  expect((await page.request.put('/api/settings/category-accessory-prices', {
    data: { category, items: [{ name: '类目默认套筒', price: 6 }, { name: '类目默认锯片', price: 8 }] },
  })).ok()).toBe(true);
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E无自有配件${stamp}`,
      status: 'active',
      category,
      purchaseQuotes: [{ supplier: 'E2E供应商', variant: '', price: 50, isDefault: true }],
      packaging: [{ name: '彩盒包装', packCount: 10, innerWeight: 0.5, purchasePrice: 0 }],
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

    const accessoryTrigger = dialog.getByRole('button', { name: '选择配件' });
    await expect(accessoryTrigger).toContainText('无配件');
    await expect(dialog.locator('.price-calc2-accessories-head')).toContainText('无');
    // 打开幕布也看不到类目默认那两条。
    await accessoryTrigger.click();
    const curtain = dialog.getByRole('group', { name: '选择配件' });
    await expect(curtain).toContainText('本产品还没有配件');
    await expect(curtain).not.toContainText('类目默认套筒');
    await expect(curtain).not.toContainText('类目默认锯片');
    await curtain.getByRole('button', { name: '完成' }).click();

    // 没配件时成本只含采购价与运费：0.5kg × 1.5 = 0.75。
    await expect(dialog.getByLabel('运费金额')).toHaveValue('0.75');
    await expect(dialog.locator('.price-calc2-bare')).toContainText('成本 ¥51');
  } finally {
    await page.request.put('/api/settings/category-accessory-prices', { data: { category, items: [] } });
    await page.request.delete(`/api/products/${product.id}`);
  }
});
