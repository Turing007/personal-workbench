import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

interface CustomerPayload {
  id: number;
  name: string;
  contactName: string;
  contactPhone: string;
}

test.describe('报价单客户选择', () => {
  test('新建报价单：选择已有客户后自动填充客户信息并保存', async ({ page }) => {
    // 并行用例共享同一个隔离数据库，直接抓“第一个客户”会被其它用例的清理删掉；
    // 这里自建客户再走“选择已有客户”流程，保证测试独立。
    const stamp = Date.now();
    const name = `E2E已有客户${stamp}`;
    const created = await page.request.post('/api/customers', {
      data: { name, contactName: '已有联系人', contactPhone: '13600000000', shippingInfo: '广州市天河区' },
    });
    expect(created.ok()).toBeTruthy();
    const target = (await created.json()).data as CustomerPayload;

    await page.goto('/');
    await page.getByRole('button', { name: '报价单' }).click();

    await page.getByRole('button', { name: '新建报价' }).click();
    const dialog = page.getByRole('dialog', { name: '新建报价单' });
    await expect(dialog).toBeVisible();

    const selector = dialog.getByRole('textbox', { name: '客户', exact: true });
    await selector.click();
    await selector.fill(target.name.slice(0, 2));
    await dialog.getByRole('option').filter({ hasText: target.name }).first().click();

    await expect(dialog.getByRole('textbox', { name: '客户名称' })).toHaveValue(target.name);
    await expect(dialog.getByRole('textbox', { name: '联系人', exact: true })).toHaveValue(target.contactName ?? '');
    // “联系电话”在“公司显示”区块也有一份（公司自己的电话），客户区块在前，取第一个
    await expect(dialog.getByRole('textbox', { name: '联系电话', exact: true }).first()).toHaveValue(target.contactPhone ?? '');

    await dialog.getByRole('button', { name: /编辑产品明细/ }).click();
    const itemsDialog = page.getByRole('dialog', { name: '产品明细' });
    await expect(itemsDialog).toBeVisible();
    await itemsDialog.getByPlaceholder('品名').fill('E2E测试产品');
    await itemsDialog.getByLabel('单价').first().fill('12.5');
    await itemsDialog.getByRole('button', { name: '完成', exact: true }).click();

    await dialog.getByRole('button', { name: '保存报价单' }).click();
    await expect(page.getByText('报价单已保存', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: /编辑报价 · BJ/ })).toBeVisible();

    // 清理测试数据
    const title = await page.getByRole('dialog', { name: /编辑报价 · BJ/ }).textContent();
    const number = /BJ\d+/.exec(title ?? '')?.[0];
    if (number) {
      const list = await page.request.get('/api/quotations?q=' + encodeURIComponent(number));
      const { data: listData } = (await list.json()) as { data: { rows: Array<{ id: number; number: string }> } };
      const quotation = listData.rows.find((row) => row.number === number);
      if (quotation) await page.request.delete(`/api/quotations/${quotation.id}`);
    }
    await page.request.delete(`/api/customers/${target.id}`);
  });

  test('新建报价单：快速新增客户后自动选中并保存', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    await page.getByRole('button', { name: '报价单' }).click();

    await page.getByRole('button', { name: '新建报价' }).click();
    const dialog = page.getByRole('dialog', { name: '新建报价单' });
    await expect(dialog).toBeVisible();

    const selector = dialog.getByRole('textbox', { name: '客户', exact: true });
    await selector.click();
    await dialog.getByRole('button', { name: /快速新增客户/ }).click();

    const customerDialog = page.getByRole('dialog', { name: '新增客户' });
    await expect(customerDialog).toBeVisible();
    const customerName = `E2E客户${Date.now().toString().slice(-6)}`;
    await customerDialog.getByPlaceholder(/例如：张三/).fill(customerName);
    await customerDialog.getByRole('button', { name: '保存客户' }).click();
    await expect(customerDialog).not.toBeVisible();

    await expect(dialog.getByRole('textbox', { name: '客户名称' })).toHaveValue(customerName);
    await expect(selector).toHaveValue(customerName);

    await dialog.getByRole('button', { name: /编辑产品明细/ }).click();
    const itemsDialog = page.getByRole('dialog', { name: '产品明细' });
    await expect(itemsDialog).toBeVisible();
    await itemsDialog.getByPlaceholder('品名').fill('E2E测试产品');
    await itemsDialog.getByLabel('单价').first().fill('8.8');
    await itemsDialog.getByRole('button', { name: '完成', exact: true }).click();

    await dialog.getByRole('button', { name: '保存报价单' }).click();
    await expect(page.getByText('报价单已保存', { exact: true })).toBeVisible();

    // 清理测试数据（删除新建的报价单与客户）
    const title = await page.getByRole('dialog', { name: /编辑报价 · BJ/ }).textContent();
    const number = /BJ\d+/.exec(title ?? '')?.[0];
    const list = await page.request.get('/api/quotations?q=' + encodeURIComponent(number ?? customerName));
    const { data: listData } = (await list.json()) as { data: { rows: Array<{ id: number; number: string; customerId: number | null }> } };
    const created = listData.rows.find((row) => row.number === number);
    if (created) {
      const customerId = created.customerId;
      await page.request.delete(`/api/quotations/${created.id}`);
      if (customerId) await page.request.delete(`/api/customers/${customerId}`);
    }
  });
});
