import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;
const stamp = Date.now();
const SUPPLIER = `E2E图册供应商${stamp}`;
const CATALOG_NAME = `E2E供应商图册${stamp}`;
const PDF_NAME = `供应商总册-${stamp}.pdf`;
const PNG_NAME = `细节图-${stamp}.png`;

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

/** 模拟从剪贴板粘贴文件：文件名带扩展名但 MIME 为空，覆盖真实的粘贴路径。 */
async function pasteIntoSupplierDrop(page: Page, entries: Array<{ name: string; type: string }>) {
  await page.evaluate((files) => {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    const transfer = new DataTransfer();
    for (const entry of files) {
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
      transfer.items.add(new File([bytes], entry.name, { type: entry.type }));
    }
    // 故意从当前焦点（通常是刚填完的备注输入框）发起粘贴：弹窗内任意位置都应能接住文件。
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, entries);
}

async function openSupplierTab(page: Page) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品图册', exact: true }).click();
  await page.getByRole('tab', { name: /供应商图册/ }).click();
  await expect(page.locator('.supplier-catalog-panel')).toBeVisible();
}

test('供应商图册：粘贴 PDF、点选图片、搜索、删文件与删整条', async ({ page }) => {
  test.setTimeout(120_000);
  const createdProduct = await page.request.post('/api/products', {
    data: {
      name: `E2E供应商图册产品${stamp}`,
      supplier: SUPPLIER,
      status: 'active',
      packaging: [{ name: '彩盒包装', packCount: 10 }],
    },
  });
  expect(createdProduct.ok()).toBe(true);
  const product = (await createdProduct.json()).data as { id: number };

  try {
    await openSupplierTab(page);
    await page.getByRole('button', { name: '上传供应商图册' }).click();
    const modal = page.getByRole('dialog', { name: '上传供应商图册' });
    await expect(modal).toBeVisible();

    await modal.getByLabel('供应商名称').fill(SUPPLIER);
    await modal.getByLabel('图册名称').fill(CATALOG_NAME);
    await modal.getByLabel('收到日期').fill('2026-10-20');
    await modal.getByLabel('备注（可选）').fill('总册 + 细节图');

    // 粘贴无 MIME 的 PDF：按扩展名归一化后进入待上传列表。
    await pasteIntoSupplierDrop(page, [{ name: PDF_NAME, type: '' }]);
    const pending = modal.locator('.supplier-catalog-file-row.is-pending');
    await expect(pending).toHaveCount(1);
    await expect(pending).toContainText(PDF_NAME);
    await expect(pending).toContainText('待上传');

    await modal.getByRole('button', { name: '保存（1 个文件）' }).click();
    await expect(modal).toBeHidden();

    const card = page.locator('.supplier-catalog-card', { hasText: CATALOG_NAME });
    await expect(card).toBeVisible();
    await expect(card).toContainText(SUPPLIER);
    await expect(card).toContainText('2026-10-20');
    await expect(card).not.toContainText('收到 2026-10-20');
    await expect(card).toContainText(PDF_NAME);

    // 服务端保存的是按扩展名回写的 PDF MIME，而不是空类型。
    const list = (await (await page.request.get('/api/supplier-catalogs')).json()) as { data: { items: Array<{ id: number; name: string; files: Array<{ originalName: string; mimeType: string }> }> } };
    const saved = list.data.items.find((item) => item.name === CATALOG_NAME);
    expect(saved?.files.find((file) => file.originalName === PDF_NAME)?.mimeType).toBe('application/pdf');
    const catalogId = saved!.id;

    // 编继续点选一张图片：追加到同一条记录。
    await card.getByRole('button', { name: '编辑' }).click();
    const editModal = page.getByRole('dialog', { name: '编辑供应商图册' });
    await expect(editModal).toBeVisible();
    await editModal.locator('input[type="file"]').setInputFiles({ name: PNG_NAME, mimeType: 'image/png', buffer: PNG_1X1 });
    await expect(editModal.locator('.supplier-catalog-file-row.is-pending')).toContainText(PNG_NAME);
    await editModal.getByRole('button', { name: '保存（2 个文件）' }).click();
    await expect(editModal).toBeHidden();
    await expect(card).toContainText(PNG_NAME);
    await expect(card.locator('.supplier-catalog-card-files .supplier-catalog-file-row')).toHaveCount(2);

    // 搜索供应商 / 文件名都能命中。
    const search = page.locator('.supplier-catalog-panel .search-control input');
    await search.fill(PNG_NAME);
    await expect(page.locator('.supplier-catalog-card', { hasText: CATALOG_NAME })).toBeVisible();
    await search.fill(`不存在-${stamp}`);
    await expect(page.locator('.supplier-catalog-card')).toHaveCount(0);
    await expect(page.locator('.supplier-catalog-panel')).toContainText('没有符合条件');
    await search.fill(CATALOG_NAME);

    // 删除单个文件：二次确认后记录里只剩另一张。
    page.once('dialog', (dialog) => void dialog.accept());
    await card.getByRole('button', { name: `删除 ${PDF_NAME}` }).click();
    await expect(card).not.toContainText(PDF_NAME);
    await expect(card).toContainText(PNG_NAME);
    await expect(card.locator('.supplier-catalog-card-files .supplier-catalog-file-row')).toHaveCount(1);

    // 删除整条记录。
    page.once('dialog', (dialog) => void dialog.accept());
    await card.getByRole('button', { name: '删除', exact: true }).click();
    await expect(page.locator('.supplier-catalog-card', { hasText: CATALOG_NAME })).toHaveCount(0);
    const afterDelete = (await (await page.request.get('/api/supplier-catalogs')).json()).data.items as Array<{ id: number }>;
    expect(afterDelete.some((item) => item.id === catalogId)).toBe(false);
  } finally {
    // 失败时兜底清理：按名称找到记录再删，最后删产品。
    const items = (await (await page.request.get('/api/supplier-catalogs')).json()).data.items as Array<{ id: number; name: string }>;
    for (const item of items) {
      if (item.name === CATALOG_NAME) await page.request.delete(`/api/supplier-catalogs/${item.id}`);
    }
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('供应商图册：超长图册名与文件名不把打开/下载按钮挤出卡片和弹窗', async ({ page }) => {
  const longName = `2026年春季电动工具全系列供应商报价图册-冲击扳手-角磨机-电锤-电钻-含税含运-第${stamp}版`;
  const longFile = `2026春季电动工具全系列报价-冲击扳手-角磨机-电锤-电钻-配件齐全-含税含运-批量优惠-${stamp}.pdf`;
  const created = await page.request.post('/api/supplier-catalogs', {
    data: { supplier: `超长供应商名称${stamp}有限公司`, name: longName, receivedAt: '2026-10-20', remark: '' },
  });
  expect(created.ok()).toBe(true);
  const catalog = (await created.json()).data as { id: number };
  expect((await page.request.post(`/api/supplier-catalogs/${catalog.id}/files`, {
    multipart: { file: { name: longFile, mimeType: 'application/pdf', buffer: PNG_1X1 } },
  })).ok()).toBe(true);

  /** 每行的打开/下载/删除按钮右缘都不能越过容器右缘，长文件名要按省略号截断。 */
  const expectIconsInside = async (container: ReturnType<Page['locator']>) => {
    const result = await container.evaluate((el) => {
      const containerRight = el.getBoundingClientRect().right;
      const rows = Array.from(el.querySelectorAll('.supplier-catalog-file-row'));
      return {
        containerRight: Math.round(containerRight),
        rows: rows.map((row) => {
          const name = row.querySelector('.supplier-catalog-file-name') as HTMLElement;
          return {
            nameClipped: name.scrollWidth > name.clientWidth + 1,
            iconRights: Array.from(row.querySelectorAll('.icon-button')).map((icon) => Math.round(icon.getBoundingClientRect().right)),
          };
        }),
      };
    });
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0]!.nameClipped).toBe(true);
    for (const row of result.rows) {
      for (const right of row.iconRights) expect(right).toBeLessThanOrEqual(result.containerRight);
    }
  };

  try {
    await openSupplierTab(page);
    const card = page.locator('.supplier-catalog-card', { hasText: `${stamp}` }).first();
    await expect(card).toBeVisible();

    // 桌面端卡片只有 320px 下限时列宽也会被长文件名撑开，先验最窄的桌面卡片。
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectIconsInside(card);

    await page.setViewportSize({ width: 375, height: 812 });
    await expectIconsInside(card);

    await card.getByRole('button', { name: '编辑' }).click();
    const modal = page.getByRole('dialog', { name: '编辑供应商图册' });
    await expect(modal).toBeVisible();
    await expectIconsInside(modal);
  } finally {
    const items = (await (await page.request.get('/api/supplier-catalogs')).json()).data.items as Array<{ id: number; name: string }>;
    for (const item of items) {
      if (item.name === longName) await page.request.delete(`/api/supplier-catalogs/${item.id}`);
    }
  }
});
