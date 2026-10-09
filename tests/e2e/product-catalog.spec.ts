import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test.describe.configure({ timeout: 120_000 });

/** 建一个在售产品（图册选品默认只看在售）。 */
async function seedProduct(page: import('@playwright/test').Page, name: string, stamp: number) {
  const created = await page.request.post('/api/products', {
    data: {
      name,
      supplier: 'E2E图册供应商',
      status: 'active',
      packaging: [{ name: '彩盒包装', innerSize: '10×5×3', innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8, packCount: 24 }],
    },
  });
  if (!created.ok()) throw new Error(`创建产品失败：HTTP ${created.status()} ${await created.text()}`);
  return (await created.json()).data as { id: string; sku: string };
}

test('图册模块：建图册 → 未登录打开链接可见 → 加品刷新即见 → 停用立即失效', async ({ page, browser }) => {
  const stamp = Date.now();
  const productA = await seedProduct(page, `E2E图册甲${stamp}`, stamp);
  const productB = await seedProduct(page, `E2E图册乙${stamp}`, stamp);
  let catalogId: number | null = null;

  try {
    // 从侧边栏进新模块
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品图册', exact: true }).click();
    await expect(page.locator('.catalog-page')).toBeVisible();

    // 新建并选品甲
    await page.getByRole('button', { name: '新建图册' }).click();
    await page.locator('.catalog-page input[placeholder*="主推图册"]').fill(`E2E主推图册${stamp}`);
    await page.locator('.catalog-page .search-control input').fill(`E2E图册甲${stamp}`);
    await page.locator('.catalog-page label', { hasText: `E2E图册甲${stamp}` }).locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: '保存（1 个产品）' }).click();

    const card = page.locator('.catalog-page article', { hasText: `E2E主推图册${stamp}` });
    await expect(card).toBeVisible();
    await expect(card).toContainText('1 个产品');
    await expect(card).toContainText('在用');
    const publicUrl = (await card.locator('code').textContent())?.trim() ?? '';
    expect(publicUrl).toContain('/c/');
    const catalogs = (await (await page.request.get('/api/catalogs')).json()).data.items as Array<{ id: number; name: string }>;
    catalogId = catalogs.find((item) => item.name === `E2E主推图册${stamp}`)?.id ?? null;

    // 未登录的新浏览器直接打开链接：客户视角
    const anonymous = await browser.newContext();
    const guest = await anonymous.newPage();
    await guest.goto(publicUrl);
    // 新品分区与分类分区都会出现产品名：取第一处可见即可。
    await expect(guest.getByText(`E2E图册甲${stamp}`).first()).toBeVisible();
    await expect(guest.getByText(`E2E图册乙${stamp}`)).toHaveCount(0);

    // 选品编辑：把乙加进去；同一链接刷新即见（不用换链接、不用重发）
    await card.getByRole('button', { name: '选品编辑' }).click();
    await page.locator('.catalog-page .search-control input').fill(`E2E图册乙${stamp}`);
    await page.locator('.catalog-page label', { hasText: `E2E图册乙${stamp}` }).locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: '保存（2 个产品）' }).click();
    await expect(card).toContainText('2 个产品');
    await guest.reload();
    await expect(guest.getByText(`E2E图册乙${stamp}`).first()).toBeVisible();

    // 停用：链接立即失效；再启用恢复
    await card.getByRole('button', { name: '停用' }).click();
    await expect(card).toContainText('已停用');
    await guest.reload();
    await expect(guest.getByText('这个图册链接不可用')).toBeVisible();
    await card.getByRole('button', { name: '启用' }).click();
    await expect(card).toContainText('在用');

    await anonymous.close();
  } finally {
    if (catalogId) await page.request.delete(`/api/catalogs/${catalogId}`);
    await page.request.delete(`/api/products/${productA.id}`);
    await page.request.delete(`/api/products/${productB.id}`);
  }
});

test('产品库里的「产品图册」菜单跳到新模块', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  const menuButton = page.locator('.products-page .toolbar-menu-button');
  await menuButton.click();
  await page.locator('.anchored-popover .toolbar-menu-item', { hasText: '产品图册' }).click();
  await expect(page.locator('.catalog-page')).toBeVisible();
});
