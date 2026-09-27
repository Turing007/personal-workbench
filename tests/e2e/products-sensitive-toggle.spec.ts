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
  // 本用例断言表格与卡片列表，先把视图固定成列表（产品库默认是大图）。
  await useProductListView(context);
});

const SUPPLIER = 'E2E敏感供应商';
const PURCHASE_PRICE = 12.5;

/** 桌面表格默认 11 列（含供应商、价格），点小眼睛收起后剩 9 列。 */
const COLUMNS_WITH_SENSITIVE = 11;
const COLUMNS_WITHOUT_SENSITIVE = 9;

async function seedProduct(page: Page, stamp: number) {
  const response = await page.request.post('/api/products', {
    // 正式产品必须带至少一行包装方式，否则服务端按 VALIDATION_ERROR 拒绝。
    data: {
      name: `E2E敏感信息${stamp}`,
      supplier: SUPPLIER,
      purchasePrice: PURCHASE_PRICE,
      status: 'active',
      packaging: [{ name: '彩盒包装', innerSize: '10×5×3', innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8, packCount: 24 }],
    },
  });
  if (!response.ok()) throw new Error(`创建产品失败：HTTP ${response.status()} ${await response.text()}`);
  // 新建产品的 SKU 由服务端按 VT-#### 规则生成，必须用响应里回填的真实 SKU 定位，不能自己臆造。
  return (await response.json()).data as { id: string; sku: string };
}

/** 进入产品库并按 SKU 过滤到这一条。手机端主导航收在「更多模块」抽屉里。 */
async function openProducts(page: Page, sku: string, mobile = false) {
  await page.goto('/');
  if (mobile) await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(sku);
}

test('桌面端：供应商与价格默认显示，小眼睛用于临时收起', async ({ page }) => {
  const stamp = Date.now();
  const product = await seedProduct(page, stamp);

  try {
    await openProducts(page, product.sku);

    const table = page.locator('.products-table-desktop .products-data-table');
    const head = table.locator('thead th');
    const row = table.locator('tbody tr', { hasText: product.sku });
    const toggle = page.locator('.products-page .page-toolbar .products-sensitive-toggle');

    await expect(row).toHaveCount(1);
    // 默认就是可见的：表头与两列都在，不用先点小眼睛。
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(head).toHaveCount(COLUMNS_WITH_SENSITIVE);
    await expect(row.locator('td')).toHaveCount(COLUMNS_WITH_SENSITIVE);
    await expect(table.locator('thead')).toContainText('供应商');
    await expect(table.locator('thead')).toContainText('价格');
    await expect(row).toContainText(SUPPLIER);
    await expect(row).toContainText('¥12.5');

    // 点一下整列收起（连表头都不留，而不是留着空列）。
    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAttribute('title', '显示供应商与价格');
    await expect(head).toHaveCount(COLUMNS_WITHOUT_SENSITIVE);
    await expect(row.locator('td')).toHaveCount(COLUMNS_WITHOUT_SENSITIVE);
    await expect(table.locator('thead')).not.toContainText('供应商');
    await expect(table.locator('thead')).not.toContainText('价格');
    await expect(row).not.toContainText(SUPPLIER);
    await expect(row).not.toContainText('¥12.5');

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(head).toHaveCount(COLUMNS_WITH_SENSITIVE);
    await expect(row).toContainText(SUPPLIER);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('产品详情弹窗跟随小眼睛开关', async ({ page }) => {
  const stamp = Date.now();
  const product = await seedProduct(page, stamp);

  try {
    await openProducts(page, product.sku);

    const row = page.locator('.products-data-table tbody tr', { hasText: product.sku });
    const toggle = page.locator('.products-page .page-toolbar .products-sensitive-toggle');

    // 默认状态下打开详情：供应商 / 价格 两格已经删掉，敏感信息只在「采购报价」里出现一次。
    await row.locator('.product-sku-button').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.product-detail-label', { hasText: '供应商' })).toHaveCount(0);
    await expect(dialog.locator('.product-detail-label', { hasText: '价格' })).toHaveCount(0);
    const quotes = dialog.locator('.product-detail-quotes');
    await expect(quotes).toContainText(SUPPLIER);
    await expect(quotes).toContainText('¥12.5');
    await dialog.locator('.modal-close').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 收起小眼睛后再看详情：采购报价整块消失。
    await toggle.click();
    await row.locator('.product-sku-button').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('.product-detail-quotes')).toHaveCount(0);
    await expect(page.getByRole('dialog')).not.toContainText(SUPPLIER);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test.describe('手机端：卡片列表', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('供应商 / 采购价 卡片字段默认显示，小眼睛收起', async ({ page }) => {
    const stamp = Date.now();
    const product = await seedProduct(page, stamp);

    try {
      await openProducts(page, product.sku, true);

      // 桌面表格与手机卡片在 DOM 里同时存在、由 CSS 决定谁可见，必须用 :visible 过滤。
      const card = page.locator('.products-card-list .product-card:visible', { hasText: product.sku });
      const sensitiveField = card.locator('.product-card-field', { hasText: '供应商' });
      const toggle = page.locator('.products-page .page-toolbar .products-sensitive-toggle');

      await expect(card).toHaveCount(1);
      await expect(sensitiveField).toBeVisible();
      await expect(sensitiveField).toContainText(SUPPLIER);
      await expect(sensitiveField).toContainText('¥12.5');

      await toggle.click();

      await expect(sensitiveField).toHaveCount(0);
      await expect(card).not.toContainText(SUPPLIER);

      await toggle.click();

      await expect(sensitiveField).toBeVisible();
      await expect(sensitiveField).toContainText(SUPPLIER);
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });

  test('工具条在窄屏下一屏放下，不需要左右滑动', async ({ page }) => {
    const stamp = Date.now();
    const product = await seedProduct(page, stamp);

    try {
      await openProducts(page, product.sku, true);

      // 手机宽度从最窄的 320 一直到常规的 390，工具条都必须完整落在屏幕里。
      for (const width of [320, 360, 375, 390]) {
        await page.setViewportSize({ width, height: 844 });

        const metrics = await page.evaluate(() => {
          // .app-content 是真正的横向滚动容器（overflow: auto），它一旦可横向滚动用户就得左右滑。
          const scroller = document.querySelector('.app-content') as HTMLElement;
          const toolbar = document.querySelector('.products-page .page-toolbar') as HTMLElement;
          return {
            scrollerOverflow: scroller.scrollWidth - scroller.clientWidth,
            toolbarOverflow: toolbar.scrollWidth - toolbar.clientWidth,
            toolbarRight: Math.round(toolbar.getBoundingClientRect().right),
            viewportWidth: window.innerWidth,
          };
        });

        expect(metrics.scrollerOverflow, `${width}px 下 .app-content 出现了横向滚动`).toBeLessThanOrEqual(0);
        expect(metrics.toolbarOverflow, `${width}px 下工具条内容超出自身宽度`).toBeLessThanOrEqual(0);
        expect(metrics.toolbarRight, `${width}px 下工具条右边缘超出屏幕`).toBeLessThanOrEqual(metrics.viewportWidth);
      }
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });
});
