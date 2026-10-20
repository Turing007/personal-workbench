import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';
import { useProductListView } from './helpers/products-view';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
  await useProductListView(context);
});

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** 造 20 张图：够把缩略图区撑得比弹窗还长，验证列表本身能滚。 */
async function seedProductWithImages(page: Page, stamp: number) {
  const created = await page.request.post('/api/products', {
    data: {
      name: `E2E大图弹窗${stamp}`,
      supplier: 'E2E供应商',
      status: 'active',
      packaging: [{ name: '彩盒包装', innerSize: '10×5×3', innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8, packCount: 24 }],
    },
  });
  if (!created.ok()) throw new Error(`创建产品失败：HTTP ${created.status()} ${await created.text()}`);
  const product = (await created.json()).data as { id: string; sku: string };
  for (let index = 0; index < 20; index += 1) {
    const uploaded = await page.request.post(`/api/products/${product.id}/images?category=product`, {
      multipart: { file: { name: `viewer-${stamp}-${index}.png`, mimeType: 'image/png', buffer: PNG_1X1 } },
    });
    if (!uploaded.ok()) throw new Error(`上传图片失败：HTTP ${uploaded.status()} ${await uploaded.text()}`);
  }
  return product;
}

async function openImagesModal(page: Page, sku: string, mobile = false) {
  await page.goto('/');
  if (mobile) await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(sku);
  await page.locator('.product-image-button:visible').first().click();
  await expect(page.locator('.product-images-content')).toBeVisible();
  return page.locator('.product-images-content');
}

/** 用 CDP 发真实触摸事件：滑动手势只有走触摸路径才和手机一致。 */
async function dragTouch(context: BrowserContext, page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 10) {
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let step = 1; step <= steps; step += 1) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps }],
    });
    await page.waitForTimeout(12);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
}

async function swipe(context: BrowserContext, page: Page, fromX: number, toX: number, y: number) {
  await dragTouch(context, page, { x: fromX, y }, { x: toX, y }, 8);
}

test.describe('产品大图弹窗：缩略图 + 放大镜', () => {
  test('弹窗里不再常驻大图；点缩略图和放大镜都弹出大图浮层，且都不产生勾选', async ({ page }) => {
    const product = await seedProductWithImages(page, Date.now());
    try {
      await openImagesModal(page, product.sku);
      const thumbs = page.locator('.product-image-thumbnail');
      const selectButtons = page.locator('.product-image-thumbnail-select');
      await expect(thumbs).toHaveCount(20);

      // 顶部那个常驻大图已经去掉：弹窗里第一眼就是缩略图。
      await expect(page.locator('.product-images-preview')).toHaveCount(0);
      await expect(page.locator('.product-image-zoom')).toHaveCount(0);

      // 点缩略图：弹出大图浮层，计数从 1 开始，勾选仍为 0。
      await thumbs.nth(2).locator('.product-image-thumbnail-preview').click();
      const zoom = page.locator('.product-image-zoom');
      await expect(zoom).toBeVisible();
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('3 / 20');
      await expect(zoom.locator('.product-image-zoom-stage img')).toBeVisible();
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 0 / 20');
      await expect(selectButtons.nth(2)).toHaveAttribute('aria-pressed', 'false');

      // 桌面端用底部「上一张 / 下一张」切图，仍然不勾选。
      // 按钮必须真的可点：原图按自然尺寸撑出浮层时会把底部操作条盖住，Playwright 会报 intercepted。
      const imageBox = await zoom.locator('.product-image-zoom-stage img').boundingBox();
      const footerBox = await zoom.locator('.product-image-zoom-footer').boundingBox();
      expect(imageBox && footerBox && imageBox.y + imageBox.height, '大图不能压到底部操作条').toBeLessThanOrEqual((footerBox?.y ?? 0) + 1);
      await zoom.getByRole('button', { name: '下一张' }).click();
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('4 / 20');
      await zoom.getByRole('button', { name: '上一张' }).click();
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('3 / 20');
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 0 / 20');

      // 大图上的「下载这张」只下载当前这一张，和勾选无关。
      const singleDownload = page.waitForEvent('download');
      await zoom.locator('.product-image-zoom-download').click();
      const singleFile = await singleDownload;
      expect(singleFile.suggestedFilename()).toMatch(/viewer-.*-2\.png$/);
      await expect(zoom.locator('.product-image-zoom-message')).toContainText('已开始下载这张图片');
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 0 / 20');

      // Esc 关闭浮层，图库弹窗本身还在。
      await page.keyboard.press('Escape');
      await expect(zoom).toHaveCount(0);
      await expect(page.locator('.product-images-content')).toBeVisible();

      // 底栏放大镜打开同一张图；点空白处关闭。
      await thumbs.nth(0).locator('.product-image-thumbnail-zoom').click();
      await expect(zoom).toBeVisible();
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('1 / 20');
      await zoom.locator('.product-image-zoom-stage').click({ position: { x: 5, y: 5 } });
      await expect(zoom).toHaveCount(0);

      // 勾选仍只认底栏圆钮。
      await selectButtons.nth(2).click();
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 1 / 20');
      await expect(selectButtons.nth(2)).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });
});

test.describe('手机端', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('缩略图列表自身可滚，大图浮层铺满屏幕', async ({ page }) => {
    const product = await seedProductWithImages(page, Date.now());
    try {
      await page.setViewportSize({ width: 390, height: 600 });
      await openImagesModal(page, product.sku, true);
      const body = page.locator('.modal-body');

      // 没有常驻大图占位后，缩略图从弹窗顶部就开始；列表超出时由内容区滚动。
      const scrollable = await body.evaluate((node) => node.scrollHeight - node.clientHeight);
      expect(scrollable, '内容区应当可以滚动').toBeGreaterThan(0);

      await page.locator('.product-image-thumbnail-preview').first().click();
      const zoom = page.locator('.product-image-zoom');
      await expect(zoom).toBeVisible();
      const metrics = await page.evaluate(() => {
        const node = document.querySelector('.product-image-zoom') as HTMLElement;
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
      });
      // 浮层铺满视口，大图才够大；不再被弹窗正文的高度限制。
      expect(Math.abs(metrics.width - metrics.viewportWidth)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.height - metrics.viewportHeight)).toBeLessThanOrEqual(1);
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });

  test('大图浮层的「保存到相册」只存当前这一张，等原生回执后提示', async ({ page, context }) => {
    // 伪装 1.18 壳：网页抓好的字节交给原生，并按壳的行为回执。
    await context.addInitScript(() => {
      const target = window as unknown as { __saves: { base64: string; name?: string }[]; workbenchApp: unknown };
      target.__saves = [];
      target.workbenchApp = {
        getNetworks: () => '[]',
        switchNetwork: () => {},
        openAddressEditor: () => {},
        setOverlayOpen: () => {},
        saveImage: () => {},
        saveImageData: (base64: string, name?: string) => {
          target.__saves.push({ base64, name });
          window.setTimeout(() => {
            (window as unknown as { __workbenchImageSaved?: (ok: boolean) => void }).__workbenchImageSaved?.(true);
          }, 0);
        },
      };
    });
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    const product = await seedProductWithImages(page, Date.now());
    try {
      await openImagesModal(page, product.sku, true);
      await page.locator('.product-image-thumbnail-zoom').nth(1).click();
      const zoom = page.locator('.product-image-zoom');
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('2 / 20');

      await zoom.locator('.product-image-zoom-download').click();
      await expect(zoom.locator('.product-image-zoom-message')).toHaveText('已保存到手机相册');
      // 只存当前这一张，并且交给原生的是原图字节（1×1 PNG）而不是缩略图。
      const saves = await page.evaluate(() => (window as unknown as { __saves: { base64: string }[] }).__saves);
      expect(saves).toHaveLength(1);
      expect(Buffer.from(saves[0].base64, 'base64').equals(PNG_1X1)).toBe(true);
      // 单张保存不应把弹窗里的勾选带上。
      await page.locator('.product-image-zoom-close').click();
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 0 / 20');
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });

  test('大图浮层左滑切下一张、右滑切上一张，到头停住不循环', async ({ page, context }) => {
    const product = await seedProductWithImages(page, Date.now());
    try {
      await openImagesModal(page, product.sku, true);
      await page.locator('.product-image-thumbnail-preview').first().click();
      const zoom = page.locator('.product-image-zoom');
      await expect(zoom).toBeVisible();
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('1 / 20');

      const stage = zoom.locator('.product-image-zoom-stage');
      const box = await stage.boundingBox();
      if (!box) throw new Error('大图区域不可见');
      const y = box.y + box.height / 2;

      // 第一张右滑（想去上一张）：到头停住。
      await swipe(context, page, box.x + 20, box.x + box.width - 20, y);
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('1 / 20');

      // 左滑 = 下一张，再左滑 = 再下一张。
      await swipe(context, page, box.x + box.width - 20, box.x + 20, y);
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('2 / 20');
      await swipe(context, page, box.x + box.width - 20, box.x + 20, y);
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('3 / 20');

      // 右滑 = 上一张。
      await swipe(context, page, box.x + 20, box.x + box.width - 20, y);
      await expect(zoom.locator('.product-image-zoom-counter')).toHaveText('2 / 20');

      // 滑动只换图，不产生勾选；手机上显示滑动提示。
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 0 / 20');
      await expect(zoom.locator('.product-image-zoom-hint')).toBeVisible();
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });

  test('在缩略图上左右滑动可连选，上下滑不拦截滚动', async ({ page, context }) => {
    // 记录每个 touchmove 是否被 preventDefault：横滑连选时应当拦，竖滑时不能拦。
    await page.addInitScript(() => {
      const target = window as unknown as { __touchMovePrevented?: boolean[] };
      target.__touchMovePrevented = [];
      document.addEventListener('touchmove', (event) => {
        target.__touchMovePrevented?.push(event.defaultPrevented);
      }, { passive: true });
    });
    const product = await seedProductWithImages(page, Date.now());
    try {
      // 压到 600 高：20 张图必定撑出滚动，竖滑才有东西可滚。
      await page.setViewportSize({ width: 390, height: 600 });
      await openImagesModal(page, product.sku, true);
      const thumbs = page.locator('.product-image-thumbnail');
      await expect(thumbs).toHaveCount(20);
      const boxes = [];
      for (let index = 0; index < 3; index += 1) {
        const box = await thumbs.nth(index).locator('.product-image-thumbnail-preview').boundingBox();
        if (!box) throw new Error(`第 ${index + 1} 张缩略图不可见`);
        boxes.push(box);
      }
      const y = boxes[0]!.y + boxes[0]!.height / 2;
      const from = { x: boxes[0]!.x + 5, y };
      const to = { x: boxes[2]!.x + boxes[2]!.width - 5, y };

      // 横向滑过前三张：全部勾上，且不会误弹大图浮层。
      await dragTouch(context, page, from, to);
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 3 / 20');
      for (let index = 0; index < 3; index += 1) {
        await expect(page.locator('.product-image-thumbnail-select').nth(index)).toHaveAttribute('aria-pressed', 'true');
      }
      await expect(page.locator('.product-image-zoom')).toHaveCount(0);

      // 从已勾选的图起滑：同样经过的三张被取消勾选。
      await dragTouch(context, page, from, to);
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 0 / 20');

      // 从缩略图起手上下滑：不产生勾选，且不能拦截浏览器的滚动默认行为。
      const body = page.locator('.modal-body');
      expect(await body.evaluate((node) => node.scrollHeight - node.clientHeight), '列表本身应当可滚').toBeGreaterThan(0);
      await page.evaluate(() => { (window as unknown as { __touchMovePrevented?: boolean[] }).__touchMovePrevented = []; });
      const start = boxes[0]!;
      await dragTouch(
        context,
        page,
        { x: start.x + start.width / 2, y: start.y + start.height / 2 },
        { x: start.x + start.width / 2, y: start.y + start.height / 2 + 180 },
      );
      await expect(page.locator('.product-images-selection-toolbar')).toContainText('已选 0 / 20');
      const prevented = await page.evaluate(() => (window as unknown as { __touchMovePrevented?: boolean[] }).__touchMovePrevented ?? []);
      expect(prevented.length, '竖滑应当产生 touchmove').toBeGreaterThan(0);
      expect(prevented.some(Boolean), '竖滑不能被连选手势拦截，否则列表滚不动').toBe(false);
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });
});
