import { expect, test } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

/**
 * 模拟手机通过 http://局域网IP:端口 访问：navigator.clipboard 不存在，
 * copyText 会走 textarea + execCommand 兜底，正好覆盖「真机点复制没反应」的场景。
 */
async function forceInsecureContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { get: () => false, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const captured: string[] = [];
    (window as unknown as { __copiedTexts: string[] }).__copiedTexts = captured;
    document.execCommand = ((commandId: string) => {
      if (commandId === 'copy' && document.activeElement instanceof HTMLTextAreaElement) {
        captured.push(document.activeElement.value);
      }
      return true;
    }) as typeof document.execCommand;
  });
}

test('公司档案可复制开票信息（局域网 http 兜底，不含可开票类目）', async ({ page, context }) => {
  await forceInsecureContext(context);
  const stamp = Date.now();
  const companyName = `宁波测试工具有限公司${stamp}`;
  const response = await page.request.post('/api/finance/companies', {
    data: {
      fullName: companyName,
      taxNo: '91330200TEST000001',
      address: '浙江省宁波市鄞州区测试路 1 号',
      phone: '0574-88886666',
      bankName: '中国银行宁波分行',
      bankAccount: '123456789012345678',
      invoiceCategories: ['电动工具', '电池', '充电器'],
    },
  });
  expect(response.ok()).toBeTruthy();
  const companyId = (await response.json()).data.id as number;
  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '财务', exact: true }).click();
    await page.getByRole('button', { name: '公司档案' }).click();
    const row = page.getByRole('dialog', { name: '公司档案' }).locator('.company-row', { hasText: companyName });
    await expect(row).toContainText('电动工具、电池、充电器');
    await row.getByTitle('复制开票信息（可直接发给客户）').click();
    await expect(page.locator('.toast', { hasText: `已复制「${companyName}」开票信息，可直接发给客户` })).toBeVisible();
    const copied = await page.evaluate(() => (window as unknown as { __copiedTexts: string[] }).__copiedTexts);
    expect(copied).toEqual([[
      '【开票信息】',
      `公司名称：${companyName}`,
      '纳税人识别号：91330200TEST000001',
      '注册地址：浙江省宁波市鄞州区测试路 1 号',
      '联系电话：0574-88886666',
      '开户行：中国银行宁波分行',
      '银行账号：123456789012345678',
    ].join('\n')]);
  } finally {
    await page.request.delete(`/api/finance/companies/${companyId}`);
  }
});
