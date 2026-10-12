import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;
const stamp = Date.now();
const CATEGORY = `E2E配件类${stamp}`;
const DEFAULT_A = '9 件套筒';
const DEFAULT_B = '钻头 8mm';

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

async function seedProduct(page: Page, name: string) {
  const created = await page.request.post('/api/products', {
    data: { name, category: CATEGORY, status: 'active', packaging: [{ name: '彩盒包装', packCount: 10 }] },
  });
  expect(created.ok()).toBe(true);
  return (await created.json()).data as { id: number; sku: string };
}

async function searchAndOpenDetail(page: Page, name: string) {
  await page.locator('.products-page .search-control input').fill(name);
  await page.waitForTimeout(400);
  await page.locator('.products-gallery .product-gallery-open').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function searchAndOpenEditor(page: Page, name: string) {
  await page.locator('.products-page .search-control input').fill(name);
  await page.waitForTimeout(400);
  await page.locator('.products-gallery .product-gallery-card', { hasText: name }).locator('button[title="编辑产品"]').click();
  const editor = page.getByRole('dialog');
  await expect(editor).toBeVisible();
  return editor;
}

test('配件价格按产品独立：首次自动带出类目默认，增删改保存后只影响本产品（含删空）', async ({ page }) => {
  await page.request.put('/api/settings/category-accessory-prices', {
    data: { category: CATEGORY, items: [{ name: DEFAULT_A, price: 6 }, { name: DEFAULT_B, price: 3 }] },
  });
  const productA = await seedProduct(page, `E2E配件甲${stamp}`);
  const productB = await seedProduct(page, `E2E配件乙${stamp}`);

  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();

    // 没改过配件的产品：详情沿用类目默认。
    const detailA = await searchAndOpenDetail(page, `E2E配件甲${stamp}`);
    await expect(detailA.locator('.product-detail-accessory-lines')).toContainText(DEFAULT_A);
    await expect(detailA.locator('.product-detail-accessory-lines')).toContainText(DEFAULT_B);
    await detailA.locator('.modal-close').click();

    // 打开编辑器：自动带出类目默认（名称 + 价格）。
    const editor = await searchAndOpenEditor(page, `E2E配件甲${stamp}`);
    const section = editor.locator('.accessory-prices-section');
    await expect(section.locator('tbody tr')).toHaveCount(2);
    await expect(section.getByLabel('产品配件1名称')).toHaveValue(DEFAULT_A);
    await expect(section.getByLabel('产品配件1价格')).toHaveValue('6');

    // 删掉「钻头 8mm」、加一条「锯片 8 元」，保存产品。
    await section.getByLabel('移除第 2 条产品配件').click();
    await section.getByRole('button', { name: '添加' }).click();
    await section.getByLabel('产品配件2名称').fill('锯片');
    await section.getByLabel('产品配件2价格').fill('8');
    await editor.getByRole('button', { name: '保存产品' }).click();
    await expect(editor).toBeHidden();

    // 详情：只显示本产品清单，被删的类目项不再出现。
    const detailAfterEdit = await searchAndOpenDetail(page, `E2E配件甲${stamp}`);
    await expect(detailAfterEdit.locator('.product-detail-accessory-lines')).toContainText(DEFAULT_A);
    await expect(detailAfterEdit.locator('.product-detail-accessory-lines')).toContainText('锯片');
    await expect(detailAfterEdit.locator('.product-detail-accessory-lines')).not.toContainText(DEFAULT_B);
    await detailAfterEdit.locator('.modal-close').click();

    // 同类目的另一个产品不受影响，仍显示完整类目默认。
    const detailB = await searchAndOpenDetail(page, `E2E配件乙${stamp}`);
    await expect(detailB.locator('.product-detail-accessory-lines')).toContainText(DEFAULT_A);
    await expect(detailB.locator('.product-detail-accessory-lines')).toContainText(DEFAULT_B);
    await detailB.locator('.modal-close').click();

    // 再打开甲：显示的是它自己固化后的清单（已无钻头），把它删光并保存。
    const editorAgain = await searchAndOpenEditor(page, `E2E配件甲${stamp}`);
    const sectionAgain = editorAgain.locator('.accessory-prices-section');
    await expect(sectionAgain.getByLabel('产品配件1名称')).toHaveValue(DEFAULT_A);
    await expect(sectionAgain.locator('tbody tr')).toHaveCount(2);
    await sectionAgain.getByLabel('移除第 1 条产品配件').click();
    await sectionAgain.getByLabel('移除第 1 条产品配件').click();
    await editorAgain.getByRole('button', { name: '保存产品' }).click();
    await expect(editorAgain).toBeHidden();

    // 全部删光后：配件行显示 —，不再回落到类目默认。
    const detailCleared = await searchAndOpenDetail(page, `E2E配件甲${stamp}`);
    await expect(detailCleared.locator('.product-detail-accessory-lines')).toHaveCount(0);
    await expect(detailCleared.locator('.product-detail-label', { hasText: '配件' }).locator('..')).toContainText('—');
    await detailCleared.locator('.modal-close').click();
  } finally {
    await page.request.put('/api/settings/category-accessory-prices', { data: { category: CATEGORY, items: [] } });
    await page.request.delete(`/api/products/${productA.id}`);
    await page.request.delete(`/api/products/${productB.id}`);
  }
});

test('类目默认弹层：改默认只同步给没动过的草稿，已保存过配件的产品不受影响', async ({ page }) => {
  await page.request.put('/api/settings/category-accessory-prices', {
    data: { category: CATEGORY, items: [{ name: DEFAULT_A, price: 6 }] },
  });
  const product = await seedProduct(page, `E2E默认弹层${stamp}`);

  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
    const editor = await searchAndOpenEditor(page, `E2E默认弹层${stamp}`);
    const section = editor.locator('.accessory-prices-section');
    await expect(section.locator('tbody tr')).toHaveCount(1);
    await expect(section.getByLabel('产品配件1名称')).toHaveValue(DEFAULT_A);

    // 打开「类目默认 ›」：加一条默认配件并保存 → 草稿里自动同步出这一行。
    await section.getByRole('button', { name: '类目默认 ›' }).click();
    const defaultsDialog = page.getByRole('dialog', { name: /类目默认配件/ });
    await expect(defaultsDialog).toBeVisible();
    await defaultsDialog.getByRole('button', { name: '添加' }).click();
    await defaultsDialog.getByLabel('类目默认配件2名称').fill('链条');
    await defaultsDialog.getByLabel('类目默认配件2价格').fill('5');
    await defaultsDialog.getByRole('button', { name: '保存类目默认' }).click();
    await expect(defaultsDialog).toContainText('已保存');
    // X 按钮的 aria-label 也是「关闭」，取页脚那个（DOM 里靠后）。
    await defaultsDialog.getByRole('button', { name: '关闭' }).last().click();

    await expect(section.locator('tbody tr')).toHaveCount(2);
    await expect(section.getByLabel('产品配件2名称')).toHaveValue('链条');

    // 不保存产品，直接关掉：这次没动过清单，产品仍未固化。
    await editor.getByRole('button', { name: '取消' }).click();
    await expect(editor).toBeHidden();
  } finally {
    await page.request.put('/api/settings/category-accessory-prices', { data: { category: CATEGORY, items: [] } });
    await page.request.delete(`/api/products/${product.id}`);
  }
});
