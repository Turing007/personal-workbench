import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';
import { useProductListView } from './helpers/products-view';

const SEED_COUNT = 25;
const DEFAULT_SIZE_ROWS = 20;
const TAIL_ROWS = SEED_COUNT - DEFAULT_SIZE_ROWS;
// 每次运行用时间戳做前缀，搜索它就能把结果精确锁在本用例造的产品上，不受其他用例干扰。
const TAG = `E2E分页${Date.now()}`;

let sessionCookie: string;
// 造 25 条产品：品名补零到两位，按品名排序即 01..25，所以第 1 页是 01-20，第 2 页是 21-25。
let seeded: Array<{ id: string; sku: string; name: string }> = [];

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
  for (let index = 1; index <= SEED_COUNT; index += 1) {
    const response = await request.post('/api/products', {
      data: {
        name: `${TAG}-${String(index).padStart(2, '0')}`,
        status: 'active',
        packaging: [{ name: '彩盒包装', innerSize: '10×5×3', innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8, packCount: 24 }],
      },
    });
    if (!response.ok()) throw new Error(`创建产品失败：HTTP ${response.status()} ${await response.text()}`);
    const product = (await response.json()).data as { id: string; sku: string };
    seeded.push({ id: product.id, sku: product.sku, name: `${TAG}-${index}` });
  }
});

test.afterAll(async ({ request }) => {
  // afterAll 里的 request 是新的未登录实例，要先重新拿会话再清理。
  await ensureAuthenticated(request);
  for (const product of seeded) await request.delete(`/api/products/${product.id}`);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
  await useProductListView(context);
});

async function openProducts(page: Page, mobile = false) {
  await page.goto('/');
  if (mobile) await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(TAG);
}

/** 品名序的第一条（补零后与创建序一致），落在第 1 页。 */
const firstByName = () => seeded[0];
/** 品名序的最后一条，落在第 2 页。 */
const lastByName = () => seeded[SEED_COUNT - 1];

test('桌面端：默认每页 20 条，可翻页、可换每页条数并记住选择', async ({ page }) => {
  await openProducts(page);

  const rows = page.locator('.products-table-desktop tbody tr');
  const search = page.locator('.products-page .page-toolbar .search-control input');
  const summary = page.locator('.products-pagination-summary');
  const position = page.locator('.products-pagination-page');
  const sizeSelect = page.locator('.products-pagination select[aria-label="每页显示条数"]');
  const prev = page.locator('.products-pagination button[aria-label="上一页"]');
  const next = page.locator('.products-pagination button[aria-label="下一页"]');
  await expect(search).toHaveValue(TAG);

  // 25 条按默认 20 条分页：第 1 页 20 条，品名序最后那条不在本页，而不是被丢掉。
  await expect(page.locator('.products-page .page-toolbar .toolbar-count')).toHaveText(`${SEED_COUNT} 个产品`);
  await expect(sizeSelect).toHaveValue('20');
  await expect(rows).toHaveCount(DEFAULT_SIZE_ROWS);
  await expect(summary).toHaveText(`共 ${SEED_COUNT} 个产品 · 第 1-${DEFAULT_SIZE_ROWS} 条`);
  await expect(position).toHaveText('第 1 / 2 页');
  await expect(rows.filter({ hasText: firstByName().sku })).toHaveCount(1);
  await expect(rows.filter({ hasText: lastByName().sku })).toHaveCount(0);
  await expect(prev).toBeDisabled();

  // 翻到第 2 页看到剩下的 5 条，含品名序最后那条；下一页到底后禁用。
  await page.locator('.products-pager').getByRole('button', { name: '2', exact: true }).click();
  await expect(rows).toHaveCount(TAIL_ROWS);
  await expect(rows.filter({ hasText: lastByName().sku })).toHaveCount(1);
  await expect(summary).toHaveText(`共 ${SEED_COUNT} 个产品 · 第 21-${SEED_COUNT} 条`);
  await expect(position).toHaveText('第 2 / 2 页');
  await expect(next).toBeDisabled();

  // 换成每页 50 条：一页装下全部，页码收成 1 页。
  await sizeSelect.selectOption('50');
  await expect(rows).toHaveCount(SEED_COUNT);
  await expect(position).toHaveText('第 1 / 1 页');

  // 每页条数是本地偏好：重新进页面还是 50。
  await openProducts(page);
  await expect(sizeSelect).toHaveValue('50');
  await expect(rows).toHaveCount(SEED_COUNT);

  // 回到 20 条并翻到第 2 页，此时改搜索词应当回到第 1 页。
  await sizeSelect.selectOption('20');
  await page.locator('.products-pager').getByRole('button', { name: '2', exact: true }).click();
  await expect(position).toHaveText('第 2 / 2 页');
  await search.fill(firstByName().sku);
  await expect(rows).toHaveCount(1);
  await expect(position).toHaveText('第 1 / 1 页');
});

test.describe('手机端', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('卡片列表分页可点，分页条不产生横向滚动', async ({ page }) => {
    await openProducts(page, true);

    const cards = page.locator('.products-card-list .product-card:visible');
    const next = page.locator('.products-pagination button[aria-label="下一页"]');
    const prev = page.locator('.products-pagination button[aria-label="上一页"]');

    await expect(cards).toHaveCount(DEFAULT_SIZE_ROWS);
    await expect(cards.filter({ hasText: lastByName().sku })).toHaveCount(0);
    await expect(prev).toBeDisabled();

    await next.tap();
    await expect(cards).toHaveCount(TAIL_ROWS);
    await expect(cards.filter({ hasText: lastByName().sku })).toHaveCount(1);
    await expect(page.locator('.products-pagination-page')).toHaveText(`第 2 / 2 页`);

    // 分页条落在屏幕内：手机端左右滑动手势麻烦，出现横向滚动即为回归。
    const metrics = await page.evaluate(() => {
      const scroller = document.querySelector('.app-content') as HTMLElement;
      const bar = document.querySelector('.products-pagination') as HTMLElement;
      return {
        scrollerOverflow: scroller.scrollWidth - scroller.clientWidth,
        barOverflow: bar.scrollWidth - bar.clientWidth,
        barRight: Math.round(bar.getBoundingClientRect().right),
        viewportWidth: window.innerWidth,
      };
    });
    expect(metrics.scrollerOverflow).toBeLessThanOrEqual(0);
    expect(metrics.barOverflow).toBeLessThanOrEqual(0);
    expect(metrics.barRight).toBeLessThanOrEqual(metrics.viewportWidth);
  });
});
