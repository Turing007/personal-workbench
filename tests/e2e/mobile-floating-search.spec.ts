import { expect, test } from '@playwright/test';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

/**
 * 用 CDP 派发真实触摸事件来模拟手指滑动。
 * 不要用 page.mouse.wheel 代替：滚轮不会走移动端的滚动路径，测出来的是假象
 * （曾经因此放过一个真机上完全不生效的 bug）。
 */
function createFlick(page: Page, client: CDPSession) {
  return async (fromY: number, toY: number, steps: number) => {
    const x = 195;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: fromY }] });
    for (let i = 1; i <= steps; i += 1) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: fromY + ((toY - fromY) * i) / steps }],
      });
      await page.waitForTimeout(10);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
  };
}

function readScrollY(page: Page): Promise<number> {
  return page.evaluate(() => Math.round(window.scrollY));
}

async function openModule(page: Page, label: string) {
  await page.goto('/');
  await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
  await page.locator('.sidebar-nav').getByRole('button', { name: label, exact: true }).click();
}

/** 塞一段占位内容，保证页面一定滚得动，不依赖测试库里的业务数据量。 */
async function stretchPage(page: Page, pageSelector: string) {
  await page.evaluate((target) => {
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    document.querySelector(target)?.appendChild(spacer);
  }, pageSelector);
}

/**
 * 悬浮搜索框的核心行为：下滑收起，往上短滑一点点就该唤回。
 * 最后两条 boundingBox 断言是关键 —— 必须确认搜索框真的落在视口内，
 * 只断言 class 会漏掉「已展开但被定位到页面外、肉眼看不见」的情况。
 */
async function expectFloatingSearchRevealsOnShortSlideBack(
  page: Page,
  context: BrowserContext,
  moduleLabel: string,
  pageSelector: string,
  searchSelector: string,
) {
  await openModule(page, moduleLabel);

  const search = page.locator(searchSelector);
  await expect(search).toBeVisible();
  await stretchPage(page, pageSelector);

  const client = await context.newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const flick = createFlick(page, client);

  await flick(620, 180, 20);
  await expect(search).toHaveClass(/is-scroll-hidden/);
  expect(await readScrollY(page)).toBeGreaterThan(200);

  await flick(200, 260, 6);
  await expect(search).not.toHaveClass(/is-scroll-hidden/);
  expect(await readScrollY(page)).toBeGreaterThan(200);

  const box = await search.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeLessThan(200);
}

test('手机端产品库：短距离回滑即可唤回悬浮搜索框，且搜索框真的落在视口内', async ({ page, context }) => {
  await expectFloatingSearchRevealsOnShortSlideBack(
    page,
    context,
    '产品库',
    '.products-page',
    '.products-page .page-toolbar .search-control',
  );
});

test('手机端订单管理：短距离回滑即可唤回悬浮搜索框，且搜索框真的落在视口内', async ({ page, context }) => {
  await expectFloatingSearchRevealsOnShortSlideBack(
    page,
    context,
    '订单管理',
    '.orders-page',
    '.orders-page .orders-table-toolbar .search-control',
  );
});

/**
 * 客户产品库的客户列表已改走左侧抽屉，页面里因此同时存在两个 .search-control：
 * 工具条上那个 fixed 的悬浮框（外层 .page-toolbar）和抽屉里 / 产品子工具条里的普通搜索框。
 * 选择器必须锁死在外层 .page-toolbar 上，否则会抓到产品筛选框——它不参与滚动隐藏，
 * is-scroll-hidden 断言会永远失败。
 */
test('手机端客户产品库：短距离回滑即可唤回悬浮搜索框，且搜索框真的落在视口内', async ({ page, context }) => {
  await expectFloatingSearchRevealsOnShortSlideBack(
    page,
    context,
    '客户产品库',
    '.customer-products-page',
    '.customer-products-page .page-toolbar .search-control',
  );
});
