import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

/**
 * 搜索框一键清空：有内容才出现小叉，点一下清空；
 * 清空不抢焦点（手机键盘不收起），列表立即恢复完整结果。
 */
let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test.describe('搜索框一键清空', () => {
  test('产品库：有内容出现小叉，点一下清空并恢复完整列表', async ({ page }) => {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();

    const input = page.locator('.products-page .search-control input');
    const count = page.locator('.products-page .toolbar-count');
    // 等产品加载完再取总数：数据目录积累较多产品时，列表加载会晚于工具条渲染，
    // 先取数会把加载中的「0 个产品」当成基准，清空后的断言必然对不上。
    await expect(page.locator('.products-page .table-state')).toHaveCount(0);
    const total = await count.textContent();

    await input.fill('绝不可能匹配的关键词zzz');
    await expect(count).toHaveText('0 个产品');
    const clear = page.locator('.products-page .search-clear');
    await expect(clear).toBeVisible();

    await clear.click();
    await expect(input).toHaveValue('');
    await expect(count).toHaveText(total ?? '');
    // 点完叉焦点仍在输入框：手机上可以接着打字，不用再点一次
    await expect(input).toBeFocused();
    // 空内容时小叉隐藏
    await expect(clear).toHaveCount(0);
  });

  test('报价单：客户选择器的小叉清空搜索词', async ({ page }) => {
    const name = `E2E清空客户${Date.now()}`;
    const created = await page.request.post('/api/customers', {
      data: { name, contactName: '清空测试', contactPhone: '13600000001' },
    });
    expect(created.ok()).toBeTruthy();
    const target = (await created.json()).data as { id: number };

    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '报价单', exact: true }).click();
    await page.getByRole('button', { name: '新建报价' }).click();
    const dialog = page.getByRole('dialog', { name: '新建报价单' });
    await expect(dialog).toBeVisible();

    const selector = dialog.getByRole('textbox', { name: '客户', exact: true });
    await selector.click();
    await selector.fill('E2E清空客户');
    const clear = dialog.getByRole('button', { name: '清空客户' });
    await expect(clear).toBeVisible();

    await clear.click();
    await expect(selector).toHaveValue('');
    await expect(clear).toHaveCount(0);
    // 清空只清输入，不把表单弄崩
    await expect(dialog).toBeVisible();

    await page.request.delete(`/api/customers/${target.id}`);
  });
});
