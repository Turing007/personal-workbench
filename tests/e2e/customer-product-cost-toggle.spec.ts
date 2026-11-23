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

const COST_TEXT = '¥61.23';
const FINAL_TEXT = '¥88.00';

/** 建一个客户 + 一个带成本价的客户产品；成本价 5123 分、最终价格 8800 分。 */
async function seedCustomerProduct(page: Page, stamp: number, overrides: Record<string, unknown> = {}) {
  const customerName = `E2E成本价隐藏${stamp}`;
  const customer = await (await page.request.post('/api/customers', {
    data: { name: customerName, contactName: '张三', contactPhone: '13900000001', shippingInfo: '杭州市西湖区' },
  })).json();
  const created = await page.request.post(`/api/customers/${customer.data.id}/products`, {
    data: {
      name: `E2E吸尘器电机${stamp}`,
      specification: '120W',
      sku: `CP-${stamp}`,
      packCount: 10,
      finalPriceCents: 8800,
      costPriceCents: 5123,
      batteryCostCents: 1000,
      chargerCostCents: 0,
      packagingCostCents: 0,
      accessoryCostCents: 0,
      otherCostCents: 0,
      costConfirmed: true,
      freightPerBoxCents: 500,
      ...overrides,
    },
  });
  expect(created.ok()).toBeTruthy();
  return { customerId: Number(customer.data.id), customerName };
}

async function openCustomerProducts(page: Page, customerName: string) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '客户', exact: true }).click();
  await page.locator('.customer-list-item:visible').filter({ hasText: customerName }).first().click();
}

test.describe('客户产品库成本价显隐', () => {
  test('桌面表格：默认收起成本价，点眼睛展开、再点收回', async ({ page }) => {
    const stamp = Date.now();
    const { customerId, customerName } = await seedCustomerProduct(page, stamp);
    try {
      await openCustomerProducts(page, customerName);
      const table = page.locator('.customer-products-table-desktop');
      await expect(table).toBeVisible();
      // 默认隐藏：整列消失（不是留个空值），最终价格照常显示。
      await expect(table.getByRole('columnheader', { name: '成本价' })).toHaveCount(0);
      await expect(table.getByText(COST_TEXT)).toHaveCount(0);
      await expect(table.getByText(FINAL_TEXT)).toBeVisible();

      await page.getByRole('button', { name: '显示成本价' }).click();
      await expect(table.getByRole('columnheader', { name: '成本价' })).toBeVisible();
      await expect(table.getByText(COST_TEXT)).toBeVisible();

      await page.getByRole('button', { name: '隐藏成本价' }).click();
      await expect(table.getByRole('columnheader', { name: '成本价' })).toHaveCount(0);
      await expect(table.getByText(COST_TEXT)).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/customers/${customerId}`);
    }
  });

  test('未核对标准成本时显示未核对成本', async ({ page }) => {
    const stamp = Date.now();
    const { customerId, customerName } = await seedCustomerProduct(page, stamp, { costConfirmed: false });
    try {
      await openCustomerProducts(page, customerName);
      await page.getByRole('button', { name: '显示成本价' }).click();
      const row = page.locator('.customer-products-table-desktop tbody tr', { hasText: `E2E吸尘器电机${stamp}` }).first();
      await expect(row).toContainText('未核对成本');
      await expect(row.getByText(COST_TEXT)).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/customers/${customerId}`);
    }
  });

  test('客户产品编辑器可维护其他单件成本并显示合计', async ({ page }) => {
    const stamp = Date.now();
    const { customerId, customerName } = await seedCustomerProduct(page, stamp);
    try {
      await openCustomerProducts(page, customerName);
      const row = page.locator('.customer-products-table-desktop tbody tr', { hasText: `E2E吸尘器电机${stamp}` }).first();
      await row.getByRole('button', { name: '编辑客户产品' }).click();
      const editor = page.getByRole('dialog', { name: '编辑客户产品' });
      await editor.getByText('其他单件成本与利润口径').click();
      await expect(editor.getByText('其他单件成本与利润口径')).toBeVisible();
      await expect(editor.getByLabel('电池成本（元）')).toHaveValue('10.00');
      await expect(editor.getByLabel('包装成本（元/件）')).toHaveValue('0.00');
      await expect(editor).toContainText('单件合计 ¥ 61.23');
    } finally {
      await page.request.delete(`/api/customers/${customerId}`);
    }
  });

  test.describe('手机端卡片', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('成本价字段同样跟随小眼睛', async ({ page }) => {
      const stamp = Date.now();
      const { customerId, customerName } = await seedCustomerProduct(page, stamp);
      try {
        await page.goto('/');
        // 窄屏下「客户产品库」收在底部 Tab 的更多模块抽屉里，侧栏按钮是隐藏的。
        await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
        await page.getByRole('button', { name: '客户', exact: true }).last().click();
        // 客户列表也收进抽屉，先开抽屉再选人。
        await page.locator('.customer-list-trigger:visible').first().click();
        await page.locator('.customer-list-item:visible').filter({ hasText: customerName }).first().click();
        const card = page.locator('.customer-product-card:visible').first();
        await expect(card).toBeVisible();
        await expect(card.locator('.customer-product-card-field', { hasText: '成本价' })).toHaveCount(0);
        await expect(card.getByText(FINAL_TEXT)).toBeVisible();

        await page.getByRole('button', { name: '显示成本价' }).click();
        await expect(card.locator('.customer-product-card-field', { hasText: '成本价' })).toContainText(COST_TEXT);
      } finally {
        await page.request.delete(`/api/customers/${customerId}`);
      }
    });
  });
});
