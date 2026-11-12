import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';
import { useProductListView } from './helpers/products-view';
import { dateInputValue } from '../../src/shared/date-input';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
  await useProductListView(context);
});

test.describe('手机端列表页密度：去掉多余容器留白', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('产品库：卡片列表贴到页面内边距，面板不再多套一层边框和内边距', async ({ page }) => {
    const created = await page.request.post('/api/products', {
      data: {
        name: `E2E密度${Date.now()}`,
        status: 'active',
        packaging: [{ name: '彩盒包装', innerSize: '10×5×3', innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8, packCount: 24 }],
      },
    });
    expect(created.ok()).toBeTruthy();
    const product = (await created.json()).data as { id: string; sku: string };
    try {
      await page.goto('/');
      await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
      await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
      await page.locator('.products-page .page-toolbar .search-control input').fill(product.sku);

      const card = page.locator('.products-card-list .product-card:visible').first();
      await expect(card).toBeVisible();

      const metrics = await page.evaluate(() => {
        const shell = document.querySelector('.products-page') as HTMLElement;
        const panel = document.querySelector('.products-page > .table-panel') as HTMLElement;
        const list = document.querySelector('.products-card-list') as HTMLElement;
        const first = list.querySelector('.product-card') as HTMLElement;
        const shellStyle = getComputedStyle(shell);
        const panelStyle = getComputedStyle(panel);
        const listStyle = getComputedStyle(list);
        const firstStyle = getComputedStyle(first);
        const rect = first.getBoundingClientRect();
        return {
          shellPaddingLeft: parseFloat(shellStyle.paddingLeft),
          panelBorderWidth: parseFloat(panelStyle.borderLeftWidth),
          panelBackground: panelStyle.backgroundColor,
          listPaddingLeft: parseFloat(listStyle.paddingLeft),
          cardPaddingLeft: parseFloat(firstStyle.paddingLeft),
          cardLeft: Math.round(rect.left),
          cardRight: Math.round(rect.right),
          viewport: window.innerWidth,
          overflow: (document.querySelector('.app-content') as HTMLElement).scrollWidth
            - (document.querySelector('.app-content') as HTMLElement).clientWidth,
        };
      });

      // 面板这一层在手机端不再画边框、不再给列表加内边距：只剩「页面留白 + 卡片」。
      expect(metrics.panelBorderWidth).toBe(0);
      expect(metrics.panelBackground).toBe('rgba(0, 0, 0, 0)');
      expect(metrics.listPaddingLeft).toBe(0);
      // 卡片左缘 = 页面内边距 + 卡片自身 1px 边框，不再叠加面板和列表两层留白。
      expect(metrics.cardLeft).toBeLessThanOrEqual(Math.round(metrics.shellPaddingLeft) + 2);
      expect(metrics.cardPaddingLeft).toBeLessThanOrEqual(10);
      // 右缘同样贴边，且不产生横向滚动。
      expect(metrics.viewport - metrics.cardRight).toBeLessThanOrEqual(Math.round(metrics.shellPaddingLeft) + 2);
      expect(metrics.overflow).toBeLessThanOrEqual(0);
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });

  test('订单：卡片列表同样贴边，工具条与卡片左缘对齐', async ({ page }) => {
    const orderNo = `E2E-DENSITY-${Date.now()}`;
    const order = await page.request.post('/api/orders', {
      data: {
        orderNo,
        orderedAt: dateInputValue(),
        recipientName: '密度测试',
        recipientInfo: '密度测试 13800000000 测试地址',
        items: [{ name: 'E2E密度产品', quantity: 1, packCount: 1, unitPriceCents: 100 }],
      },
    });
    expect(order.ok()).toBeTruthy();
    const orderId = (await order.json()).data.id as string;
    try {
      await page.goto('/');
      await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
      await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();

      const card = page.locator('.orders-card-list .order-card:visible', { hasText: orderNo }).first();
      await expect(card).toBeVisible();

      const metrics = await page.evaluate(() => {
        const shell = document.querySelector('.orders-page') as HTMLElement;
        const panel = document.querySelector('.orders-page .table-panel') as HTMLElement;
        const toolbar = document.querySelector('.orders-page .orders-table-toolbar') as HTMLElement;
        const list = document.querySelector('.orders-card-list') as HTMLElement;
        const first = list.querySelector('.order-card') as HTMLElement;
        const shellPadding = parseFloat(getComputedStyle(shell).paddingLeft);
        const cardRect = first.getBoundingClientRect();
        const toolbarRect = toolbar.getBoundingClientRect();
        return {
          panelBorder: parseFloat(getComputedStyle(panel).borderLeftWidth),
          listPadding: parseFloat(getComputedStyle(list).paddingLeft),
          shellPadding,
          cardLeft: Math.round(cardRect.left),
          cardRight: Math.round(cardRect.right),
          toolbarLeft: Math.round(toolbarRect.left),
          overflow: (document.querySelector('.app-content') as HTMLElement).scrollWidth
            - (document.querySelector('.app-content') as HTMLElement).clientWidth,
        };
      });

      expect(metrics.panelBorder).toBe(0);
      expect(metrics.listPadding).toBe(0);
      expect(metrics.cardLeft).toBeLessThanOrEqual(Math.round(metrics.shellPadding) + 2);
      // 工具条和卡片同一左缘，不再出现「工具条缩在面板内、卡片再缩一层」。
      expect(Math.abs(metrics.toolbarLeft - metrics.cardLeft)).toBeLessThanOrEqual(1);
      expect(metrics.overflow).toBeLessThanOrEqual(0);
    } finally {
      await page.request.delete(`/api/orders/${orderId}`);
    }
  });
});
