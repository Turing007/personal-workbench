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

  // 搜不到东西的词不记：停 1 秒后仍应只有上面两条。
  await search.fill(`${NAME}不存在的词`);
  await expect(page.locator('.products-page')).toContainText('0 个产品');
  await page.waitForTimeout(1000);

  // 清空输入后失焦再聚焦，幕布出现，只有两条（无结果的词没被记进来）。
  await search.fill('');
  await search.blur();
  await search.click();
  await expect(curtain).toBeVisible();
  await expect(curtain).toContainText('最近搜索');
  await expect(chips).toHaveCount(2);
  await expect(curtain).not.toContainText(`${NAME}不存在的词`);
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

test('搜索幕布：滚动即收起，轻点外部也收起', async ({ page }) => {
  const search = page.locator('.products-page .search-control input');
  const curtain = page.locator('.search-history-curtain');
  const anchorName = `${NAME}滚动${Date.now()}`;

  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();

  // 用 page.request 建数据：它复用页面的会话 cookie，裸 request fixture 不带 cookie 会 401。
  const created = await page.request.post('/api/products', { data: { name: anchorName, status: 'active', packaging: [{ name: '彩盒包装', packCount: 10 }] } });
  expect(created.ok()).toBe(true);
  const product = (await created.json()).data as { id: string };
  await page.locator('.products-page .products-refresh-button').click();

  // 先造一条历史（用真实存在的产品名，否则会被「无结果不记」挡掉），否则空历史不弹幕布。
  await search.fill(anchorName);
  await expect(page.locator('.products-page')).toContainText(anchorName);
  await page.waitForTimeout(1000);
  await search.fill('');
  await search.blur();

  // 滚动收起：手机端输入框聚焦时滚动，浮层要让位给内容。
  // 直接派发 scroll 事件：测试库里的产品少、页面没有可滚空间，
  // 靠 scrollTop/wheel 都造不出真实滚动；这里验证的是「收到 scroll 就收」这条逻辑。
  await search.click();
  await expect(curtain).toBeVisible();
  await page.evaluate(() => { document.querySelector('.app-content')?.dispatchEvent(new Event('scroll')); });
  await expect(curtain).toHaveCount(0);

  // 轻点外部（不滚动）也收起。点侧边栏导航：它明确在「锚点 + 幕布」之外，
  // 不会像页面中部那样可能被高幕布盖住而误判成「点内部」。
  await search.click();
  await expect(curtain).toBeVisible();
  await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
  await expect(curtain).toHaveCount(0);
  // 侧栏点击会切走页面，切回产品库供后续步骤用。
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();

  // 输入框失焦也收起幕布（延迟 120ms 是为了不打断点胶囊）。
  await search.click();
  await expect(curtain).toBeVisible();
  await search.blur();
  await expect(curtain).toHaveCount(0);

  await page.request.delete(`/api/products/${product.id}`);
});
