import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dateInputValue } from '../../src/shared/date-input';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

async function seedOrder(page: Page, orderNo: string) {
  const response = await page.request.post('/api/orders', {
    data: {
      orderNo,
      orderedAt: dateInputValue(),
      recipientName: '刷新测试收件人',
      recipientInfo: '刷新测试收件人 13800000000 深圳市南山区',
      items: [{ name: `E2E刷新产品${orderNo}`, sku: `E2E-REFRESH-${orderNo}`, specification: '标准', packagingName: '彩盒', packCount: 1, quantity: 1, unitPriceCents: 1000 }],
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return Number((await response.json()).data.id);
}

test('订单页内刷新：已发货后面的按钮可拉取新增订单，手机在订单数旁', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  const firstOrderNo = `E2E-REFRESH-A-${stamp}`;
  const secondOrderNo = `E2E-REFRESH-B-${stamp}`;
  const firstOrderId = await seedOrder(page, firstOrderNo);
  let secondOrderId: number | undefined;

  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await expect(page.locator('.orders-table-desktop tbody tr', { hasText: firstOrderNo }).first()).toBeVisible();
    await expect(page.locator('.orders-table-desktop tbody tr', { hasText: secondOrderNo })).toHaveCount(0);

    // 页面打开后在另一端新增订单，页内刷新应拉回来，不依赖浏览器刷新。
    secondOrderId = await seedOrder(page, secondOrderNo);
    const refresh = page.locator('.orders-refresh-desktop:visible');
    await expect(refresh).toHaveCount(1);
    const placement = await refresh.evaluate((element) => ({
      previousClass: element.previousElementSibling?.className ?? '',
      previousText: element.previousElementSibling?.textContent?.trim() ?? '',
    }));
    expect(placement.previousClass).toContain('status-cards');
    expect(placement.previousText).toContain('已发货');

    await refresh.click();
    await expect(page.locator('.orders-table-desktop tbody tr', { hasText: secondOrderNo }).first()).toBeVisible({ timeout: 15000 });
    await expect(refresh).toBeEnabled();

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileRefresh = page.locator('.orders-refresh-inline:visible');
    await expect(mobileRefresh).toHaveCount(1);
    await expect(page.locator('.orders-refresh-desktop:visible')).toHaveCount(0);
    const countBox = await page.locator('.orders-table-toolbar .toolbar-count').boundingBox();
    const refreshBox = await mobileRefresh.boundingBox();
    expect(countBox && refreshBox && Math.abs(countBox.y - refreshBox.y) < 4).toBe(true);
    expect(countBox && refreshBox && refreshBox.x > countBox.x).toBe(true);
  } finally {
    if (secondOrderId) await page.request.delete(`/api/orders/${secondOrderId}`);
    await page.request.delete(`/api/orders/${firstOrderId}`);
  }
});
