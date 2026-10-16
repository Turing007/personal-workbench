import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let sessionCookie: string;
const stamp = Date.now();
const NAME = `E2E大图${stamp}`;
const CAT_A = `E2E分类甲${stamp}`;
const CAT_B = `E2E分类乙${stamp}`;
let withImage: { id: string; sku: string; name: string };
let withoutImage: { id: string; sku: string; name: string };
let uncategorized: { id: string; sku: string; name: string };

async function seedProduct(request: Page['request'], name: string, options: { image: boolean; category: string; purchasePrice?: number }) {
  const created = await request.post('/api/products', {
    data: {
      name,
      status: 'active',
      category: options.category,
      purchasePrice: options.purchasePrice ?? 0,
      packaging: [{ name: '彩盒包装', innerSize: '10×5×3', innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8, packCount: 24 }],
    },
  });
  if (!created.ok()) throw new Error(`创建产品失败：HTTP ${created.status()} ${await created.text()}`);
  const product = (await created.json()).data as { id: string; sku: string; name: string };
  if (options.image) {
    const uploaded = await request.post(`/api/products/${product.id}/images?category=product`, {
      multipart: { file: { name: 'e2e-gallery.png', mimeType: 'image/png', buffer: PNG_1X1 } },
    });
    if (!uploaded.ok()) throw new Error(`上传产品图片失败：HTTP ${uploaded.status()}`);
  }
  return product;
}

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
  withImage = await seedProduct(request, `${NAME}甲`, { image: true, category: CAT_A, purchasePrice: 88 });
  withoutImage = await seedProduct(request, `${NAME}乙`, { image: false, category: CAT_B });
  uncategorized = await seedProduct(request, `${NAME}丙`, { image: false, category: '' });
});

test.afterAll(async ({ request }) => {
  // afterAll 里的 request 是新的未登录实例，要先重新拿会话再清理。
  await ensureAuthenticated(request);
  for (const product of [withImage, withoutImage, uncategorized]) await request.delete(`/api/products/${product.id}`);
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
const search = (page: Page) => page.locator('.products-page .page-toolbar .search-control input');
const categoryTrigger = (page: Page) => page.locator('.products-page [aria-label="产品分类筛选"]');
const card = (page: Page, sku: string) => gallery(page).locator('.product-gallery-card', { hasText: sku });

test('桌面端：默认就是大图浏览，卡片带图片、价格与操作按钮', async ({ page }) => {
  await openProducts(page);

  // 默认大图；表格与手机卡片列表根本不该出现在 DOM 里。
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(gallery(page)).toBeVisible();
  await expect(page.locator('.products-table-desktop')).toHaveCount(0);
  await expect(page.locator('.products-card-list')).toHaveCount(0);

  await search(page).fill(NAME);
  await expect(gallery(page).locator('.product-gallery-card')).toHaveCount(3);

  const shot = card(page, withImage.sku);
  await expect(shot.locator('img')).toBeVisible();
  await expect(shot).toContainText(withImage.name);
  // 采购价默认显示（跟随小眼睛）。
  await expect(shot.locator('.product-gallery-price')).toHaveText('¥88');
  // 没填价格与没图的产品也要占位，不能空一块。
  await expect(card(page, uncategorized.sku).locator('.product-gallery-price')).toHaveText('—');
  await expect(card(page, withoutImage.sku).locator('.product-gallery-placeholder')).toHaveCount(1);

  // 卡片上的操作入口：编辑直接开编辑器。
  await shot.locator('button[title="编辑产品"]').click();
  const editor = page.getByRole('dialog');
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('textbox', { name: '品名' })).toHaveValue(withImage.name);
  await editor.locator('.modal-close').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 点图片区域开详情弹窗。
  await shot.locator('.product-gallery-open').click();
  await expect(page.getByRole('dialog')).toContainText(withImage.name);
  await page.getByRole('dialog').locator('.modal-close').click();

  // 切到列表视图后表格回来，选择被记住；刷新仍是列表。
  await toggle(page).click();
  await expect(page.locator('.products-table-desktop')).toBeVisible();
  await openProducts(page);
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.products-table-desktop')).toBeVisible();
});

test('桌面端：分类筛选与搜索、分页共用同一份结果', async ({ page }) => {
  await openProducts(page);
  await search(page).fill(NAME);
  await expect(gallery(page).locator('.product-gallery-card')).toHaveCount(3);
  await expect(page.locator('.products-pagination-summary')).toContainText('共 3 个产品');

  // 分类筛选改成幕布：点开触发器，分类以胶囊呈现，点胶囊即筛选。
  await expect(categoryTrigger(page)).toContainText('全部分类');
  await categoryTrigger(page).click();
  await page.locator('.category-filter-curtain .category-chip', { hasText: CAT_A }).click();
  await expect(gallery(page).locator('.product-gallery-card')).toHaveCount(1);
  await expect(card(page, withImage.sku)).toHaveCount(1);

  await categoryTrigger(page).click();
  await page.locator('.category-filter-curtain .category-chip', { hasText: CAT_B }).click();
  await expect(card(page, withoutImage.sku)).toHaveCount(1);

  // 「未分类」把没填分类的产品单独捞出来。
  await categoryTrigger(page).click();
  await page.locator('.category-filter-curtain .category-chip', { hasText: '未分类' }).click();
  await expect(gallery(page).locator('.product-gallery-card')).toHaveCount(1);
  await expect(card(page, uncategorized.sku)).toHaveCount(1);

  // 头部「清除」回到全部分类。
  await categoryTrigger(page).click();
  await page.locator('.category-filter-curtain .search-history-clear').click();
  await expect(gallery(page).locator('.product-gallery-card')).toHaveCount(3);
});

test('编辑器里的分类输入框带候选，能改能新填', async ({ page }) => {
  await openProducts(page);
  await search(page).fill(withImage.sku);
  await card(page, withImage.sku).locator('button[title="编辑产品"]').click();
  const editor = page.getByRole('dialog');
  const categoryInput = editor.locator('input[list="product-category-options"]');
  await expect(categoryInput).toHaveValue(CAT_A);
  // 候选来自现有产品分类（datalist 的 option 只有 value、没有文本节点，所以按属性选择）。
  await expect(editor.locator(`datalist#product-category-options option[value="${CAT_B}"]`)).toHaveCount(1);
  const fresh = `E2E新分类${stamp}`;
  await categoryInput.fill(fresh);
  await editor.locator('button.button-primary').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await categoryTrigger(page).click();
  await page.locator('.category-filter-curtain .category-chip', { hasText: fresh }).click();
  await search(page).fill(withImage.sku);
  await expect(card(page, withImage.sku)).toHaveCount(1);
});

test.describe('手机端', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('大图两列铺开，操作按钮可点且不产生横向滚动', async ({ page }) => {
    await openProducts(page, true);
    await search(page).fill(NAME);

    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(gallery(page).locator('.product-gallery-card')).toHaveCount(3);

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

    // 卡片上留编辑与复制；删除已经收进详情弹窗（见 product-discontinued.spec.ts）。
    const target = card(page, uncategorized.sku);
    await expect(target.locator('button[title="编辑产品"]')).toBeVisible();
    await expect(target.locator('button[title="删除产品"]')).toHaveCount(0);
    await target.locator('button[title="编辑产品"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').locator('.modal-close').click();
    await expect(card(page, uncategorized.sku)).toHaveCount(1);
  });
});

test('大图卡片：点图片开图片浏览，点名称或 SKU 才开产品详情', async ({ page }) => {
  await openProducts(page);
  await search(page).fill(NAME);

  // 图片：直接进图片浏览，不经过详情弹窗。
  await card(page, withImage.sku).locator('.product-gallery-image-button').click();
  const viewer = page.getByRole('dialog');
  await expect(viewer).toContainText('全部图片');
  await expect(viewer.locator('img').first()).toBeVisible();
  await viewer.locator('.modal-close').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 名称与 SKU 都指向产品详情。
  await card(page, withImage.sku).locator('.product-gallery-name').click();
  await expect(page.getByRole('dialog')).toContainText('产品详情');
  await page.getByRole('dialog').locator('.modal-close').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await card(page, withImage.sku).locator('.product-gallery-sku').click();
  await expect(page.getByRole('dialog')).toContainText('产品详情');
  await page.getByRole('dialog').locator('.modal-close').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 没图片的产品不给出可点的图片区，避免开一个空浏览。
  expect(await card(page, withoutImage.sku).locator('.product-gallery-image-button').count()).toBe(0);
  await card(page, withoutImage.sku).locator('.product-gallery-open').click();
  await expect(page.getByRole('dialog')).toContainText('产品详情');
});
