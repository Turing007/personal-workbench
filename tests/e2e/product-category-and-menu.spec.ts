import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;
const stamp = Date.now();
// 造两条带分类的产品当候选：同时存在「扳手」和「棘轮扳手」，才能验证取的是最长匹配。
let anchorProduct: { id: string; sku: string };
let secondAnchor: { id: string; sku: string };

async function createAnchor(request: Page['request'], name: string, category: string) {
  const created = await request.post('/api/products', {
    data: {
      name,
      category,
      supplier: '德艺堡',
      purchasePrice: 137.5,
      colors: ['红', '黄', '蓝'],
      batteryPlugs: ['牧田', '米沃奇', '德伟'],
      status: 'active',
      packaging: [{ name: '彩盒包装', innerSize: '45*9*9', innerWeight: 0.8, outerSize: '47*48*36', outerWeight: 18, packCount: 20 }],
    },
  });
  if (!created.ok()) throw new Error(`创建锚点产品失败：HTTP ${created.status()}`);
  return (await created.json()).data as { id: string; sku: string };
}

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
  anchorProduct = await createAnchor(request, `E2E分类锚点${stamp}`, '扳手');
  secondAnchor = await createAnchor(request, `E2E分类锚点二${stamp}`, '棘轮扳手');
});

test.afterAll(async ({ request }) => {
  // afterAll 里的 request 是新的未登录实例，要先重新拿会话再清理。
  await ensureAuthenticated(request);
  for (const product of [anchorProduct, secondAnchor]) await request.delete(`/api/products/${product.id}`);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

async function openEditor(page: Page) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .button-primary').click();
  const editor = page.getByRole('dialog');
  await expect(editor).toBeVisible();
  return editor;
}

const nameInput = (page: Page) => page.getByRole('dialog').getByRole('textbox', { name: '品名' });
const categoryInput = (page: Page) => page.getByRole('dialog').locator('input[aria-label="产品分类"]');

test('编辑器：分类紧跟品名，按品名给建议且只在点一下时才写入', async ({ page }) => {
  const editor = await openEditor(page);

  // 首行顺序：品名 → 产品分类 → 颜色 → 电池插脚（采购价与供应商已并入采购报价表格）。
  const labels = await editor.locator('.product-editor-identity > *').evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? '').trim().slice(0, 2)));
  expect(labels).toEqual(['品名', '产品', '颜色', '电池']);
  expect(editor.locator('.product-editor-identity label', { hasText: '采购价' })).toHaveCount(0);
  expect(editor.locator('.product-editor-identity label', { hasText: '供应商' })).toHaveCount(0);
  // 首行四格确实排在同一行（比输入框的 y 更稳：格子里的标签结构不同会让输入框差几像素）。
  const cellTops = await editor.locator('.product-editor-identity > *').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
  expect(new Set(cellTops).size).toBe(1);

  // 颜色 / 电池插脚固定两行：预设 chip 占第一行，「自定义」连着加号整体落到第二行。
  const chipRows = await editor.locator('.product-editor-identity .product-editor-chips').evaluateAll((nodes) => nodes.map((chips) => {
    const chipTops = new Set(Array.from(chips.querySelectorAll('.chip')).map((chip) => Math.round(chip.getBoundingClientRect().top)));
    const custom = chips.querySelector('.chip-custom')!.getBoundingClientRect();
    const input = chips.querySelector('.chip-input')!.getBoundingClientRect();
    const add = chips.querySelector('.chip-add')!.getBoundingClientRect();
    return {
      chipLines: chipTops.size,
      customBelowChips: custom.top > Math.max(...chipTops),
      addBesideInput: add.right <= custom.right + 1 && Math.abs(add.top - input.top) <= 1,
    };
  }));
  expect(chipRows).toHaveLength(2);
  expect(chipRows.every((row) => row.chipLines === 1 && row.customBelowChips && row.addBesideInput)).toBe(true);

  // 还没填品名时不给建议。
  await expect(editor.locator('.product-category-suggest')).toHaveCount(0);

  await nameInput(page).fill('无刷冲击扳手 500N');
  const suggestion = editor.locator('.product-category-suggest');
  await expect(suggestion).toHaveText('建议 扳手');
  // 建议不自动写入，分类框仍是空的。
  await expect(categoryInput(page)).toHaveValue('');

  await suggestion.click();
  await expect(categoryInput(page)).toHaveValue('扳手');
  // 填上之后建议按钮收起。
  await expect(suggestion).toHaveCount(0);

  // 手动改成别的分类后，改品名也不会被自动覆盖。
  await categoryInput(page).fill('逆变器');
  await nameInput(page).fill('棘轮扳手 加长 13.5cm');
  await expect(categoryInput(page)).toHaveValue('逆变器');
  await expect(suggestion).toHaveText('建议 棘轮扳手');
});

test('编辑器：分类可自由新填并保存生效', async ({ page }) => {
  const editor = await openEditor(page);
  const fresh = `E2E新分类${stamp}`;
  await nameInput(page).fill(`E2E分类落库${stamp}`);
  await categoryInput(page).fill(fresh);
  await editor.locator('input[aria-label="内盒尺寸"]').fill('45*9*9');
  await editor.locator('input[aria-label="外箱尺寸"]').fill('47*48*36');
  await editor.locator('button.button-primary').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.locator('.products-page select[aria-label="产品分类筛选"]').selectOption({ label: fresh });
  await page.locator('.products-page .page-toolbar .search-control input').fill(`E2E分类落库${stamp}`);
  await expect(page.locator('.products-gallery .product-gallery-card')).toHaveCount(1);
});

test('产品详情：品名、颜色、插脚都单行显示不换行', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(anchorProduct.sku);
  // 从大图卡片点开详情
  await page.locator('.products-gallery .product-gallery-open').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const values = await dialog.evaluate((node) => {
    const items = Array.from(node.querySelectorAll('.product-detail-grid .product-detail-item:not(.product-detail-item-wide)')) as HTMLElement[];
    return items.map((item) => {
      const value = item.querySelector('.product-detail-value') as HTMLElement;
      return {
        label: item.querySelector('.product-detail-label')?.textContent ?? '',
        height: Math.round(value.getBoundingClientRect().height),
        clipped: value.scrollWidth > value.clientWidth + 1,
      };
    });
  });
  const labels = values.map((value) => value.label);
  expect(labels).toEqual(expect.arrayContaining(['品名', '颜色', '插脚']));
  // 单行 12px 字体 + 1.45 行高约 17px；一旦折行就是 35px 上下。
  for (const value of values) {
    expect(value.height, `${value.label} 折成了多行`).toBeLessThanOrEqual(24);
  }
  // 这条产品的品名较长，用来确认 2 列宽度下不需要截断。
  const nameCell = values.find((value) => value.label === '品名');
  expect(nameCell?.clipped).toBe(false);

  // 短字段一行两个：品名与 SKU 不在同一列起点。
  const columns = await dialog.evaluate((node) => {
    const items = Array.from(node.querySelectorAll('.product-detail-grid .product-detail-item:not(.product-detail-item-wide)')) as HTMLElement[];
    const tops = new Set(items.map((item) => Math.round(item.getBoundingClientRect().top)));
    return { rows: tops.size, perRow: Math.round(items.length / tops.size) };
  });
  expect(columns.perRow).toBe(2);
});

test('工具条：导出/下载模板/导入收进「导入导出」二级菜单', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();

  const menuButton = page.locator('.products-page .toolbar-menu-button');
  await expect(menuButton).toHaveText(/导入导出/);
  // 三个入口不再平铺在工具条上。
  await expect(page.locator('.products-page .page-toolbar button[title="导出产品库"]')).toHaveCount(0);
  await expect(page.locator('.products-page .page-toolbar button[title="导入 Excel 产品库"]')).toHaveCount(0);

  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await menuButton.click();
  const menu = page.locator('.anchored-popover');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.toolbar-menu-item')).toHaveCount(4);
  await expect(menu.locator('.toolbar-menu-item', { hasText: '下载导入模板' })).toHaveCount(1);
  await expect(menu.locator('.toolbar-menu-item', { hasText: '导出产品图册' })).toHaveCount(1);
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');

  // 点菜单外区域收起
  await page.locator('.products-page .page-toolbar .search-control input').click();
  await expect(menu).toHaveCount(0);

  // 导出走下载，且菜单随之关闭
  await menuButton.click();
  const download = page.waitForEvent('download');
  await page.locator('.toolbar-menu-item', { hasText: '导出产品库' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toContain('.xlsx');
  await expect(page.locator('.anchored-popover')).toHaveCount(0);
});

test('编辑器：点遮罩和按 Esc 都不关闭，填过的内容不丢', async ({ page }) => {
  const editor = await openEditor(page);
  const name = `E2E遮罩不关${stamp}`;
  await nameInput(page).fill(name);
  await categoryInput(page).fill('扳手');

  // 误点弹窗外的空白处：弹窗必须留着，已经填的内容一个都不能没。
  await page.locator('.modal-overlay').click({ position: { x: 6, y: 6 } });
  await expect(editor).toBeVisible();
  await expect(nameInput(page)).toHaveValue(name);

  // Esc 同样不关：一次误按不该毁掉半张表单。
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await expect(nameInput(page)).toHaveValue(name);
  await expect(categoryInput(page)).toHaveValue('扳手');

  // 明确的关闭入口照常生效。
  await editor.locator('.modal-close').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('只读弹窗同样只认关闭按钮', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(anchorProduct.sku);
  await page.locator('.products-gallery .product-gallery-open').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await page.locator('.modal-overlay').click({ position: { x: 6, y: 6 } });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  await dialog.locator('.modal-close').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
