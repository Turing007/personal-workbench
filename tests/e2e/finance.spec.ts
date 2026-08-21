import { expect, test } from '@playwright/test';

test.describe('财务管理工作台', () => {
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
    await expect(page.getByRole('button', { name: '财务详情' })).toBeVisible();
  });
});
