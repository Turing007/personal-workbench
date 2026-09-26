import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let sessionCookie: string;
const stamp = Date.now();
let withImage: { id: string; sku: string; name: string };
let withoutImage: { id: string; sku: string; name: string };

async function seedProduct(request: Page['request'], name: string, image: boolean) {
  const created = await request.post('/api/products', {
    data: { name, status: 'active', packaging: [{ name: '彩盒包装', innerSize: '10×5×3', innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8, packCount: 24 }] },
  });
  if (!created.ok()) throw new Error(`创建产品失败：HTTP ${created.status()} ${await created.text()}`);
  const product = (await created.json()).data as { id: string; sku: string; name: string };
  if (image) {
    const uploaded = await request.post(`/api/products/${product.id}/images?category=product`, {
      multipart: { file: { name: 'e2e-gallery.png', mimeType: 'image/png', buffer: PNG_1X1 } },
    });
    if (!uploaded.ok()) throw new Error(`上传产品图片失败：HTTP ${uploaded.status()}`);
  }
  return product;
}

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
  withImage = await seedProduct(request, `E2E大图${stamp}`, true);
  withoutImage = await seedProduct(request, `E2E无图${stamp}`, false);
});

test.afterAll(async ({ request }) => {
  for (const product of [withImage, withoutImage]) await request.delete(`/api/products/${product.id}`);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

async function openProducts(page: Page, mobile = false) {
  await page.goto('/');
  if (mobile) await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
}

const toggle = (page: Page) => page.locator('.products-page .products-view-toggle');
const gallery = (page: Page) => page.locator('.products-gallery');

test('桌面端：默认列表，切到大图后卡片显示首图与名称，点卡片看详情，选择被记住', async ({ page }) => {
  await openProducts(page);

  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.products-table-desktop')).toBeVisible();
  await expect(gallery(page)).toHaveCount(0);

  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(gallery(page)).toBeVisible();
  // 大图模式下表格与手机卡片列表都不该留在 DOM 里。
  await expect(page.locator('.products-table-desktop')).toHaveCount(0);
  await expect(page.locator('.products-card-list')).toHaveCount(0);

  await page.locator('.products-page .page-toolbar .search-control input').fill(`E2E大图${stamp}`);
  const card = gallery(page).locator('.product-gallery-card', { hasText: withImage.sku });
  await expect(card).toHaveCount(1);
  await expect(card.locator('img')).toBeVisible();
  await expect(card).toContainText(withImage.name);

  // 没图的产品占位显示，而不是空一块。
  await page.locator('.products-page .page-toolbar .search-control input').fill(`E2E无图${stamp}`);
  await expect(gallery(page).locator('.product-gallery-placeholder')).toHaveCount(1);

  // 点卡片打开产品详情。
  await page.locator('.products-page .page-toolbar .search-control input').fill(withImage.sku);
  await card.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(withImage.name);
  await dialog.locator('.modal-close').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 视图选择记在本地：刷新后仍是大图。
  await openProducts(page);
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(gallery(page)).toBeVisible();

  // 切回列表后表格回来。
  await toggle(page).click();
  await expect(page.locator('.products-table-desktop')).toBeVisible();
});

test('桌面端：大图与分页共用同一份筛选结果', async ({ page }) => {
  await openProducts(page);
  await toggle(page).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(`E2E大图${stamp}`);
  await expect(gallery(page).locator('.product-gallery-card')).toHaveCount(1);
  await expect(page.locator('.products-pagination-summary')).toContainText('共 1 个产品');
});

test.describe('手机端', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('默认就是大图浏览，两列铺开且不需要左右滑', async ({ page }) => {
    await openProducts(page, true);

    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(gallery(page)).toBeVisible();

    const metrics = await page.evaluate(() => {
      const scroller = document.querySelector('.app-content') as HTMLElement;
      const grid = document.querySelector('.products-gallery') as HTMLElement;
      const first = document.querySelector('.product-gallery-card') as HTMLElement;
      const second = document.querySelector('.product-gallery-card:nth-child(2)') as HTMLElement;
      return {
        scrollerOverflow: scroller.scrollWidth - scroller.clientWidth,
        gridOverflow: grid.scrollWidth - grid.clientWidth,
        columns: second && Math.abs(second.getBoundingClientRect().top - first.getBoundingClientRect().top) < 2 ? 2 : 1,
        cardWidth: Math.round(first.getBoundingClientRect().width),
        viewportWidth: window.innerWidth,
      };
    });
    expect(metrics.scrollerOverflow).toBeLessThanOrEqual(0);
    expect(metrics.gridOverflow).toBeLessThanOrEqual(0);
    expect(metrics.columns).toBe(2);
    expect(metrics.cardWidth * 2).toBeLessThanOrEqual(metrics.viewportWidth);

    // 点卡片仍然打开详情弹窗。
    await gallery(page).locator('.product-gallery-card').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
