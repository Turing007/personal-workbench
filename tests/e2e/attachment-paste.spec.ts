import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

const PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3];

async function openProductEditor(page: Page) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .button-primary').click();
  await expect(page.getByRole('dialog').locator('.product-editor')).toBeVisible();
}

/**
 * 模拟从系统剪贴板粘贴文件。
 * 不能用 page.setInputFiles：那条路测不到「粘贴进来的文件没有 MIME」这个真实情形，
 * 而它正是需要归一化 MIME 的原因。
 */
async function pasteIntoAttachments(page: Page, files: Array<{ name: string; type: string }>) {
  await page.evaluate((entries) => {
    const section = document.querySelector('.product-editor .product-editor-attachments');
    if (!section) throw new Error('找不到产品附件区块');
    const transfer = new DataTransfer();
    for (const entry of entries) {
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
      transfer.items.add(new File([bytes], entry.name, { type: entry.type }));
    }
    section.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, files);
}

/** 模拟从桌面拖文件进附件区（dragenter → dragover → drop）。 */
async function dropIntoAttachments(page: Page, files: Array<{ name: string; type: string }>) {
  await page.evaluate((entries) => {
    const section = document.querySelector('.product-editor .product-editor-attachments');
    if (!section) throw new Error('找不到产品附件区块');
    const transfer = new DataTransfer();
    for (const entry of entries) {
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
      transfer.items.add(new File([bytes], entry.name, { type: entry.type }));
    }
    const dragEvent = (type: string) => new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true });
    section.dispatchEvent(dragEvent('dragenter'));
    section.dispatchEvent(dragEvent('dragover'));
    return section.className;
  }, files);
  // 拖入期间应高亮，drop 之后熄灭。
  await expect(page.locator('.product-editor .product-editor-attachments')).toHaveClass(/is-drop-target/);
  await page.evaluate((entries) => {
    const section = document.querySelector('.product-editor .product-editor-attachments');
    if (!section) throw new Error('找不到产品附件区块');
    const transfer = new DataTransfer();
    for (const entry of entries) {
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
      transfer.items.add(new File([bytes], entry.name, { type: entry.type }));
    }
    const dragEvent = (type: string) => new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true });
    // 拖过子元素会多来一次 dragenter，模拟真实路径，确保计数配对正确。
    section.dispatchEvent(dragEvent('dragenter'));
    section.dispatchEvent(dragEvent('dragleave'));
    section.dispatchEvent(dragEvent('drop'));
  }, files);
}

test.describe('产品附件支持粘贴上传', () => {
  test('粘贴无 MIME 的 PDF 能进列表，保存后正常入库', async ({ page }) => {
    const stamp = Date.now();
    await openProductEditor(page);
    await page.getByRole('dialog').getByRole('textbox', { name: '品名' }).fill(`E2E粘贴附件${stamp}`);

    // 剪贴板里的文件常常没有类型，正是需要按扩展名回写的场景。
    await pasteIntoAttachments(page, [{ name: `包装说明-${stamp}.pdf`, type: '' }]);

    const rows = page.locator('.product-editor .attachment-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`包装说明-${stamp}.pdf`);
    await expect(rows.first()).toContainText('待上传');
    await expect(page.locator('.product-editor .image-upload-message')).toHaveCount(0);

    await page.getByRole('dialog').locator('button.button-primary').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 附件走后台上传队列，编辑器先关、文件随后到。
    const findProduct = async () => {
      const response = await page.request.get(`/api/products?q=${encodeURIComponent(`E2E粘贴附件${stamp}`)}`);
      const body = await response.json() as { data: { items: Array<{ id: number; attachments: Array<{ originalName: string; mimeType: string }> }> } };
      return body.data.items[0];
    };
    await expect.poll(async () => {
      const product = await findProduct();
      return product?.attachments.map((item) => item.originalName).join(',') ?? '';
    }, { timeout: 20_000, message: '粘贴的附件应上传成功' }).toBe(`包装说明-${stamp}.pdf`);

    // 服务端存的 MIME 应是我们按扩展名回写的，而不是空的 application/octet-stream。
    const saved = await findProduct();
    expect(saved?.attachments[0]?.mimeType).toBe('application/pdf');

    // 清理：删掉刚建的产品，避免污染 e2e 数据目录。
    const cleanup = await page.request.delete(`/api/products/${saved!.id}`);
    expect(cleanup.ok()).toBeTruthy();
  });

  test('不支持的扩展名被挡下并给出提示，纯文本粘贴不受影响', async ({ page }) => {
    const stamp = Date.now();
    await openProductEditor(page);
    await page.getByRole('dialog').getByRole('textbox', { name: '品名' }).fill(`E2E粘贴附件拒绝${stamp}`);

    await pasteIntoAttachments(page, [{ name: `实拍-${stamp}.heic`, type: 'image/heic' }]);
    await expect(page.locator('.product-editor .attachment-row')).toHaveCount(0);
    await expect(page.locator('.product-editor .image-upload-message')).toContainText('已忽略 1 个不支持的文件');
  });

  test('从桌面拖文件进来同样能添加，拖入时高亮、放下后熄灭', async ({ page }) => {
    const stamp = Date.now();
    await openProductEditor(page);
    await page.getByRole('dialog').getByRole('textbox', { name: '品名' }).fill(`E2E拖拽附件${stamp}`);

    await dropIntoAttachments(page, [{ name: `拖入的图纸-${stamp}.zip`, type: '' }]);

    const rows = page.locator('.product-editor .attachment-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`拖入的图纸-${stamp}.zip`);
    await expect(page.locator('.product-editor .product-editor-attachments')).not.toHaveClass(/is-drop-target/);

    await page.getByRole('dialog').locator('button.button-primary').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const findProduct = async () => {
      const response = await page.request.get(`/api/products?q=${encodeURIComponent(`E2E拖拽附件${stamp}`)}`);
      const body = await response.json() as { data: { items: Array<{ id: number; attachments: Array<{ originalName: string; mimeType: string }> }> } };
      return body.data.items[0];
    };
    await expect.poll(async () => {
      const product = await findProduct();
      return product?.attachments.map((item) => item.originalName).join(',') ?? '';
    }, { timeout: 20_000, message: '拖入的附件应上传成功' }).toBe(`拖入的图纸-${stamp}.zip`);

    // 拖进来的文件同样按扩展名回写了 MIME。
    const saved = await findProduct();
    expect(saved?.attachments[0]?.mimeType).toBe('application/zip');

    const cleanup = await page.request.delete(`/api/products/${saved!.id}`);
    expect(cleanup.ok()).toBeTruthy();
  });
});
