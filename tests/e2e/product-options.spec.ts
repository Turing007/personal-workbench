import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

const SEED_COLORS = ['E2E蓝', 'E2E红'];
const SEED_PLUGS = ['E2E牧田', 'E2E德伟'];

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
  // 颜色 / 插脚是服务端共用的主数据，显式写死一份，断言不依赖运行顺序。
  const response = await request.put('/api/settings/product-option-presets', { data: { colors: SEED_COLORS, plugs: SEED_PLUGS } });
  if (!response.ok()) throw new Error(`预置颜色与插脚失败：HTTP ${response.status()}`);
});

test.afterAll(async ({ request }) => {
  await ensureAuthenticated(request);
  await request.put('/api/settings/product-option-presets', { data: { colors: ['蓝', '红', '黄'], plugs: ['MT', 'DE', 'MI'] } });
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

async function openEditor(page: Page, mobile = false) {
  await page.goto('/');
  // 手机端侧栏默认收起，要从「更多」抽屉进入。
  if (mobile) await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .button-primary').click();
  const editor = page.getByRole('dialog');
  await expect(editor).toBeVisible();
  return editor;
}

async function openSettingsOptions(page: Page) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('.settings-menu-item', { hasText: '颜色与插脚' }).click();
  const section = page.locator('.settings-section');
  await expect(section).toContainText('颜色与插脚');
  return section;
}

test('编辑器：颜色与插脚只剩预设胶囊，三个字段并排一行', async ({ page }) => {
  const editor = await openEditor(page);

  // 不再有自定义输入框。
  await expect(editor.locator('input[aria-label="自定义颜色"], input[aria-label="自定义插脚"], .chip-custom, .chip-input, .chip-add')).toHaveCount(0);

  const row = editor.locator('.product-editor-options-row');
  await expect(row).toHaveCount(1);
  await expect(row.locator('.product-editor-option-field')).toHaveCount(3);
  const colorChips = row.locator('.product-editor-option-field').nth(0).locator('.chip');
  await expect(colorChips).toHaveText(SEED_COLORS);
  await expect(row.locator('.product-editor-option-field').nth(1).locator('.chip')).toHaveText(SEED_PLUGS);
  await expect(row.locator('.product-editor-option-field').nth(2).locator('.chip')).toHaveText(['12V', '16.8V', '21V']);

  const positions = await row.locator('.product-editor-option-field').evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { top: Math.round(rect.top), left: Math.round(rect.left), right: Math.round(rect.right) };
  }));
  // 同一行、左右并列，右侧不越出这一行。
  expect(new Set(positions.map((item) => item.top)).size).toBe(1);
  expect(positions[1].left).toBeGreaterThan(positions[0].left);
  expect(positions[2].left).toBeGreaterThan(positions[1].left);
  const rowRight = await row.evaluate((node) => Math.round(node.getBoundingClientRect().right));
  expect(positions[2].right).toBeLessThanOrEqual(rowRight + 1);

  // 点一下即选中，再点取消；选中的值能随产品保存。
  await colorChips.nth(0).click();
  await expect(colorChips.nth(0)).toHaveClass(/is-selected/);
  const name = `E2E颜色插脚${Date.now()}`;
  await editor.getByRole('textbox', { name: '品名' }).fill(name);
  await editor.locator('button.button-primary').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const created = await page.request.get(`/api/products?q=${encodeURIComponent(name)}`);
  const items = (await created.json()).data?.items ?? [];
  for (const product of items as Array<{ id: string }>) await page.request.delete(`/api/products/${product.id}`);
});

test('设置页：维护颜色与插脚后，编辑器立即用上新清单', async ({ page }) => {
  const section = await openSettingsOptions(page);
  await expect(section.locator('.product-options-group')).toHaveCount(2);

  const addColor = section.locator('input[aria-label="新增颜色"]');
  await addColor.fill('E2E新色');
  await addColor.press('Enter');
  await expect(section.locator('.product-options-chip', { hasText: 'E2E新色' })).toHaveCount(1);
  await expect(section.locator('.packaging-preset-dirty')).toBeVisible();
  await section.locator('.product-options-footer button.button-primary').click();
  await expect(section.locator('.notice-success')).toContainText('已保存');

  try {
    const editor = await openEditor(page);
    const colorChips = editor.locator('.product-editor-option-field').nth(0).locator('.chip');
    await expect(colorChips).toHaveText([...SEED_COLORS, 'E2E新色']);
  } finally {
    // 删掉临时色并保存，避免污染后面重跑。
    await openSettingsOptions(page);
    await page.locator('.product-options-chip', { hasText: 'E2E新色' }).locator('button').click();
    await page.locator('.product-options-footer button.button-primary').click();
    await expect(page.locator('.notice-success')).toContainText('已保存');
  }
});

test.describe('手机端', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('颜色与插脚仍同一行，页面不横向滚动', async ({ page }) => {
    const editor = await openEditor(page, true);
    const row = editor.locator('.product-editor-options-row');
    const positions = await row.locator('.product-editor-option-field').evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { top: Math.round(rect.top), right: Math.round(rect.right) };
    }));
    // 颜色与插脚仍并排；电压在下一行独占。
    expect(positions[0].top).toBe(positions[1].top);
    expect(positions[2].top).toBeGreaterThan(positions[1].top);

    const metrics = await page.evaluate(() => {
      const scroller = document.querySelector('.app-content') as HTMLElement;
      const rowNode = document.querySelector('.product-editor-options-row') as HTMLElement;
      return {
        scrollerOverflow: scroller.scrollWidth - scroller.clientWidth,
        rowOverflow: rowNode.scrollWidth - rowNode.clientWidth,
        rowRight: Math.round(rowNode.getBoundingClientRect().right),
        viewport: window.innerWidth,
      };
    });
    expect(metrics.scrollerOverflow).toBeLessThanOrEqual(0);
    expect(metrics.rowOverflow).toBeLessThanOrEqual(0);
    expect(metrics.rowRight).toBeLessThanOrEqual(metrics.viewport);
  });
});
