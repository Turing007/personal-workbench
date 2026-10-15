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
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * 售价计算器（矩阵口径）：左参数自动带价 → 右侧按电池矩阵整表出成本/售价 →
 * 点售价复制「5节1300mah 一电一充 126.5元」→ 保存方案/载入回显/删除。
 * 价格显示口径：四舍五入到 0.5，最多一位小数。
 */
test('售价计算器：矩阵算价、点售价复制、保存方案与载入回显', async ({ page }) => {
  const stamp = Date.now();
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E矩阵算价${stamp}`,
      supplier: 'E2E算价供应商',
      status: 'active',
      category: '电动工具',
      purchaseQuotes: [{ supplier: 'E2E算价供应商', variant: '', price: 100, isDefault: true }],
      // 内盒重量 0.9kg：运费自动预估按它算产品部分（裸机 0.9×1.5 = 1.35）。
      packaging: [{ name: '彩盒包装', packCount: 24, innerWeight: 0.9, purchasePrice: 0 }],
    },
  });
  expect(created.ok()).toBe(true);
  const product = (await created.json()).data as { id: number };
  // 产品图：计算器顶部要显示，方便发给客户时一眼看清是哪个产品。
  expect((await page.request.post(`/api/products/${product.id}/images?category=product`, {
    multipart: { file: { name: 'e2e-calc.png', mimeType: 'image/png', buffer: PNG_1X1 } },
  })).ok()).toBe(true);
  expect((await page.request.put('/api/settings/charger-prices', { data: { items: [{ name: 'E2E小线充', price: 2 }, { name: 'E2E大座充', price: 5 }] } })).ok()).toBe(true);
  // 1500 × 10 节故意留空：矩阵里没定价的格子显示 —。
  expect((await page.request.put('/api/settings/battery-price-matrix', { data: { capacities: [1300, 1500], packCounts: [5, 10], prices: [[8, 14], [9, 0]] } })).ok()).toBe(true);

  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
    await page.locator('.products-page .search-control input').fill(`E2E矩阵算价${stamp}`);
    await expect(page.locator('.products-page .table-state')).toHaveCount(0);
    await page.locator('.products-page .price-calc-entry').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('售价计算');
    // 顶部：产品图 + 名称 + SKU/分类。
    await expect(dialog.locator('.price-calc2-thumb')).toBeVisible();
    await expect(dialog.locator('.price-calc2-head')).toContainText(`E2E矩阵算价${stamp}`);

    // 左参数：采购价从默认档自动带出；毛利率改 15。
    // 运费默认自动：裸机 = 内盒重量 0.9kg × 单价 1.5 = 1.35 → 成本 101.5 / 售价 116.5 / 毛利 15。
    await expect(dialog.getByLabel('采购价')).toHaveValue('100');
    await dialog.getByLabel('毛利率').fill('15');
    const bare = dialog.locator('.price-calc2-bare');
    await expect(bare).toContainText('¥101.5');
    await expect(bare).toContainText('¥116.5');
    await expect(bare).toContainText('毛利 ¥15');

    // 矩阵：按设置生成容量行与组合列；充电器默认第一条（¥2）。
    // 自动运费把电池与充电器重量也算进去（5节 0.3kg / 10节 0.5kg / 充电器 0.05kg，单价 1.5）：
    // 5节一电一充 计费 0.9+0.3+0.05=1.25kg → 运费 1.88 → (100+1.88+8+2)×1.15 = 128.66 → 128.5。
    const saleCell = (name: string) => dialog.getByLabel(name);
    await expect(saleCell('复制售价 5节1300mah 一电一充 128.5元')).toHaveText('128.5');
    await expect(saleCell('复制售价 5节1300mah 两电一充 138.5元')).toHaveText('138.5');
    await expect(saleCell('复制售价 5节1500mah 一电一充 130元')).toHaveText('130');
    // 含电池套装也显示毛利：5节一电一充 128.66 − 111.88 = 16.78 → 17。
    const firstCombo = dialog.locator('.battery-price-table tbody tr', { hasText: '1300mAh' }).first();
    await expect(firstCombo.locator('.battery-price-profit').first()).toHaveText('17');
    // 1500 × 10 节没定价：一电一充/两电一充两列的成本/售价/毛利共 6 格都显示 —。
    await expect(dialog.locator('.battery-price-table tbody tr', { hasText: '1500mAh' }).locator('td', { hasText: '—' })).toHaveCount(6);

    // 切充电器到大座充 ¥5：5节1300一电一充 → (100+1.88+8+5)×1.15 = 132.11 → 132。
    await dialog.getByLabel('充电器').selectOption({ label: 'E2E大座充 ¥5' });
    await expect(saleCell('复制售价 5节1300mah 一电一充 132元')).toHaveText('132');
    await dialog.getByLabel('充电器').selectOption({ label: 'E2E小线充 ¥2' });

    // 点售价复制：自动带上配置名与「元」，剪贴板内容一致。
    await saleCell('复制售价 5节1300mah 一电一充 128.5元').click();
    await expect(dialog.locator('.price-calc-message')).toContainText('已复制：5节1300mah 一电一充 128.5元');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('5节1300mah 一电一充 128.5元');

    // 裸机售价也能复制。
    await dialog.getByLabel('复制裸机售价 116.5元').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('裸机 116.5元');

    // 小眼睛：隐藏全部成本后只剩售价——成本列、毛利列、参数区、方案区收起，产品名与图仍在，售价仍可复制。
    await dialog.getByRole('button', { name: '隐藏成本（发客户截图用）' }).click();
    await expect(dialog.locator('.battery-price-table th', { hasText: '成本' })).toHaveCount(0);
    await expect(dialog.locator('.battery-price-table th', { hasText: '毛利' })).toHaveCount(0);
    await expect(dialog.locator('.battery-price-profit')).toHaveCount(0);
    await expect(dialog.getByLabel('采购价')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '保存为方案' })).toHaveCount(0);
    await expect(dialog.locator('.price-calc2-head')).toContainText(`E2E矩阵算价${stamp}`);
    await expect(dialog.locator('.price-calc2-thumb')).toBeVisible();
    await saleCell('复制售价 5节1300mah 一电一充 128.5元').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('5节1300mah 一电一充 128.5元');
    // 再点回来恢复显示（每次打开也默认显示）。
    await dialog.getByRole('button', { name: '显示成本' }).click();
    await expect(dialog.getByLabel('采购价')).toHaveValue('100');
    await expect(dialog.getByRole('button', { name: '保存为方案' })).toBeVisible();

    // 运费预估：默认自动、单价 1.5、运费只读显示裸机值 1.35、跟随计费重量提示。
    await expect(dialog.getByLabel('运费单价')).toHaveValue('1.5');
    await expect(dialog.getByLabel('运费金额')).toHaveValue('1.35');
    await expect(dialog.locator('.price-calc2-shiphint')).toContainText('裸机 0.9kg');
    // 改单价为 2 → 裸机运费 1.8、成本 102 / 售价 117。
    await dialog.getByLabel('运费单价').fill('2');
    await expect(dialog.getByLabel('运费金额')).toHaveValue('1.8');
    await expect(bare).toContainText('¥117');
    // 切手动：预填当前自动值，单价框禁用；手填 6 → 成本 106 / 售价 122。
    await dialog.getByRole('button', { name: '手动', exact: true }).click();
    await expect(dialog.getByLabel('运费金额')).toHaveValue('1.8');
    await expect(dialog.getByLabel('运费单价')).toBeDisabled();
    await dialog.getByLabel('运费金额').fill('6');
    await expect(bare).toContainText('¥122');
    await expect(bare).toContainText('毛利 ¥16');
    // 切回自动：单价仍是 2，运费回到按重量算的 1.8。
    await dialog.getByRole('button', { name: '自动', exact: true }).click();
    await expect(dialog.getByLabel('运费金额')).toHaveValue('1.8');
    await expect(dialog.getByLabel('运费单价')).toBeEnabled();
    await dialog.getByLabel('运费单价').fill('1.5');
    await expect(dialog.getByLabel('运费金额')).toHaveValue('1.35');

    // 保存方案：卡片显示裸机售价与毛利。
    const planInput = dialog.getByLabel('方案名');
    await planInput.fill('一电一充方案');
    await dialog.getByRole('button', { name: '保存为方案' }).click();
    const firstCard = dialog.locator('.price-calc-plan', { hasText: '一电一充方案' });
    await expect(firstCard).toContainText('裸机 ¥116.5');
    await expect(firstCard).toContainText('毛利 ¥15');

    // 改毛利率并存第二份；载入第一份应把参数与结果回显回来。
    await dialog.getByLabel('毛利率').fill('20');
    await expect(bare).toContainText('¥121.5');
    await planInput.fill('两电一充方案');
    await dialog.getByRole('button', { name: '保存为方案' }).click();
    await expect(dialog.locator('.price-calc-plan', { hasText: '两电一充方案' })).toContainText('裸机 ¥121.5');

    await firstCard.getByRole('button', { name: '载入' }).click();
    await expect(dialog.getByLabel('毛利率')).toHaveValue('15');
    await expect(bare).toContainText('¥116.5');
    // 载入也回显运费模式与单价：方案存的是自动 + 1.5。
    await expect(dialog.getByLabel('运费单价')).toHaveValue('1.5');
    await expect(dialog.getByLabel('运费金额')).toHaveValue('1.35');

    // 删除方案：确认后从列表消失。
    page.on('dialog', (nativeDialog) => void nativeDialog.accept());
    await dialog.locator('.price-calc-plan', { hasText: '两电一充方案' }).getByRole('button', { name: /删除方案/ }).click();
    await expect(dialog.locator('.price-calc-plan', { hasText: '两电一充方案' })).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});
