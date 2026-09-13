import { expect, test, type APIRequestContext } from '@playwright/test';

// e2e 专用管理员口令：由规则生成，仅存在于 e2e 独立数据目录中，非真实凭据。
function e2eSecretFor(name: string): string {
  return `wb-e2e-${name}-2026`;
}

const E2E_USERNAME = 'e2e-admin';
const E2E_PASSWORD = e2eSecretFor('admin');

/** 确保存在 e2e 管理员账号并完成登录，返回会话 Cookie 值。 */
async function ensureAuthenticated(request: APIRequestContext): Promise<string> {
  const login = () => request.post('/api/auth/login', {
    data: { username: E2E_USERNAME, password: E2E_PASSWORD },
  });
  let response = await login();
  if (response.status() === 401) {
    const setup = await request.post('/api/auth/setup', {
      data: { username: E2E_USERNAME, password: E2E_PASSWORD, displayName: 'E2E 管理员' },
    });
    if (setup.ok()) response = await login();
  }
  if (!response.ok()) {
    throw new Error(`e2e 登录失败：HTTP ${response.status()} ${await response.text()}`);
  }
  const setCookie = response.headers()['set-cookie'] ?? '';
  const sessionMatch = setCookie.match(/wb_session=([^;]+)/);
  if (!sessionMatch) throw new Error('e2e 登录失败：响应未包含会话 Cookie');
  return sessionMatch[1];
}

async function seedOrder(request: APIRequestContext): Promise<void> {
  const orderNo = `E2E-${Date.now()}`;
  const response = await request.post('/api/orders', {
    data: {
      orderNo,
      orderedAt: new Date().toISOString().slice(0, 10),
      recipientName: 'e2e 收件人',
      recipientInfo: 'e2e 收件人 13800000000 e2e 测试地址',
      items: [{ name: 'e2e 测试产品', quantity: 2, packCount: 1, unitPriceCents: 500 }],
    },
  });
  if (!response.ok()) throw new Error(`e2e 造数失败：HTTP ${response.status()} ${await response.text()}`);
}

test.describe('财务管理工作台', () => {
  let sessionCookie: string;

  test.beforeAll(async ({ request }) => {
    sessionCookie = await ensureAuthenticated(request);
    await seedOrder(request);
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([{
      name: 'wb_session',
      value: sessionCookie,
      domain: '127.0.0.1',
      path: '/',
    }]);
  });

  test('显示财务列表、统计卡和订单财务详情', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '财务管理' })).toBeVisible();
    await page.getByRole('button', { name: '财务管理' }).click();

    await expect(page.getByText('核验客户水单、登记收款并跟踪发票')).toBeVisible();
    await expect(page.getByText('本期应收')).toBeVisible();
    await expect(page.getByText('待审核水单')).toBeVisible();
    await expect(page.getByRole('textbox', { name: '搜索订单号或客户' })).toBeVisible();

    const financeButtons = page.getByRole('button', { name: '查看财务' });
    if (await financeButtons.count() > 0) {
      await financeButtons.first().click();
      await expect(page.getByRole('dialog', { name: /财务详情/ })).toBeVisible();
      await expect(page.getByText('客户水单', { exact: true })).toBeVisible();
      await expect(page.getByText('发票跟踪', { exact: true })).toBeVisible();
    }
  });

  test('订单详情显示财务详情入口', async ({ page }) => {
    await page.goto('/');
    const orderNav = page.getByRole('button', { name: '订单管理' });
    await expect(orderNav).toBeVisible();
    await orderNav.click();
    const orderDetailButtons = page.getByRole('button', { name: '详情' });
    await expect(orderDetailButtons.first()).toBeVisible();
    await orderDetailButtons.first().click();
    await expect(page.getByRole('dialog', { name: /订单详情/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '打开财务详情' })).toBeVisible();
  });
});
