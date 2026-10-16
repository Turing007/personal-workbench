import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

/**
 * 产品库搜索框的历史记录幕布：聚焦弹出的不是列表式下拉，而是一块幕布，
 * 关键词按胶囊排布，点一下直接搜；可删单条、可清空。
 */
let sessionCookie: string;
const stamp = Date.now();
const NAME = `E2E历史${stamp}`;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
  for (const suffix of ['甲', '乙']) {
    const created = await request.post('/api/products', {
      data: { name: `${NAME}${suffix}`, status: 'active', packaging: [{ name: '彩盒包装', packCount: 10 }] },
    });
    if (!created.ok()) throw new Error(`创建产品失败：HTTP ${created.status()}`);
  }
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
  // 每个用例从干净的搜索历史开始（历史存 localStorage，同一 context 会串）。
  await context.addInitScript(() => window.localStorage.removeItem('workbench:search-history'));
});

test('搜索历史：停顿后记入、幕布胶囊可点即搜、可删单条与清空', async ({ page }) => {
  const search = page.locator('.products-page .search-control input');
  const curtain = page.locator('.search-history-curtain');
  const chips = page.locator('.search-history-chip-main');

  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await expect(curtain).toHaveCount(0);

  // 两次搜索（停顿超过 800ms 才记）：最新的排最前。
  await search.fill(`${NAME}甲`);
  await page.waitForTimeout(1000);
  await search.fill(`${NAME}乙`);
  await page.waitForTimeout(1000);

  // 清空输入后失焦再聚焦，幕布出现，含两条胶囊（最新在前）。
  await search.fill('');
  await search.blur();
  await search.click();
  await expect(curtain).toBeVisible();
  await expect(curtain).toContainText('最近搜索');
  await expect(chips).toHaveCount(2);
  await expect(chips.first()).toHaveText(`${NAME}乙`);

  // 点胶囊直接搜：输入框填入该词、幕布收起、列表只剩对应产品。
  await chips.nth(1).click();
  await expect(search).toHaveValue(`${NAME}甲`);
  await expect(curtain).toHaveCount(0);
  await expect(page.locator('.products-page')).toContainText(`${NAME}甲`);
  await expect(page.locator('.products-page')).not.toContainText(`${NAME}乙`);

  // 删单条：只剩「乙」。
  await search.click();
  await page.locator('.search-history-chip', { hasText: `${NAME}甲` }).locator('.search-history-chip-remove').click();
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toHaveText(`${NAME}乙`);

  // 清空历史：幕布收起、再聚焦也不再出现。
  await page.locator('.search-history-clear').click();
  await expect(curtain).toHaveCount(0);
  await search.blur();
  await search.click();
  await expect(curtain).toHaveCount(0);

  // 清理测试数据。
  const list = await page.request.get('/api/products?limit=100');
  const items = ((await list.json()).data as { items: Array<{ id: string; name: string }> }).items;
  for (const item of items.filter((entry) => entry.name.startsWith(NAME))) {
    await page.request.delete(`/api/products/${item.id}`);
  }
});
