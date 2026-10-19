import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
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

/** 记录网页写入剪贴板的内容：无头浏览器不给真实系统剪贴板权限，拦 writeText 最稳。 */
async function captureClipboard(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const target = window as unknown as { __copied: string[] };
    target.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => { target.__copied.push(text); return Promise.resolve(); } },
    });
  });
}

function copiedTexts(page: Page) {
  return page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
}

async function seedProduct(page: Page) {
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E复制SKU${Date.now()}`,
      supplier: 'E2E供应商',
      status: 'active',
      packaging: [{ name: '彩盒包装', innerSize: '10×5×3', innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8, packCount: 24 }],
    },
  });
  if (!created.ok()) throw new Error(`创建产品失败：HTTP ${created.status()} ${await created.text()}`);
  return (await created.json()).data as { id: string; sku: string };
}

async function openProductList(page: Page, sku: string) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(sku);
  await expect(page.locator('.products-table-desktop tbody tr')).toHaveCount(1);
}

test('列表：SKU 旁的一键复制按钮复制完整 SKU 并短暂显示已复制', async ({ page, context }) => {
  await captureClipboard(context);
  const product = await seedProduct(page);
  try {
    await openProductList(page, product.sku);
    const button = page.locator(`.products-table-desktop button[aria-label="复制 SKU ${product.sku}"]`);
    await expect(button).toBeVisible();

    await button.click();
    await expect.poll(() => copiedTexts(page)).toEqual([product.sku]);
    await expect(button.locator('svg.lucide-check')).toHaveCount(1);
    // 反馈会自动收起，按钮回到可再次复制的复制图标。
    await expect(button.locator('svg.lucide-copy')).toHaveCount(1, { timeout: 4000 });
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('详情弹窗：SKU 格也能一键复制', async ({ page, context }) => {
  await captureClipboard(context);
  const product = await seedProduct(page);
  try {
    await openProductList(page, product.sku);
    await page.locator('.product-sku-button:visible').first().click();
    const dialog = page.locator('.product-detail-modal');
    await expect(dialog).toBeVisible();

    const button = dialog.getByRole('button', { name: '复制 SKU' });
    await expect(button).toBeVisible();
    await button.click();
    await expect.poll(() => copiedTexts(page)).toEqual([product.sku]);

    // 详情里的 SKU 与按钮同一行，值不折行。
    const metrics = await dialog.locator('.product-detail-sku').evaluate((node) => {
      const value = node.querySelector('.product-detail-emphasis') as HTMLElement;
      return { height: Math.round(value.getBoundingClientRect().height), clipped: value.scrollWidth > value.clientWidth + 1 };
    });
    expect(metrics.height).toBeLessThanOrEqual(24);
    expect(metrics.clipped).toBe(false);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test.describe('手机端', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('卡片列表的 SKU 复制按钮可见，且不把卡片撑出横向滚动', async ({ page, context }) => {
    await captureClipboard(context);
    const product = await seedProduct(page);
    try {
      await page.goto('/');
      await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
      await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
      await page.locator('.products-page .page-toolbar .search-control input').fill(product.sku);

      const button = page.locator(`.product-card-sku-row button[aria-label="复制 SKU ${product.sku}"]`);
      await expect(button).toBeVisible();
      await button.tap();
      await expect.poll(() => copiedTexts(page)).toEqual([product.sku]);

      const metrics = await page.evaluate(() => {
        const scroller = document.querySelector('.app-content') as HTMLElement;
        return { overflow: scroller.scrollWidth - scroller.clientWidth };
      });
      expect(metrics.overflow).toBeLessThanOrEqual(0);
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });
});
