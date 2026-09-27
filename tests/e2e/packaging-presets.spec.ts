import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';
import { useProductListView } from './helpers/products-view';

let sessionCookie: string;

const PRESET = { id: 'e2e-preset-1', name: 'E2E牛皮纸盒-20台装', innerSize: '45*9*9', outerSize: '47*48*36', packSize: 20, purchasePrice: '2' };

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
  // 预设存在服务端且被所有用例共用，这里显式写死一份，保证断言与运行顺序无关。
  const response = await request.put('/api/settings/packaging-presets', { data: { items: [PRESET] } });
  if (!response.ok()) throw new Error(`预置包装预设失败：HTTP ${response.status()}`);
});

test.afterAll(async ({ request }) => {
  // afterAll 里的 request 是新的未登录实例，要先重新拿会话再清理。
  await ensureAuthenticated(request);
  await request.put('/api/settings/packaging-presets', { data: { items: [] } });
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
  await useProductListView(context);
});

async function seedProduct(page: Page) {
  const response = await page.request.post('/api/products', {
    data: { name: `E2E包装预设${Date.now()}`, status: 'active', packaging: [{ name: '彩盒包装', innerSize: '', outerSize: '', packCount: 1, purchasePrice: '' }] },
  });
  if (!response.ok()) throw new Error(`创建产品失败：HTTP ${response.status()} ${await response.text()}`);
  return (await response.json()).data as { id: string; sku: string };
}

/** 打开产品库 → 编辑指定产品，返回编辑器弹窗。 */
async function openEditor(page: Page, sku: string, mobile = false, expandPresets = true) {
  await page.goto('/');
  if (mobile) await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(sku);
  // SKU 按钮开的是「查看详情」弹窗；进编辑器要点行内的「编辑产品」图标。
  await page.locator('.products-page button[title="编辑产品"]:visible').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // 「常用包装」预设条默认收起，用到时先展开（下面填包装的表格不折叠）。
  if (expandPresets) await dialog.locator('.packaging-preset-toggle').click();
  return dialog;
}

test('桌面端：只有预设条折叠，包装表格打开就能直接填', async ({ page }) => {
  const product = await seedProduct(page);
  try {
    const dialog = await openEditor(page, product.sku, false, false);
    await expect(dialog.locator('.packaging-preset')).toHaveCount(0);
    await expect(dialog.locator('.packaging-table-section:not(.purchase-quotes-section) .packaging-table-shell')).toBeVisible();
    await dialog.locator('input[aria-label="包装名称"]').fill('不用展开也能填');
    await expect(dialog.locator('input[aria-label="包装名称"]')).toHaveValue('不用展开也能填');

    await dialog.locator('.packaging-preset-toggle').click();
    await expect(dialog.locator('.packaging-preset', { hasText: PRESET.name })).toHaveCount(1);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('桌面端：点预设一次填好包装名称、内外箱尺寸、装箱数与采购价', async ({ page }) => {
  const product = await seedProduct(page);
  try {
    const dialog = await openEditor(page, product.sku);
    const card = dialog.locator('.packaging-preset', { hasText: PRESET.innerSize });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(PRESET.name);

    await card.click();

    await expect(dialog.locator('input[aria-label="包装名称"]')).toHaveValue(PRESET.name);
    await expect(dialog.locator('input[aria-label="内盒尺寸"]')).toHaveValue(PRESET.innerSize);
    await expect(dialog.locator('input[aria-label="外箱尺寸"]')).toHaveValue(PRESET.outerSize);
    await expect(dialog.locator('input[aria-label="外箱装箱数"]')).toHaveValue(String(PRESET.packSize));
    await expect(dialog.locator('input[aria-label="包装采购价"]')).toHaveValue(PRESET.purchasePrice);

    // 保存后落库，重开编辑器仍是这套值。
    await dialog.locator('button.button-primary').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const row = page.locator('.products-table-desktop tbody tr', { hasText: product.sku });
    await expect(row).toContainText(PRESET.innerSize);
    await expect(row).toContainText(PRESET.outerSize);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('桌面端：已有内容的包装行不被预设覆盖，改为新增一行', async ({ page }) => {
  const product = await seedProduct(page);
  try {
    const dialog = await openEditor(page, product.sku);
    // 先把默认行改成别的值，点预设就不该动它。
    await dialog.locator('input[aria-label="内盒尺寸"]').fill('99*99*99');
    await dialog.locator('.packaging-preset', { hasText: PRESET.innerSize }).click();

    const innerSizes = dialog.locator('input[aria-label="内盒尺寸"]');
    await expect(innerSizes).toHaveCount(2);
    await expect(innerSizes.nth(0)).toHaveValue('99*99*99');
    await expect(innerSizes.nth(1)).toHaveValue(PRESET.innerSize);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('桌面端：管理预设跳转设置页，改名保存后编辑器卡片同步', async ({ page }) => {
  const product = await seedProduct(page);
  try {
    const dialog = await openEditor(page, product.sku);
    await dialog.locator('.packaging-preset-manage').click();

    const section = page.locator('.settings-section');
    await expect(section).toContainText('包装预设');
    await expect(section.locator('.packaging-preset-form-row')).toHaveCount(1);

    // 表头与数据行是两个独立 grid，最后一列一旦写 auto，两边 fr 宽度就会错开、整排表头跑偏。
    const drift = await section.locator('.packaging-preset-form').evaluate((form) => {
      const xs = (selector: string) => Array.from(document.querySelectorAll(`${selector} > *`)).map((cell) => Math.round(cell.getBoundingClientRect().x));
      const head = xs('.packaging-preset-form-head');
      const row = xs('.packaging-preset-form-row');
      return head.map((x, index) => (row[index] ?? 0) - x);
    });
    expect(drift).toEqual([0, 0, 0, 0, 0, 0]);

    const renamed = 'E2E改过的包装';
    await section.locator('input[aria-label="预设1包装名称"]').fill(renamed);
    await expect(section.locator('.packaging-preset-dirty')).toBeVisible();
    await section.locator('.packaging-preset-form-footer button.button-primary').click();
    await expect(section.locator('.notice-success')).toContainText('已保存');

    // 回产品库重开编辑器（openEditor 会顺手展开默认折叠的包装方式）。
    await openEditor(page, product.sku);
    await expect(page.getByRole('dialog').locator('.packaging-preset', { hasText: renamed })).toHaveCount(1);
  } finally {
    await page.request.put('/api/settings/packaging-presets', { data: { items: [PRESET] } });
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test.describe('手机端', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('预设卡片在编辑器里可见，且不产生横向滚动', async ({ page }) => {
    const product = await seedProduct(page);
    try {
      const dialog = await openEditor(page, product.sku, true);
      const card = dialog.locator('.packaging-preset', { hasText: PRESET.innerSize });
      await expect(card).toBeVisible();

      await card.tap();
      await expect(dialog.locator('input[aria-label="外箱尺寸"]')).toHaveValue(PRESET.outerSize);

      const metrics = await page.evaluate(() => {
        const scroller = document.querySelector('.app-content') as HTMLElement;
        const bar = document.querySelector('.packaging-preset-list') as HTMLElement;
        return {
          scrollerOverflow: scroller.scrollWidth - scroller.clientWidth,
          barOverflow: bar.scrollWidth - bar.clientWidth,
        };
      });
      expect(metrics.scrollerOverflow).toBeLessThanOrEqual(0);
      expect(metrics.barOverflow).toBeLessThanOrEqual(0);
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });
});
