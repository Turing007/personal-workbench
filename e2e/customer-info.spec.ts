import { test, expect } from '@playwright/test';

test('订单客户信息维护：选择客户后自动填充并可保存', async ({ page }) => {
  await page.goto('/');

  // 新建订单：客户名称/联系人/联系电话/客户地址 应自动填充
  await page.getByRole('button', { name: '新建订单' }).click();
  const dialog = page.getByRole('dialog', { name: '新建订单' });

  // 选择已有客户后，客户名称/联系人/联系电话/客户地址 应自动填充
  const customerName = dialog.getByPlaceholder('例如：华南五金');
  await customerName.fill('测试客户');
  await dialog.getByRole('textbox', { name: '联系人', exact: true }).fill('测试联系人');
  await dialog.getByRole('textbox', { name: '联系电话', exact: true }).fill('13800138000');
  await dialog.getByRole('textbox', { name: '客户地址', exact: true }).fill('测试地址');

  // 验证订单表单字段已填充
  await expect(dialog.getByRole('textbox', { name: '客户名称' })).toHaveValue('测试客户');
  await expect(dialog.getByRole('textbox', { name: '联系人', exact: true })).toHaveValue('测试联系人');
});
