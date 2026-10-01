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

const PDF_HEAD = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3];

/**
 * 把文件塞进「选择附件」输入框。
 *
 * 必须用 DataTransfer + 手动派发 change：page.setInputFiles 会带上 Playwright 推断的 MIME，
 * 测不到手机端真实回来的 application/octet-stream / 空类型——那正是附件被静默丢弃的原因。
 */
async function pickAttachmentFile(page: Page, name: string, type: string, bytes: number[]) {
  await page.evaluate(({ name, type, bytes }) => {
    const input = document.querySelector('input[aria-label="选择订单附件"]') as HTMLInputElement | null;
    if (!input) throw new Error('找不到订单附件输入框');
    const file = new File([new Uint8Array(bytes)], name, { type });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { name, type, bytes });
}

/** 用接口建一单带产品的订单，回到列表点「编辑」拿到可直接保存的表单。 */
async function createOrderWithItem(page: Page, stamp: number) {
  const customerResponse = await page.request.post('/api/customers', {
    data: { name: `E2E附件客户${stamp}`, contactName: '附件联系人', contactPhone: '13900000000', shippingInfo: '杭州市西湖区' },
  });
  expect(customerResponse.ok()).toBeTruthy();
  const customer = (await customerResponse.json()).data;

  const orderResponse = await page.request.post('/api/orders', {
    data: {
      orderNo: '',
      orderedAt: new Date().toISOString(),
      customerId: customer.id,
      recipientName: '附件联系人',
      recipientInfo: '杭州市西湖区',
      amount: 100,
      items: [{ name: 'E2E附件产品', sku: `E2E-AT-${stamp}`, specification: '标准', packagingName: '纸箱', packCount: 10, quantity: 10, unitPriceCents: 1000 }],
    },
  });
  expect(orderResponse.ok()).toBeTruthy();
  const order = (await orderResponse.json()).data;
  return { customerId: Number(customer.id), orderId: Number(order.id), orderNo: String(order.order_no) };
}

async function openOrderFormInEdit(page: Page, orderNo: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '订单', exact: true }).click();
  await page.locator('tbody tr', { hasText: orderNo }).getByRole('button', { name: '编辑' }).click();
  await expect(page.getByRole('dialog', { name: `编辑订单 · ${orderNo}` })).toBeVisible();
}

test.describe('订单附件：手机端选回的文件要能存上', () => {
  test('octet-stream 的 PDF 不再被丢弃，保存后附件真的进了订单', async ({ page }) => {
    const stamp = Date.now();
    const { customerId, orderId, orderNo } = await createOrderWithItem(page, stamp);

    try {
      await openOrderFormInEdit(page, orderNo);
      const fileName = `吸尘器标签-${stamp}.pdf`;

      await pickAttachmentFile(page, fileName, 'application/octet-stream', PDF_HEAD);
      // 修之前：isAllowedContract 只看 file.type，这一行永远不出现，用户看到的现象就是「选了没反应」。
      await expect(page.getByRole('dialog').getByText(fileName, { exact: false })).toBeVisible();
      await expect(page.getByRole('dialog').getByText('待上传')).toBeVisible();

      const uploadResponse = page.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/orders/${orderId}/contracts`
          && response.request().method() === 'POST'
      ));
      await page.getByRole('dialog').getByRole('button', { name: '保存订单' }).click();

      // 201 证明上传时带的 Content-Type 已被按扩展名回写；仍是 octet-stream 的话服务端给 415。
      expect((await uploadResponse).status()).toBe(201);

      const detail = await page.request.get(`/api/orders/${orderId}/detail`);
      const contracts = (await detail.json()).data.contracts as Array<Record<string, unknown>>;
      expect(contracts).toEqual([expect.objectContaining({
        originalName: fileName,
        mimeType: 'application/pdf',
        size: PDF_HEAD.length,
      })]);
    } finally {
      await page.request.delete(`/api/orders/${orderId}`);
      await page.request.delete(`/api/customers/${customerId}`);
    }
  });

  test('App 内点「选择附件」走原生选文件桥，不经 WebView 的 file input', async ({ page }) => {
    const stamp = Date.now();
    const fileName = `扫描件-${stamp}.pdf`;
    // 模拟 1.12+ 的安卓壳：原生选完文件后以 base64 回传，类型常为空（手机端真实情况）。
    await page.addInitScript(({ name, bytes }) => {
      (window as unknown as { workbenchApp: Record<string, unknown> }).workbenchApp = {
        getNetworks: () => '[]',
        switchNetwork: () => undefined,
        openAddressEditor: () => undefined,
        setOverlayOpen: () => undefined,
        pickFiles: (_accept: string, _multiple: boolean, _max: number, requestId: string) => {
          const binary = String.fromCharCode(...bytes);
          window.setTimeout(() => {
            (window as unknown as { __workbenchPickedFiles: (id: string, files: unknown[]) => void })
              .__workbenchPickedFiles(requestId, [{ name, type: '', size: bytes.length, data: btoa(binary) }]);
          }, 0);
          return true;
        },
      };
    }, { name: fileName, bytes: PDF_HEAD });

    const { customerId, orderId, orderNo } = await createOrderWithItem(page, stamp);
    try {
      await openOrderFormInEdit(page, orderNo);
      await page.getByRole('dialog').getByText('选择附件').click();
      await expect(page.getByRole('dialog').getByText(fileName, { exact: false })).toBeVisible();

      const uploadResponse = page.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/orders/${orderId}/contracts`
          && response.request().method() === 'POST'
      ));
      await page.getByRole('dialog').getByRole('button', { name: '保存订单' }).click();
      expect((await uploadResponse).status()).toBe(201);
    } finally {
      await page.request.delete(`/api/orders/${orderId}`);
      await page.request.delete(`/api/customers/${customerId}`);
    }
  });

  test('确实不支持的格式给出看得见的提示，而不是静默丢弃', async ({ page }) => {
    const stamp = Date.now();
    const { customerId, orderId, orderNo } = await createOrderWithItem(page, stamp);

    try {
      await openOrderFormInEdit(page, orderNo);
      await pickAttachmentFile(page, `IMG_${stamp}.heic`, 'image/heic', PDF_HEAD);

      const alert = page.getByRole('dialog').getByRole('alert');
      await expect(alert).toBeVisible();
      await expect(alert).toHaveText('合同仅支持 PDF、Word、Excel 或 PNG/JPEG/WebP 图片');
      await expect(page.getByRole('dialog').getByText('待上传')).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/orders/${orderId}`);
      await page.request.delete(`/api/customers/${customerId}`);
    }
  });
});
