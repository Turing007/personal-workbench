import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test.describe.configure({ timeout: 120_000 });

/** 售价计算器：卡片左下角入口 → 弹窗试算 → 选择带价 → 保存方案 → 回显/载入/删除。 */
test('售价计算器：默认带价、选配件带价、保存方案、回显与载入删除', async ({ page }) => {
  const stamp = Date.now();
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E算价产品${stamp}`,
      supplier: 'E2E算价供应商',
      status: 'active',
      category: '电动工具',
      purchaseQuotes: [{ supplier: 'E2E算价供应商', variant: '', price: 46, isDefault: true }],
      packaging: [{ name: '彩盒包装', innerSize: '30*22*10', innerWeight: 0.8, outerSize: '62*40*25', outerWeight: 12, packCount: 24, purchasePrice: 3.2 }],
    },
  });
  expect(created.ok()).toBe(true);
  const product = (await created.json()).data as { id: number };
  // 三种来源：电池矩阵、充电器清单、类目（电动工具）配件——计算器里按行名各自匹配。
  expect((await page.request.put('/api/settings/charger-prices', { data: { items: [{ name: 'E2E充电器', price: 6 }] } })).ok()).toBe(true);
  expect((await page.request.put('/api/settings/battery-price-matrix', { data: { capacities: [1300], packCounts: [10], prices: [[8.5]] } })).ok()).toBe(true);
  expect((await page.request.put('/api/settings/category-accessory-prices', { data: { category: '电动工具', items: [{ name: '21V 2.0Ah 电池', price: 8.5 }] } })).ok()).toBe(true);

  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
    await page.locator('.products-page .search-control input').fill(`E2E算价产品${stamp}`);
    await expect(page.locator('.products-page .table-state')).toHaveCount(0);

    await page.locator('.products-page .price-calc-entry').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('售价计算');

    // 默认带价：默认档 46 + 包装采购价 3.2 → 合计 49.20，加价 20% → 59.04。
    await expect(dialog.getByLabel('成本1单价')).toHaveValue('46');
    await expect(dialog.getByLabel('成本2单价')).toHaveValue('3.2');
    await expect(dialog.getByTestId('price-calc-total')).toHaveText('¥49.20');
    await expect(dialog.getByTestId('price-calc-sale')).toHaveText('¥59.04');

    // 下拉按行过滤：包装行只出包装方式，不出电池/充电器。
    await dialog.getByLabel('为第 2 行选择包装方式').click();
    await expect(dialog.locator('.price-calc-picker-item', { hasText: '彩盒包装' })).toBeVisible();
    await expect(dialog.locator('.price-calc-picker-item', { hasText: '电池' })).toHaveCount(0);
    await dialog.getByLabel('为第 2 行选择包装方式').click();

    // 电池行：只出电池矩阵里已定价的「10 节 1300 电池」¥8.50；数量改 2 → 合计 66.20 / 售价 79.44。
    await dialog.getByLabel('为第 3 行选择电池价格').click();
    await expect(dialog.locator('.price-calc-picker-item', { hasText: '彩盒包装' })).toHaveCount(0);
    await dialog.locator('.price-calc-picker-item', { hasText: '10 节 1300 电池' }).click();
    await expect(dialog.getByLabel('成本3名称')).toHaveValue('10 节 1300 电池');
    await expect(dialog.getByLabel('成本3单价')).toHaveValue('8.5');
    await dialog.getByLabel('成本3数量').fill('2');
    await expect(dialog.getByTestId('price-calc-total')).toHaveText('¥66.20');
    await expect(dialog.getByTestId('price-calc-sale')).toHaveText('¥79.44');

    // 充电器行：只出充电器价格（不出包装/电池）。
    await dialog.getByLabel('为第 4 行选择充电器价格').click();
    await expect(dialog.locator('.price-calc-picker-item', { hasText: '彩盒包装' })).toHaveCount(0);
    await expect(dialog.locator('.price-calc-picker-item', { hasText: '10 节 1300 电池' })).toHaveCount(0);
    await dialog.locator('.price-calc-picker-item', { hasText: 'E2E充电器' }).click();
    await expect(dialog.getByLabel('成本4单价')).toHaveValue('6');

    // 配件行：只出本类目配件（电动工具）。
    await dialog.getByLabel('为第 5 行选择本类目配件（电动工具）').click();
    await expect(dialog.locator('.price-calc-picker-item', { hasText: '21V 2.0Ah 电池' })).toBeVisible();
    await expect(dialog.locator('.price-calc-picker-item', { hasText: '彩盒包装' })).toHaveCount(0);
    await dialog.getByLabel('为第 5 行选择本类目配件（电动工具）').click();

    // 目标售价反看毛利率：66.20+6=72.20 成本，目标 100 → 27.8%。
    await dialog.getByLabel('目标售价').fill('100');
    await expect(dialog.getByTestId('price-calc-margin')).toHaveText('毛利率 27.8%');

    // 保存方案：右侧出现历史（名称 + 售价）。
    await dialog.getByLabel('方案名').fill('E2E双电方案');
    await dialog.getByRole('button', { name: '保存为方案' }).click();
    await expect(dialog.locator('.price-calc-plan', { hasText: 'E2E双电方案' })).toBeVisible();
    await expect(dialog.locator('.price-calc-plan', { hasText: 'E2E双电方案' })).toContainText('¥86.64');

    // 关掉重开：自动回显最近一份方案（电池行的选择都在）。
    await dialog.getByRole('button', { name: '关闭' }).click();
    await page.locator('.products-page .price-calc-entry').first().click();
    const reopened = page.getByRole('dialog');
    await expect(reopened.getByLabel('成本3名称')).toHaveValue('10 节 1300 电池');
    await expect(reopened.getByTestId('price-calc-total')).toHaveText('¥72.20');

    // 再存一份改过加价率的，然后载入旧的那份回看。
    await reopened.getByLabel('加价率').fill('0');
    await expect(reopened.getByTestId('price-calc-sale')).toHaveText('¥72.20');
    await reopened.getByLabel('方案名').fill('E2E平价方案');
    await reopened.getByRole('button', { name: '保存为方案' }).click();
    await expect(reopened.locator('.price-calc-plan')).toHaveCount(2);
    await reopened.locator('.price-calc-plan', { hasText: 'E2E双电方案' }).getByRole('button', { name: '载入' }).click();
    await expect(reopened.getByLabel('加价率')).toHaveValue('20');
    await expect(reopened.getByTestId('price-calc-sale')).toHaveText('¥86.64');

    // 删除方案（二次确认自动同意）。
    page.once('dialog', (confirm) => void confirm.accept());
    await reopened.locator('.price-calc-plan', { hasText: 'E2E平价方案' }).getByRole('button', { name: /删除方案/ }).click();
    await expect(reopened.locator('.price-calc-plan', { hasText: 'E2E平价方案' })).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
    await page.request.put('/api/settings/charger-prices', { data: { items: [] } });
    await page.request.put('/api/settings/battery-price-matrix', { data: { capacities: [], packCounts: [], prices: [] } });
    await page.request.put('/api/settings/category-accessory-prices', { data: { category: '电动工具', items: [] } });
  }
});
