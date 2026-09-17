import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

const STATUS_FILTERS = ['全部订单', '草稿', '待备货', '已备货', '待打包', '待发货', '已发货'];

// 从最窄的小屏一路覆盖到常见的中等尺寸：任何一档都必须收成两行，
// 用 auto-fit 之类的自适应列数会在一窄机型上掉到三列、变成三行。
const VIEWPORT_WIDTHS = [360, 390, 430];

for (const viewportWidth of VIEWPORT_WIDTHS) {
  test.describe(`视口宽度 ${viewportWidth}px`, () => {
    test.use({ viewport: { width: viewportWidth, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

    /**
     * 手机端的状态筛选原来是一条横向滚动条，选「待发货 / 已发货」必须先滑到最右，滑动还不跟手。
     * 这里钉住四件事：7 个状态全部平铺可见、整条筛选区不产生横向溢出（不用滑）、
     * 稳定收成两行、状态名不被省略号截断，且点一下即切换选中。
     */
    test('手机端订单筛选：7 个状态平铺成两行且不用横滑，点一下即切换', async ({ page }) => {
      await page.goto('/');
      await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
      await page.locator('.sidebar-nav').getByRole('button', { name: '订单管理', exact: true }).click();

      const filters = page.locator('.orders-page .status-cards .status-card');
      await expect(filters).toHaveCount(STATUS_FILTERS.length);
      for (const label of STATUS_FILTERS) {
        await expect(page.locator('.orders-page .status-cards .status-card', { hasText: label })).toBeVisible();
      }

      // 关掉横滑的判据有两层：容器自身不滚动，且每个按钮都真的落在视口横向范围内
      const container = await page.locator('.orders-page .status-cards').evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
      expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth + 1);

      const boxes = await filters.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
      const outside = boxes.filter((box) => box.left < -0.5 || box.right > viewportWidth + 0.5);
      expect(outside).toEqual([]);

      const probe = await page.locator('.orders-page .status-cards').evaluate((node) => ({
        rows: new Set(Array.from(node.querySelectorAll<HTMLElement>('.status-card'), (card) => Math.round(card.getBoundingClientRect().top))).size,
        truncated: Array.from(node.querySelectorAll<HTMLElement>('.status-card-label'), (label) => label.scrollWidth > label.clientWidth + 1).filter(Boolean).length,
        tallest: Math.max(...Array.from(node.querySelectorAll<HTMLElement>('.status-card'), (card) => card.getBoundingClientRect().height)),
      }));

      // 7 个状态固定「4 + 3」两行，多了就是没压紧
      expect(probe.rows).toBe(2);
      // 状态名不能被省略号吃掉，否则「待备货 / 已备货」这类只差一个字的状态会分不清
      expect(probe.truncated).toBe(0);
      // 胶囊已压缩：单颗高度不应再撑到 40px
      expect(probe.tallest).toBeLessThan(40);

      // 直接点选：最后一个状态也不用先滚动就能点到，选中态随之切换
      const shipped = page.locator('.orders-page .status-cards .status-card', { hasText: '已发货' });
      await shipped.click();
      await expect(shipped).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.orders-page .status-cards .status-card', { hasText: '全部订单' })).toHaveAttribute('aria-pressed', 'false');

      // 零单的状态压到 60% 透明度，把对比度让给有单的状态；但不能靠写死的状态名单，
      // 必须由真实数量决定，否则某天「已发货」有单了还会被压暗。
      const readShading = () =>
        filters.evaluateAll((nodes) =>
          nodes.map((node) => ({
            isEmpty: node.classList.contains('is-empty'),
            active: node.getAttribute('aria-pressed') === 'true',
            count: Number((node as HTMLElement).dataset.count),
            opacity: Number(getComputedStyle(node).opacity),
          })),
        );

      // 用轮询而不是取瞬时值：刚点过的那颗正处于「60% → 100%」的过渡动画里，
      // 直接读会拿到中间帧（实测 0.83），看起来像 bug，其实只是没等它落定。
      await expect
        .poll(async () => {
          const shading = await readShading();
          return shading.filter(
            (card) => card.isEmpty !== (card.count === 0) || card.opacity !== (card.isEmpty && !card.active ? 0.6 : 1),
          );
        })
        .toEqual([]);

      // 选中的那颗（刚点的「已发货」，恰好是零单状态）必须回到满不透明，不能和「被禁用」撞脸
      await expect(shipped).toHaveCSS('opacity', '1');
      // 确认这份数据里确实存在零单的胶囊，否则上面的断言等于空跑
      expect((await readShading()).filter((card) => card.isEmpty).length).toBeGreaterThan(0);
    });
  });
}
