import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;
const stamp = Date.now();
const NAME = `E2E多档报价${stamp}`;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

async function openNewEditor(page: Page) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .button-primary').click();
  const editor = page.getByRole('dialog');
  await expect(editor).toBeVisible();
  return editor;
}

const quotesSection = (page: Page) => page.getByRole('dialog').locator('.purchase-quotes-section');
const quotesTable = (page: Page) => quotesSection(page).locator('.purchase-quotes-table');
const addQuote = (page: Page) => quotesSection(page).locator('button[title="添加一条采购报价"]');

test('编辑器：采购报价在品名下面，多档可增可改且默认档决定列表价格', async ({ page }) => {
  const editor = await openNewEditor(page);
  await editor.getByRole('textbox', { name: '品名' }).fill(NAME);

  // 区块顺序：首行 → 采购报价 → 参数/配件/备注 → 包装方式。
  const tops = await editor.evaluate((node) => {
    const top = (selector: string) => (node.querySelector(selector) as HTMLElement).getBoundingClientRect().top;
    return {
      identity: top('.product-editor-identity'),
      quotes: top('.purchase-quotes-section'),
      texts: top('.product-editor-text-fields'),
      packaging: top('.packaging-modes-section'),
    };
  });
  expect(tops.quotes).toBeGreaterThan(tops.identity);
  expect(tops.texts).toBeGreaterThan(tops.quotes);
  expect(tops.packaging).toBeGreaterThan(tops.texts);
  // 包装表不再折叠：打开编辑器就能直接填。
  await expect(editor.locator('.packaging-modes-section .packaging-table-shell')).toBeVisible();

  // 打开编辑器就自带一行空报价，而且它天然是默认档（供应商输入框高亮）：不用再先点「添加报价」。
  await expect(quotesTable(page).locator('tbody tr')).toHaveCount(1);
  const supplierInputs = editor.locator('input[aria-label="报价供应商"]');
  await expect(supplierInputs.first()).toHaveClass(/is-default-quote/);
  await supplierInputs.first().fill('德艺堡');
  await editor.locator('input[aria-label="报价名目"]').first().fill('有刷款');
  await editor.locator('input[aria-label="报价采购价"]').first().fill('120');

  // 加第二档；点它的供应商输入框 = 设为默认，高亮切换过去。
  await addQuote(page).click();
  await supplierInputs.nth(1).fill('良景');
  await editor.locator('input[aria-label="报价名目"]').nth(1).fill('无刷款');
  await editor.locator('input[aria-label="报价采购价"]').nth(1).fill('140');
  await supplierInputs.nth(1).click();
  await expect(supplierInputs.nth(1)).toHaveClass(/is-default-quote/);
  await expect(supplierInputs.first()).not.toHaveClass(/is-default-quote/);

  // 桌面宽度下半宽列里三列必须一屏放下：报价表卡片不能出现横向滚动；
  // 「名目 / 款式」拿到剩余宽度（比供应商列宽），末列（删除）右缘不超出卡片。
  const quotesGeometry = await quotesSection(page).locator('.packaging-table-shell').evaluate((shell) => {
    const cells = Array.from((shell.querySelector('tbody tr') as HTMLElement).children).map((cell) => cell.getBoundingClientRect());
    return {
      overflow: shell.scrollWidth - shell.clientWidth,
      columnCount: cells.length,
      supplierWidth: cells[0].width,
      nameWidth: cells[1].width,
      lastRight: cells[cells.length - 1].right,
      shellRight: shell.getBoundingClientRect().right,
    };
  });
  expect(quotesGeometry.overflow).toBeLessThanOrEqual(0);
  expect(quotesGeometry.columnCount).toBe(4);
  expect(quotesGeometry.nameWidth).toBeGreaterThan(quotesGeometry.supplierWidth);
  expect(quotesGeometry.lastRight).toBeLessThanOrEqual(quotesGeometry.shellRight + 1);

  // 配件价格与左侧采购报价同款风格：两边都没有灰底方块（底色一致）。
  const sectionBackgrounds = await editor.evaluate((node) => {
    const row = node.querySelector('.product-editor-quote-row') as HTMLElement;
    return Array.from(row.children).map((child) => getComputedStyle(child as HTMLElement).backgroundColor);
  });
  expect(sectionBackgrounds).toHaveLength(2);
  expect(sectionBackgrounds[0]).toBe(sectionBackgrounds[1]);

  // 报价表下面的提示小字已移除：区块里不再有说明段落。
  await expect(quotesSection(page).locator('p')).toHaveCount(0);

  await editor.getByRole('button', { name: '保存产品' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 列表价格取默认档，并带 +1 角标提示还有另一档。
  await page.locator('.products-page .page-toolbar .search-control input').fill(NAME);
  const card = page.locator('.products-gallery .product-gallery-card').first();
  await expect(card.locator('.product-gallery-price')).toContainText('¥140');
  await expect(card.locator('.price-tier-count')).toHaveText('+1');

  // 重开编辑器：两档都在，默认档排在第一行（高亮在供应商输入框上）。
  await card.locator('button[title="编辑产品"]').click();
  await expect(quotesTable(page).locator('tbody tr')).toHaveCount(2);
  const reopenedSuppliers = editor.locator('input[aria-label="报价供应商"]');
  await expect(reopenedSuppliers.first()).toHaveValue('良景');
  await expect(reopenedSuppliers.first()).toHaveClass(/is-default-quote/);
  await expect(reopenedSuppliers.nth(1)).not.toHaveClass(/is-default-quote/);

  // 列表接口回读：默认档已经写进镜像列（客户产品成本价与列表价格都取它）。
  const listed = JSON.parse(await (await page.request.get(`/api/products?q=${encodeURIComponent(NAME)}`)).text()) as {
    data?: { items?: Array<{ id: number; supplier: string; purchasePrice: number }> };
  };
  const product = listed.data?.items?.[0];
  expect(product).toMatchObject({ supplier: '良景' });
  expect(product?.purchasePrice).toBe(140);
  await page.request.delete(`/api/products/${product?.id}`);
});

test('详情弹窗：按供应商分组展示各档，受小眼睛控制', async ({ page }) => {
  const created = await page.request.post('/api/products', {
    data: {
      name: NAME,
      category: `E2E报价类${stamp}`,
      purchaseQuotes: [
        { id: 'a', supplier: '德艺堡', variant: '有刷款', price: '120', isDefault: false },
        { id: 'b', supplier: '德艺堡', variant: '无刷款', price: '140', isDefault: true },
        { id: 'c', supplier: '良景', variant: '含配件', price: '135', isDefault: false },
      ],
      status: 'active',
      packaging: [{ name: '彩盒包装', packCount: 10 }],
    },
  });
  const product = (await created.json()).data as { id: number; sku: string };
  try {
    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
    await page.locator('.products-page .page-toolbar .search-control input').fill(product.sku);
    await page.locator('.products-gallery .product-gallery-open').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const quotes = dialog.locator('.product-detail-quote-group');
    await expect(quotes).toHaveCount(2);
    await expect(quotes.first()).toContainText('德艺堡');
    await expect(quotes.first()).toContainText('有刷款');
    await expect(quotes.first()).toContainText('¥120');
    await expect(quotes.first()).toContainText('¥140');
    await expect(dialog.locator('.product-detail-quote.is-default')).toContainText('无刷款');
    await expect(quotes.nth(1)).toContainText('良景');
    // 详情里不再单列「供应商 / 价格」两格：默认档只随采购报价出现一次（镜像列由列表价格与接口回读覆盖）。
    await expect(dialog.locator('.product-detail-label', { hasText: '供应商' })).toHaveCount(0);
    await expect(dialog.locator('.product-detail-label', { hasText: '价格' })).toHaveCount(0);
    // 「配件」行标签只有两个字，不再带类目括号说明。
    await expect(dialog.locator('.product-detail-label', { hasText: '配件' })).toHaveText('配件');
    await expect(dialog.getByText('同类目共用')).toHaveCount(0);

    // 小眼睛关闭：采购报价整行连同价格一起消失。
    await dialog.locator('.modal-close').click();
    await page.locator('.products-page .products-sensitive-toggle').click();
    await page.locator('.products-gallery .product-gallery-open').click();
    await expect(page.getByRole('dialog').locator('.product-detail-quotes')).toHaveCount(0);
    await expect(page.getByRole('dialog')).not.toContainText('采购报价');
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('只带采购价不带报价数组的写入会自动补一条默认档', async ({ page }) => {
  const created = await page.request.post('/api/products', {
    data: { name: `${NAME}单档`, supplier: '老供应商', purchasePrice: 88, status: 'active', packaging: [{ name: '彩盒包装', packCount: 10 }] },
  });
  const product = (await created.json()).data as { id: number; sku: string; purchaseQuotes: Array<Record<string, unknown>> };
  try {
    // 没带报价数组的写入（Excel 导入走的就是这条路）：服务端按镜像列自动补一条默认档。
    expect(product.purchaseQuotes).toHaveLength(1);
    expect(product.purchaseQuotes[0]).toMatchObject({ supplier: '老供应商', price: '88', isDefault: true });

    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
    await page.locator('.products-page .page-toolbar .search-control input').fill(`${NAME}单档`);
    // 单档产品不加 +N 装饰，显示与改造前一致。
    await expect(page.locator('.products-gallery .price-tier-count')).toHaveCount(0);
    await expect(page.locator('.products-gallery .product-gallery-price')).toHaveText('¥88');
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test.describe('手机端', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('两档报价压成一行：供应商高亮与删除都在屏幕内，报价表不需要横向滑动', async ({ page }) => {
    const created = await page.request.post('/api/products', {
      data: {
        name: `${NAME}窄屏`,
        status: 'active',
        packaging: [{ name: '彩盒包装', packCount: 10 }],
        purchaseQuotes: [
          { supplier: '德艺堡', variant: '有刷款', price: '120', isDefault: true },
          { supplier: '良景', variant: '无刷款', price: '140', isDefault: false },
        ],
      },
    });
    const product = (await created.json()).data as { id: number; sku: string };
    try {
      await page.goto('/');
      await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
      await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
      await page.locator('.products-page .page-toolbar .search-control input').fill(product.sku);
      await page.locator('.products-page button[title="编辑产品"]:visible').first().click();
      const editor = page.getByRole('dialog');
      await expect(editor).toBeVisible();

      const shell = editor.locator('.purchase-quotes-section .packaging-table-shell');
      const geometry = await shell.evaluate((node) => {
        const rows = Array.from(node.querySelectorAll('tbody tr'));
        const cells = rows.flatMap((row) => Array.from(row.children).map((cell) => cell.getBoundingClientRect()));
        const inside = rows.flatMap((row) => Array.from(row.querySelectorAll('button')).map((b) => b.getBoundingClientRect().right));
        return {
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          overflow: node.scrollWidth - node.clientWidth,
          maxRight: Math.max(...inside),
          viewport: window.innerWidth,
          // 一行放不下就会换行：行高会顶到两倍，同一行的输入框也不会再对齐。
          distinctTops: new Set(rows.map((row) => Math.round(row.getBoundingClientRect().top))).size,
          wrappedRows: rows.filter((row) => {
            const tops = new Set(Array.from(row.querySelectorAll('input')).map((input) => Math.round(input.getBoundingClientRect().top)));
            return tops.size > 1;
          }).length,
          tallestRow: Math.max(...rows.map((row) => Math.round(row.getBoundingClientRect().height))),
          inputFont: getComputedStyle(node.querySelector('input') as HTMLElement).fontSize,
          // 上下两行的同列必须落在同一个 x 上，否则就是用户说的「错位」。
          columnX: [0, 1, 2, 3].map((index) => new Set(rows.map((row) => Math.round(row.children[index].getBoundingClientRect().x))).size),
          cells: cells.length,
        };
      });
      expect(geometry.overflow).toBeLessThanOrEqual(0);
      expect(geometry.maxRight).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.cells).toBe(8);
      expect(geometry.distinctTops).toBe(2);
      expect(geometry.wrappedRows).toBe(0);
      expect(geometry.tallestRow).toBeLessThanOrEqual(56);
      expect(geometry.columnX).toEqual([1, 1, 1, 1]);
      // 窄屏报价表输入框走 13px（配套 viewport 的 maximum-scale=1 才不会触发 iOS 聚焦放大）。
      expect(geometry.inputFont).toBe('13px');
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });
});
