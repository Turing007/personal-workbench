import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

async function seedCustomer(page: Page, stamp: number) {
  const customerName = `E2E浮层客户${stamp}`;
  const customer = await (await page.request.post('/api/customers', {
    data: { name: customerName, contactName: '李四', contactPhone: '13900000002' },
  })).json();
  const product = await page.request.post(`/api/customers/${customer.data.id}/products`, {
    data: { name: `E2E浮层产品${stamp}`, sku: `OV-${stamp}`, packCount: 10, finalPriceCents: 10000, costPriceCents: 5000, costConfirmed: true },
  });
  expect(product.ok()).toBeTruthy();
  return { customerId: Number(customer.data.id), customerName };
}

test.describe('客户产品库客户档案浮层', () => {
  test('桌面端：客户搜索与新增在面板内，展开不挤压产品表格，收起后留标签可再展开', async ({ page }) => {
    const stamp = Date.now();
    const { customerId, customerName } = await seedCustomer(page, stamp);
    try {
      await page.goto('/');
      await page.locator('.sidebar-nav').getByRole('button', { name: '客户', exact: true }).click();
      const panel = page.locator('.customer-list-panel');
      await expect(panel).toBeVisible();
      await expect(panel.getByPlaceholder('搜索客户名称、联系人、电话')).toBeVisible();
      await expect(panel.getByRole('button', { name: '新增客户' })).toBeVisible();

      const table = page.locator('.customer-products-table-desktop');
      await expect(table).toBeVisible();
      const expandedWidth = (await table.boundingBox())?.width ?? 0;
      expect(expandedWidth).toBeGreaterThan(0);

      // 收起：面板消失，左侧留「客户」标签；产品表格宽度不被挤压。
      await panel.getByRole('button', { name: '收起客户列表' }).click();
      await expect(page.locator('.customer-list-panel')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '展开客户列表' })).toBeVisible();
      const collapsedWidth = (await table.boundingBox())?.width ?? 0;
      expect(Math.abs(collapsedWidth - expandedWidth)).toBeLessThanOrEqual(1);

      // 再展开仍是浮层：宽度不变，选中客户后面板自动收起。
      await page.getByRole('button', { name: '展开客户列表' }).click();
      await expect(page.locator('.customer-list-panel')).toBeVisible();
      const reopenedWidth = (await table.boundingBox())?.width ?? 0;
      expect(Math.abs(reopenedWidth - expandedWidth)).toBeLessThanOrEqual(1);
      await page.locator('.customer-list-panel .customer-list-item', { hasText: customerName }).first().click();
      await expect(page.locator('.customer-list-panel')).toHaveCount(0);
      await expect(page.locator('.customer-products-heading')).toContainText(customerName);
    } finally {
      await page.request.delete(`/api/customers/${customerId}`);
    }
  });

  test.describe('手机端', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('客户搜索与新增都收进「N 个客户」抽屉', async ({ page }) => {
      const stamp = Date.now();
      const { customerId } = await seedCustomer(page, stamp);
      try {
        await page.goto('/');
        await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
        await page.getByRole('button', { name: '客户', exact: true }).last().click();
        await page.locator('.customer-list-trigger:visible').first().click();
        const drawer = page.getByRole('dialog', { name: '客户档案' });
        await expect(drawer.getByPlaceholder('搜索客户名称、联系人、电话')).toBeVisible();
        await expect(drawer.getByRole('button', { name: '新增客户' })).toBeVisible();
      } finally {
        await page.request.delete(`/api/customers/${customerId}`);
      }
    });
  });
});
