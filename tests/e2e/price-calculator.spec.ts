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
  // 4 容量 × 4 节数（每节数还有两种成套口径）在桌面宽度下也会横向溢出 ——
  // 「电池容量」列固定在左侧的断言需要真实溢出才验得到。
  // 只有 5 节两档定了价：1500 行以下的 10/15/20 节全是空格，用来验「—」占位。
  expect((await page.request.put('/api/settings/battery-price-matrix', { data: { capacities: [1300, 1500, 1800, 2000], packCounts: [5, 10, 15, 20], prices: [[8, 14, 0, 0], [9, 0, 0, 0], [10, 15, 0, 0], [11, 16, 0, 0]] } })).ok()).toBe(true);

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

    // 桌面布局：左边录入区、右边包装/配件；前三个输入同一行。
    const layout = await dialog.locator('.price-calc2-params').evaluate((root) => {
      const inputs = root.querySelector('.price-calc2-inputs')!.getBoundingClientRect();
      const pickers = root.querySelector('.price-calc2-pickers')!.getBoundingClientRect();
      const tops = ['采购价', '毛利率', '其他费用'].map((label) => {
        const field = Array.from(root.querySelectorAll<HTMLElement>('.price-calc2-field')).find((el) => (el.querySelector('span')?.textContent ?? '').startsWith(label));
        return field ? Math.round(field.getBoundingClientRect().top) : null;
      });
      return { inputsTop: Math.round(inputs.top), pickersTop: Math.round(pickers.top), inputsRight: Math.round(inputs.right), pickersLeft: Math.round(pickers.left), tops };
    });
    expect(new Set(layout.tops).size).toBe(1);
    expect(layout.pickersLeft).toBeGreaterThan(layout.inputsRight);
    expect(Math.abs(layout.pickersTop - layout.inputsTop)).toBeLessThanOrEqual(2);

    // 电池价格查询：只读矩阵，价格与设置一致；没定价的格子显示 —。
    await dialog.getByRole('button', { name: '电池价格' }).click();
    const priceDialog = page.getByRole('dialog', { name: '电池价格' });
    await expect(priceDialog).toBeVisible();
    await expect(priceDialog.locator('.battery-query-table thead')).toContainText('5 节');
    await expect(priceDialog.locator('.battery-query-table tbody tr', { hasText: '1300 mAh' }).locator('td'))
      .toHaveText(['¥8', '¥14', '—', '—']);
    await expect(priceDialog.locator('.battery-query-table tbody tr', { hasText: '1500 mAh' }).locator('td').first())
      .toHaveText('¥9');
    await priceDialog.locator('.modal-close').click();
    await expect(priceDialog).toHaveCount(0);
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
    // 1500 行只有 5 节两档定了价；10/15/20 节共 6 个组合没定价，每组成本/售价/毛利 3 格都是 —，合计 18 格。
    await expect(dialog.locator('.battery-price-table tbody tr', { hasText: '1500mAh' }).locator('td', { hasText: '—' })).toHaveCount(18);

    // 「电池容量」列在桌面端也固定：表格横向溢出时滑到最右，该列左边缘仍贴着容器。
    // e2e 默认 1280px 宽（桌面），正是要覆盖的场景 —— 这条断言以前没有，导致
    // 桌面端不固定的问题一直没被测试发现。
    const matrixScroll = dialog.locator('.price-calc2-scroll');
    const capacityCell = dialog.locator('.battery-price-capacity').first();
    await expect(capacityCell).toHaveCSS('position', 'sticky');
    const overflow = await matrixScroll.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
    await matrixScroll.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    const pinned = await matrixScroll.evaluate((el) => {
      const cell = el.querySelector('.battery-price-capacity') as HTMLElement;
      return { cellLeft: Math.round(cell.getBoundingClientRect().left), containerLeft: Math.round(el.getBoundingClientRect().left) };
    });
    expect(Math.abs(pinned.cellLeft - pinned.containerLeft)).toBeLessThanOrEqual(2);
    await matrixScroll.evaluate((el) => { el.scrollLeft = 0; });

    // 切充电器到大座充 ¥5：5节1300一电一充 → (100+1.88+8+5)×1.15 = 132.11 → 132。
    await dialog.getByLabel('充电器').selectOption({ label: 'E2E大座充 ¥5' });
    await expect(saleCell('复制售价 5节1300mah 一电一充 132元')).toHaveText('132');
    await dialog.getByLabel('充电器').selectOption({ label: 'E2E小线充 ¥2' });

    // 点售价复制：自动带上配置名、「元」与含税运口径，剪贴板内容一致。
    await saleCell('复制售价 5节1300mah 一电一充 128.5元').click();
    await expect(dialog.locator('.price-calc-message')).toContainText('已复制：5节1300mah 一电一充 128.5元（含运不含税）');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('5节1300mah 一电一充 128.5元（含运不含税）');

    // 裸机售价也能复制。
    await dialog.getByLabel('复制裸机售价 116.5元').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('裸机 116.5元（含运不含税）');

    // 小眼睛：隐藏全部成本后只剩售价——成本列、毛利列、参数区、方案区收起，产品名与图仍在，售价仍可复制。
    await dialog.getByRole('button', { name: '隐藏成本（发客户截图用）' }).click();
    await expect(dialog.locator('.battery-price-table th', { hasText: '成本' })).toHaveCount(0);
    await expect(dialog.locator('.battery-price-table th', { hasText: '毛利' })).toHaveCount(0);
    await expect(dialog.locator('.battery-price-profit')).toHaveCount(0);
    await expect(dialog.getByLabel('采购价')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '保存为方案' })).toHaveCount(0);
    // 入口随成本一起收起（发客户截图时不暴露电池进价），打开后的参考表仍列全部价格（另有用例覆盖）。
    await expect(dialog.getByRole('button', { name: '电池价格' })).toHaveCount(0);
    await expect(dialog.locator('.price-calc2-head')).toContainText(`E2E矩阵算价${stamp}`);
    await expect(dialog.locator('.price-calc2-thumb')).toBeVisible();
    await saleCell('复制售价 5节1300mah 一电一充 128.5元').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('5节1300mah 一电一充 128.5元（含运不含税）');
    // 再点回来恢复显示（每次打开也默认显示）。
    await dialog.getByRole('button', { name: '显示成本' }).click();
    await expect(dialog.getByLabel('采购价')).toHaveValue('100');
    await expect(dialog.getByRole('button', { name: '保存为方案' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '电池价格' })).toBeVisible();

    // 运费预估：默认自动、单价 1.5、运费只读显示裸机值 1.35、跟随计费重量提示。
    await expect(dialog.getByLabel('运费单价')).toHaveValue('1.5');
    await expect(dialog.getByLabel('运费金额')).toHaveValue('1.35');
    await expect(dialog.locator('.price-calc2-shipweight')).toContainText('实重 0.9kg');
    await expect(dialog.locator('.price-calc2-shipweight')).toContainText('体积重 —');
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

    // 复制价签口径：含运/含税的四种组合都要标对。
    const bareCopy = dialog.locator('.price-calc2-bare .price-calc2-sale');
    // 当前：自动运费 1.35 > 0、税 0 → 含运不含税
    await bareCopy.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('（含运不含税）');
    // 加 13% 税、保留运费 → 含税运
    await dialog.getByLabel('税').fill('13');
    await bareCopy.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('（含税运）');
    // 手动运费填 0、税仍 13 → 含税不含运
    await dialog.getByRole('button', { name: '手动', exact: true }).click();
    await dialog.getByLabel('运费金额').fill('0');
    await bareCopy.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('（含税不含运）');
    // 税也清 0 → 不含税运
    await dialog.getByLabel('税').fill('0');
    await bareCopy.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('（不含税运）');
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('包装选择：按所选包装算包材、实重与体积重，方案记住所选包装', async ({ page }) => {
  const stamp = Date.now();
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E包装选择${stamp}`,
      supplier: 'E2E算价供应商',
      status: 'active',
      category: '电动工具',
      purchaseQuotes: [{ supplier: 'E2E算价供应商', variant: '', price: 100, isDefault: true }],
      packaging: [
        // 彩盒：0.5kg、120000cm³ ÷ 10 台 ÷ 8000 = 体积重 1.5kg → 计费 1.5、包材 0。
        { name: '彩盒', packCount: 10, innerWeight: 0.5, outerSize: '60×50×40', purchasePrice: 0 },
        // 大箱：1.2kg、24000cm³ ÷ 5 台 ÷ 8000 = 体积重 0.6kg → 计费 1.2、包材 3.2。
        { name: '大箱', packCount: 5, innerWeight: 1.2, outerSize: '40×30×20', purchasePrice: 3.2 },
      ],
    },
  });
  expect(created.ok()).toBe(true);
  const product = (await created.json()).data as { id: number };

  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
    await page.locator('.products-page .page-toolbar .search-control input').fill(`E2E包装选择${stamp}`);
    await expect(page.locator('.products-page .table-state')).toHaveCount(0);
    await page.locator('.products-page .price-calc-entry').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('售价计算');

    const packagingTrigger = dialog.getByRole('button', { name: '选择包装' });
    const shipWeight = dialog.locator('.price-calc2-shipweight');
    // 默认第一条「彩盒」：包材 0、计费按体积重 1.5kg → 运费 2.25；成本 102.25（显示 102.5）。
    await expect(packagingTrigger).toContainText('彩盒');
    await expect(dialog.locator('.price-calc2-packaging-head')).toContainText('包材 ¥0');
    await expect(shipWeight).toContainText('实重 0.5kg');
    await expect(shipWeight).toContainText('体积重 1.5kg');
    await expect(dialog.getByLabel('运费金额')).toHaveValue('2.25');
    await expect(dialog.locator('.price-calc2-bare')).toContainText('成本 ¥102.5');

    // 切到「大箱」：包材 3.2、实重 1.2kg 大于体积重 0.6kg → 运费 1.8；成本 = 100 + 3.2 + 1.8 = 105。
    await packagingTrigger.click();
    const packagingCurtain = dialog.getByRole('group', { name: '选择包装' });
    // 包装幕布靠右对齐，必须完整落在计算器弹窗内，不能被弹窗裁掉。
    const [panelBox, curtainBox] = await Promise.all([dialog.boundingBox(), packagingCurtain.boundingBox()]);
    expect(panelBox && curtainBox).toBeTruthy();
    expect(curtainBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
    expect(curtainBox!.x + curtainBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width);
    await packagingCurtain.getByRole('button', { name: /^大箱/ }).click();
    await expect(packagingTrigger).toContainText('大箱');
    await expect(dialog.locator('.price-calc2-packaging-head')).toContainText('包材 ¥3.2');
    await expect(shipWeight).toContainText('实重 1.2kg');
    await expect(shipWeight).toContainText('体积重 0.6kg');
    await expect(dialog.getByLabel('运费金额')).toHaveValue('1.8');
    await expect(dialog.locator('.price-calc2-packaging-meta')).toContainText('5 台/箱');
    await expect(dialog.locator('.price-calc2-bare')).toContainText('成本 ¥105');

    // 其他费用单独加：填 10 → 成本 115。
    await dialog.getByLabel('其他费用').fill('10');
    await expect(dialog.locator('.price-calc2-bare')).toContainText('成本 ¥115');

    // 保存方案（毛利率 0）→ 卡片 115；再切回彩盒并把其他费用清零，载入方案应恢复大箱 + 10。
    await dialog.getByLabel('毛利率').fill('0');
    await dialog.getByLabel('方案名').fill('包装选择方案');
    await dialog.getByRole('button', { name: '保存为方案' }).click();
    const planCard = dialog.locator('.price-calc-plan', { hasText: '包装选择方案' });
    await expect(planCard).toContainText('裸机 ¥115');

    await packagingTrigger.click();
    await packagingCurtain.getByRole('button', { name: /^彩盒/ }).click();
    await dialog.getByLabel('其他费用').fill('0');
    await expect(dialog.locator('.price-calc2-bare')).toContainText('成本 ¥102.5');

    await planCard.getByRole('button', { name: '载入' }).click();
    await expect(packagingTrigger).toContainText('大箱');
    await expect(dialog.getByLabel('其他费用')).toHaveValue('10');
    await expect(dialog.getByLabel('运费金额')).toHaveValue('1.8');
    await expect(dialog.locator('.price-calc2-bare')).toContainText('成本 ¥115');
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('电池价格查询：参考表列出全部节数，主矩阵按产品电压过滤', async ({ page }) => {
  const stamp = Date.now();
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E电池参考表${stamp}`,
      supplier: 'E2E算价供应商',
      status: 'active',
      category: '电动工具',
      batteryVoltage: '21V',
      purchaseQuotes: [{ supplier: 'E2E算价供应商', variant: '', price: 100, isDefault: true }],
      packaging: [{ name: '彩盒包装', packCount: 24, innerWeight: 0.9, purchasePrice: 0 }],
    },
  });
  expect(created.ok()).toBe(true);
  const product = (await created.json()).data as { id: number };
  expect((await page.request.put('/api/settings/battery-price-matrix', {
    data: { capacities: [1300, 1500], packCounts: [3, 5, 20], prices: [[7, 8, 30], [8, 9, 42]] },
  })).ok()).toBe(true);

  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
    await page.locator('.products-page .page-toolbar .search-control input').fill(`E2E电池参考表${stamp}`);
    await expect(page.locator('.products-page .table-state')).toHaveCount(0);
    await page.locator('.products-page .price-calc-entry').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('售价计算');

    // 产品是 21V：主矩阵只出 5 节及以上，3 节列不出现。
    await expect(dialog.locator('.battery-price-table .battery-price-capacity')).toHaveText(['1300mAh', '1500mAh']);
    await expect(dialog.locator('.battery-price-table thead')).toContainText('5节');
    await expect(dialog.locator('.battery-price-table thead')).toContainText('20节');
    await expect(dialog.locator('.battery-price-table thead')).not.toContainText('3节');

    // 电池价格参考表不受电压过滤：3/5/20 节全部列出。
    await dialog.getByRole('button', { name: '电池价格' }).click();
    const priceDialog = page.getByRole('dialog', { name: '电池价格' });
    await expect(priceDialog.locator('.battery-query-table thead')).toContainText('3 节');
    await expect(priceDialog.locator('.battery-query-table thead')).toContainText('5 节');
    await expect(priceDialog.locator('.battery-query-table thead')).toContainText('20 节');
    await expect(priceDialog.locator('.battery-query-table tbody tr', { hasText: '1500 mAh' }).locator('td'))
      .toHaveText(['¥8', '¥9', '¥42']);
    await expect(priceDialog.locator('.battery-query-table tbody tr', { hasText: '1300 mAh' }).locator('td'))
      .toHaveText(['¥7', '¥8', '¥30']);
  } finally {
    await page.request.put('/api/settings/battery-price-matrix', {
      data: { capacities: [1300, 1500, 2000], packCounts: [5, 10, 15, 20], prices: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    });
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('采购报价选择：多供应商报价手动切换、手改价格回到手动、方案记住所选报价', async ({ page }) => {
  const stamp = Date.now();
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E报价切换${stamp}`,
      status: 'active',
      category: '电动工具',
      purchaseQuotes: [
        { supplier: '德艺堡', variant: '含配件', price: '100', isDefault: true },
        { supplier: '宏力', variant: '无刷款', price: '120', isDefault: false },
        { supplier: '久力', variant: '裸机款', price: '', isDefault: false },
      ],
      packaging: [{ name: '彩盒包装', packCount: 24, innerWeight: 0.9, purchasePrice: 0 }],
    },
  });
  expect(created.ok()).toBe(true);
  const product = (await created.json()).data as { id: number };

  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
    await page.locator('.products-page .page-toolbar .search-control input').fill(`E2E报价切换${stamp}`);
    await expect(page.locator('.products-page .table-state')).toHaveCount(0);
    await page.locator('.products-page .price-calc-entry').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('售价计算');

    const quoteSelect = dialog.getByLabel('采购报价');
    const selectedQuoteText = () => quoteSelect.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '');
    // 毛利率固定 15%，排除上次记住的值影响售价断言。
    await dialog.getByLabel('毛利率').fill('15');
    // 默认进来选中默认档，价格就是该报价。
    await expect(dialog.getByLabel('采购价')).toHaveValue('100');
    expect(await selectedQuoteText()).toContain('¥100 · 德艺堡 · 含配件');
    const bare = dialog.locator('.price-calc2-bare');
    await expect(bare).toContainText('售价 ¥116.5');

    // 下拉列出全部报价 + 手动填写；未定价的那条禁选。
    await expect(quoteSelect.locator('option')).toHaveCount(4);
    await expect(quoteSelect.locator('option', { hasText: '未定价 · 久力 · 裸机款' })).toBeDisabled();
    await expect(quoteSelect.locator('option', { hasText: '手动填写' })).toBeEnabled();

    // 版面：采购价仍占一格（下拉 + 价格框都在格内），自动/手动与运费同一行，三个字段不被挤到下一行。
    const layout = await dialog.locator('.price-calc2-inputs').evaluate((root) => {
      const grid = root.getBoundingClientRect();
      const price = root.querySelector('.price-calc2-price-field')!.getBoundingClientRect();
      const select = root.querySelector('.price-calc2-quote-select')!.getBoundingClientRect();
      const shipping = Array.from(root.querySelectorAll<HTMLElement>('.price-calc2-field'))
        .find((el) => (el.querySelector('span')?.textContent ?? '').startsWith('运费单价'))!;
      const mode = root.querySelector('.price-calc2-shipmode')!;
      return {
        gridRight: grid.right,
        priceRight: price.right,
        selectRight: select.right,
        shippingTop: Math.round(shipping.getBoundingClientRect().top),
        modeTop: Math.round(mode.getBoundingClientRect().top),
      };
    });
    expect(layout.priceRight).toBeLessThanOrEqual(layout.gridRight + 1);
    expect(layout.selectRight).toBeLessThanOrEqual(layout.priceRight + 1);
    expect(Math.abs(layout.shippingTop - layout.modeTop)).toBeLessThanOrEqual(2);

    // 选 120 的报价：采购价直接带入该报价，整表重算。
    await quoteSelect.selectOption({ label: '¥120 · 宏力 · 无刷款' });
    await expect(dialog.getByLabel('采购价')).toHaveValue('120');
    expect(await selectedQuoteText()).toContain('¥120 · 宏力 · 无刷款');
    await expect(bare).toContainText('售价 ¥139.5');

    // 保存方案会记下供应商与名目。
    await dialog.getByLabel('方案名').fill('宏力方案');
    await dialog.getByRole('button', { name: '保存为方案' }).click();
    await expect(dialog.locator('.price-calc-plan', { hasText: '宏力方案' })).toBeVisible();

    // 手改采购价：下拉回到「手动填写」，按手动价保存第二份方案。
    await dialog.getByLabel('采购价').fill('130');
    expect(await selectedQuoteText()).toBe('手动填写');
    await dialog.getByLabel('方案名').fill('手动方案');
    await dialog.getByRole('button', { name: '保存为方案' }).click();
    await expect(dialog.locator('.price-calc-plan', { hasText: '手动方案' })).toBeVisible();

    // 载入「宏力方案」：价格按快照回显，报价下拉找回并重新选中宏力。
    await dialog.locator('.price-calc-plan', { hasText: '宏力方案' }).getByRole('button', { name: '载入' }).click();
    await expect(dialog.getByLabel('采购价')).toHaveValue('120');
    expect(await selectedQuoteText()).toContain('¥120 · 宏力 · 无刷款');

    // 载入「手动方案」：没有报价快照，下拉是手动填写。
    await dialog.locator('.price-calc-plan', { hasText: '手动方案' }).getByRole('button', { name: '载入' }).click();
    await expect(dialog.getByLabel('采购价')).toHaveValue('130');
    expect(await selectedQuoteText()).toBe('手动填写');
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});
