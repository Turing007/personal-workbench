import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test('系统产品选品器完整展示多张图片且不横向裁切', async ({ page }) => {
  const stamp = Date.now();
  const productName = `多图选品产品${stamp}`;
  const created = await page.request.post('/api/products', {
    data: {
      name: productName,
      sku: `MULTI-IMAGE-${stamp}`,
      specification: '12V',
      status: 'active',
      packaging: [{ name: '彩盒', packCount: 10, innerWeight: 0, outerSize: '', outerWeight: 0 }],
    },
  });
  expect(created.ok()).toBe(true);
  const productId = (await created.json()).data.id as string;

  try {
    for (let index = 1; index <= 30; index += 1) {
      const uploaded = await page.request.post(`/api/products/${productId}/images?category=product`, {
        multipart: { file: { name: `multi-${stamp}-${index}.png`, mimeType: 'image/png', buffer: PNG_1X1 } },
      });
      expect(uploaded.ok()).toBe(true);
    }

    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await page.getByRole('button', { name: '新建订单' }).click();
    const orderDialog = page.getByRole('dialog', { name: '新建订单' });
    await orderDialog.getByRole('button', { name: '填写订单详情' }).click();
    const detailDialog = page.getByRole('dialog', { name: '填写订单详情' });
    await detailDialog.getByRole('button', { name: '从系统产品库添加' }).click();
    await detailDialog.getByPlaceholder('筛选品名').fill(productName);

    const imageList = detailDialog.locator('.library-product-image-list').first();
    await expect(imageList).toBeVisible();
    await expect(imageList.getByRole('button')).toHaveCount(30);
    const overflow = await imageList.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    const lastImage = imageList.getByRole('button').last();
    await lastImage.scrollIntoViewIfNeeded();
    await expect(lastImage).toBeVisible();
    await lastImage.click();
    await detailDialog.locator('button[title="选择产品"]').first().click();
    await expect(detailDialog.locator('input[aria-label="订单产品品名"]').first()).toHaveValue(productName);
  } finally {
    await page.request.delete(`/api/products/${productId}`);
  }
});
