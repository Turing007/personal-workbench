import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

/**
 * 订单附件随客户产品带过来：
 *  - 新建订单时，每个客户产品名下的附件都要归档进订单附件；
 *  - 编辑订单时新加的产品行（该产品此前在订单里没有任何附件）同样要带上自己的附件 ——
 *    这条路径曾只复制文件、不写入订单附件列表，导致「编辑保存后附件消失」（SO20261007001 的实际问题）。
 */
let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test.describe.configure({ timeout: 90_000 });

test('订单附件：新建全部带入；编辑新加的行也会带过来', async ({ page }) => {
  const stamp = Date.now();
  const customer = (await (await page.request.post('/api/customers', {
    data: { name: `E2E订单附件客户${stamp}`, contactName: '联系人', contactPhone: '13600000000' },
  })).json()).data as { id: number };

  const makeProduct = async (name: string, fileName: string) => {
    const product = (await (await page.request.post(`/api/customers/${customer.id}/products`, {
      data: { name, specification: 'MT' },
    })).json()).data as { id: number };
    const uploaded = await page.request.post(`/api/customer-products/${product.id}/attachments?category=other`, {
      multipart: { file: { name: fileName, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 E2E') } },
    });
    expect(uploaded.ok()).toBeTruthy();
    return product;
  };

  const productA = await makeProduct(`E2E甲${stamp}`, `甲附件-${stamp}.pdf`);
  const productB = await makeProduct(`E2E乙${stamp}`, `乙附件-${stamp}.pdf`);

  // 新建订单：只含甲
  const orderResponse = await page.request.post('/api/orders', {
    data: {
      orderNo: '',
      customerId: customer.id,
      orderedAt: '2026-10-08T08:00:00.000Z',
      recipientName: '联系人',
      recipientInfo: '广州市',
      amount: 0,
      trackingNo: '',
      paymentNote: '',
      remark: '',
      items: [{ name: '', sku: '', specification: '', quantity: 4, unitPriceCents: 100, customerProductId: productA.id }],
    },
  });
  expect(orderResponse.ok()).toBeTruthy();
  const order = (await orderResponse.json()).data as { id: number; orderNo: string };
  const orderId = Number(order.id);

  try {
    const detailRaw = (await (await page.request.get(`/api/orders/${orderId}/detail`)).json()).data as Record<string, unknown>;
    const orderNo = String(detailRaw.orderNo ?? detailRaw.order_no ?? '');
    expect(orderNo, `订单详情应带订单号（实际字段：${Object.keys(detailRaw).slice(0, 15).join(',')}）`).not.toBe('');
    const contracts1 = detailRaw.contracts as Array<{ relativePath: string; originalName: string; mimeType: string; size: number }>;
    const existingA = contracts1.find((item) => item.originalName === `甲附件-${stamp}.pdf`);
    expect(existingA, '新建订单应带入甲的附件').toBeTruthy();

    // 编辑订单：把甲已有附件原样回传（真实客户端就是这么做的），并新增乙行
    const updateResponse = await page.request.put(`/api/orders/${orderId}`, {
      data: {
        orderNo,
        customerId: customer.id,
        orderedAt: '2026-10-08T08:00:00.000Z',
        recipientName: '联系人',
        recipientInfo: '广州市',
        amount: 0,
        trackingNo: '',
        paymentNote: '',
        remark: '',
        items: [
          { name: '', sku: '', specification: '', quantity: 4, unitPriceCents: 100, customerProductId: productA.id },
          { name: '', sku: '', specification: '', quantity: 2, unitPriceCents: 100, customerProductId: productB.id },
        ],
        orderAttachments: [{
          category: 'other',
          sourceCustomerProductId: productA.id,
          relativePath: existingA!.relativePath,
          originalName: existingA!.originalName,
          mimeType: existingA!.mimeType,
          size: existingA!.size,
        }],
      },
    });
    const updateBody = await updateResponse.text();
    expect(updateResponse.ok(), `PUT 更新失败（${updateResponse.status()}）：${updateBody}`).toBeTruthy();

    const detail2 = (await (await page.request.get(`/api/orders/${orderId}/detail`)).json()).data as { contracts: Array<{ originalName: string; relativePath?: string }> };
    const names2 = detail2.contracts.map((item) => item.originalName);
    expect(names2, `编辑新加的行必须带上自己的附件：${JSON.stringify(detail2.contracts)}`).toContain(`乙附件-${stamp}.pdf`);
    expect(names2, '原有附件应保留').toContain(`甲附件-${stamp}.pdf`);
    expect(names2.filter((name) => name === `甲附件-${stamp}.pdf`), `原有附件不应重复：${JSON.stringify(detail2.contracts)}`).toHaveLength(1);
  } finally {
    await page.request.delete(`/api/orders/${orderId}`);
    await page.request.delete(`/api/customer-products/${productA.id}`);
    await page.request.delete(`/api/customer-products/${productB.id}`);
    await page.request.delete(`/api/customers/${customer.id}`);
  }
});
