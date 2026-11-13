import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

test('在线图册：免登录加购、填数量、刷新保留并导出 PDF', async ({ page, browser }) => {
  const stamp = Date.now();
  const productName = `E2E购物车产品${stamp}`;
  const createdProduct = await page.request.post('/api/products', {
    data: {
      name: productName,
      status: 'active',
      parameters: '额定功率：800W\n电压：12V',
      purchaseQuotes: [{ supplier: 'E2E购物车供应商', variant: '', price: 100, isDefault: true }],
      packaging: [{ name: '彩盒包装', packCount: 10, innerWeight: 0.5, outerSize: '60×50×40', purchasePrice: 3.2 }],
    },
  });
  expect(createdProduct.ok()).toBe(true);
  const product = (await createdProduct.json()).data as { id: number };
  const uploaded = await page.request.post(`/api/products/${product.id}/images?category=product`, {
    multipart: { file: { name: 'catalog-cart.png', mimeType: 'image/png', buffer: PNG_1X1 } },
  });
  expect(uploaded.ok()).toBe(true);
  const createdCatalog = await page.request.post('/api/catalogs', {
    data: { name: `E2E购物车图册${stamp}`, productIds: [product.id], markupPercent: 20 },
  });
  expect(createdCatalog.ok()).toBe(true);
  const catalog = (await createdCatalog.json()).data as { id: number; token: string };
  let guestContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const guest = await guestContext.newPage();
    await guest.goto(`/c/${catalog.token}`);
    const card = guest.locator('.card', { hasText: productName }).first();
    await expect(card).toBeVisible();
    await expect(card.locator('.card-add')).toBeVisible();

    // 加购：不入大图，购物车角标从 0 → 1。
    await card.locator('.card-add').click();
    await expect(guest.locator('#lightbox')).not.toHaveClass(/is-open/);
    await expect(guest.locator('#cart-count')).toHaveText('1');
    await expect(guest.locator('#cart-open')).toHaveAttribute('aria-label', '打开购物车，已选 1 件');

    await guest.locator('#cart-open').click();
    const panel = guest.locator('#cart-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.cart-item')).toContainText(productName);
    await expect(panel.locator('.cart-item')).toContainText('¥124 起');
    await expect(panel.locator('#cart-total')).toHaveText('¥124.00');

    // 购物车内输入数量：+ 一次到 2，再手动改成 3。
    await panel.getByRole('button', { name: '增加数量' }).click();
    await expect(panel.locator('.cart-qty input')).toHaveValue('2');
    await expect(panel.locator('#cart-total')).toHaveText('¥248.00');
    await panel.locator('.cart-qty input').fill('3');
    await panel.locator('.cart-qty input').press('Tab');
    await expect(panel.locator('.cart-qty input')).toHaveValue('3');
    await expect(panel.locator('#cart-total')).toHaveText('¥372.00');
    await panel.locator('.cart-item-note').fill('请按木架包装，交期 30 天');

    // 刷新后购物车和产品行备注仍在（本机存储，不需要登录）。
    await guest.reload();
    await expect(guest.locator('#cart-count')).toHaveText('3');
    await guest.locator('#cart-open').click();
    await expect(guest.locator('#cart-panel .cart-qty input')).toHaveValue('3');
    await expect(guest.locator('#cart-panel .cart-item-note')).toHaveValue('请按木架包装，交期 30 天');
    await expect(guest.locator('#cart-total')).toHaveText('¥372.00');

    const overflow = await guest.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // 导出 PDF：GET 下载，文件名带图册名与「选品报价」，备注随请求带上，内容以 %PDF- 开头。
    const requestPromise = guest.waitForRequest((request) => request.url().includes('/quote.pdf'));
    const downloadPromise = guest.waitForEvent('download', { timeout: 60_000 });
    await guest.locator('#cart-export').click();
    const quoteRequest = new URL((await requestPromise).url());
    const itemParts = (quoteRequest.searchParams.get('items') ?? '').split(',')[0].split(':');
    expect(itemParts[0]).toBe(String(product.id));
    expect(itemParts[1]).toBe('3');
    expect(Buffer.from(itemParts[2] ?? '', 'base64url').toString('utf8')).toBe('请按木架包装，交期 30 天');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('选品报价');
    const path = await download.path();
    expect(path).toBeTruthy();
    const bytes = await readFile(path!);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
  } finally {
    await guestContext?.close();
    await page.request.delete(`/api/catalogs/${catalog.id}`);
    await page.request.delete(`/api/products/${product.id}`);
  }
});
