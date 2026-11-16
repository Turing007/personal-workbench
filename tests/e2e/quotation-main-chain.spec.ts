import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { ensureAuthenticated, injectSession } from './helpers/auth';

// 报价单主链路正确性护栏（重构方案第 1 步修复后转为正式用例）。

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

function quotationPayload(overrides: Record<string, unknown> = {}) {
  return {
    quotationDate: new Date().toISOString().slice(0, 10),
    customerName: '主链路客户',
    contactName: '',
    contactPhone: '',
    customerAddress: '',
    validUntil: '',
    remark: '',
    taxRateBps: 0,
    pricingBasis: 'shipping_ex_tax',
    companySnapshot: { name: '测试公司', logoRelativePath: null, phone: '', address: '', defaultIssuer: '', wechatQrRelativePath: null },
    displayConfig: { showLogo: false, showCompanyPhone: false, showCompanyAddress: false, showContactPhone: false, showTax: true, showTaxIncludedTotal: true, columns: { image: true, name: true, specification: true, unitPrice: true, tierPrice: true, remark: true } },
    items: [{ isTemporary: true, name: '临时产品', sku: '', specification: '', parameters: '', unitPriceCents: 100, remark: '', sortOrder: 0 }],
    customFields: [],
    ...overrides,
  };
}

async function openQuotationPage(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '报价单', exact: true }).click();
}

const searchInput = '.quotation-toolbar .search-control input';

test('F1 列表搜索：按产品名命中报价单', async ({ page }) => {
  const stamp = Date.now();
  const productName = `E2E搜索靶${stamp}`;
  const created = await page.request.post('/api/quotations', {
    data: quotationPayload({ items: [{ isTemporary: true, name: productName, sku: '', specification: '', parameters: '', unitPriceCents: 100, remark: '', sortOrder: 0 }] }),
  });
  expect(created.ok()).toBeTruthy();
  const quote = (await created.json()).data as { id: number; number: string };
  try {
    await openQuotationPage(page);
    await page.locator(searchInput).fill(productName);
    await expect(page.locator('.quotation-table-desktop tbody tr', { hasText: quote.number })).toBeVisible();
  } finally {
    await page.request.delete(`/api/quotations/${quote.id}`);
  }
});

test('F3/F4 列表展示：金额列与真实产品数', async ({ page }) => {
  const created = await page.request.post('/api/quotations', {
    data: quotationPayload({
      items: [
        { isTemporary: true, name: '金额产品一', sku: '', specification: '', parameters: '', unitPriceCents: 12345, remark: '', sortOrder: 0 },
        { isTemporary: true, name: '金额产品二', sku: '', specification: '', parameters: '', unitPriceCents: 6789, remark: '', sortOrder: 1 },
      ],
    }),
  });
  expect(created.ok()).toBeTruthy();
  const quote = (await created.json()).data as { id: number; number: string };
  try {
    await openQuotationPage(page);
    await page.locator(searchInput).fill(quote.number);
    const row = page.locator('.quotation-table-desktop tbody tr', { hasText: quote.number });
    await expect(row).toBeVisible();
    // 列序约定：0 单号 / 1 日期 / 2 客户 / 3 产品数 / 4 金额 / 5 状态 / 6 更新时间 / 7 操作
    await expect(row.locator('td').nth(3)).toHaveText('2');
    await expect(row.locator('td').nth(4)).toContainText('191.34');
  } finally {
    await page.request.delete(`/api/quotations/${quote.id}`);
  }
});

test('F2 列表分页：超过一页可翻页', async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const prefix = `E2E翻页${stamp}`;
  const ids: number[] = [];
  try {
    for (let index = 0; index < 51; index += 1) {
      const response = await page.request.post('/api/quotations', {
        data: quotationPayload({ customerName: `${prefix}-${index}` }),
      });
      expect(response.ok()).toBeTruthy();
      ids.push(((await response.json()).data as { id: number }).id);
    }
    await openQuotationPage(page);
    await page.locator(searchInput).fill(prefix);
    await expect(page.locator('.toolbar-count')).toHaveText('51 份');
    await expect(page.locator('.quotation-table-desktop tbody tr')).toHaveCount(50);
    await page.getByRole('button', { name: '下一页' }).click();
    await expect(page.locator('.quotation-table-desktop tbody tr')).toHaveCount(1);
  } finally {
    for (const id of ids) await page.request.delete(`/api/quotations/${id}`);
  }
});

test('F5/F6 编辑器：无状态下拉、可直达导出 PDF', async ({ page }) => {
  test.setTimeout(60_000);
  const created = await page.request.post('/api/quotations', { data: quotationPayload() });
  expect(created.ok()).toBeTruthy();
  const quote = (await created.json()).data as { id: number; number: string };
  try {
    await openQuotationPage(page);
    await page.locator(searchInput).fill(quote.number);
    await page.locator('.quotation-table-desktop tbody tr', { hasText: quote.number }).getByTitle('编辑报价单').click();
    const dialog = page.getByRole('dialog', { name: /编辑报价 · BJ/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('报价状态')).toHaveCount(0);
    const pdfButton = dialog.getByRole('button', { name: '导出 PDF' });
    await expect(pdfButton).toBeVisible();
    // 真实导出：验证 PDF 链路（含缩略派生图 wiring）端到端可用
    const downloadPromise = page.waitForEvent('download');
    await pdfButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`${quote.number}.pdf`);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const bytes = await readFile(downloadPath!);
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
  } finally {
    await page.request.delete(`/api/quotations/${quote.id}`);
  }
});