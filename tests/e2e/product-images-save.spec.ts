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

/** 1×1 PNG，够服务端存图与缩略图路由使用。 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * 把页面强行变成「非安全上下文」，复现手机通过 http://局域网IP:端口 访问的情形。
 *
 * 这一层伪装是本用例存在的理由：navigator.clipboard.write 只在安全上下文（https / localhost）下可用，
 * 而 Playwright 自己跑在 http://127.0.0.1，天生是安全上下文。不伪装就永远测不到手机那条分支，
 * 而「手机上点了复制没反应」恰恰就是从这里漏出去的。
 */
async function forceInsecureContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { get: () => false, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });
}

async function seedProductWithImage(page: Page, stamp: number) {
  const created = await page.request.post('/api/products', {
    // 正式产品必须带至少一行包装方式，否则服务端按 VALIDATION_ERROR 拒绝。
    data: {
      name: `E2E图片保存${stamp}`,
      supplier: 'E2E供应商',
      status: 'active',
      packaging: [{ name: '彩盒包装', innerSize: '10×5×3', innerWeight: 0.5, outerSize: '40×30×25', outerWeight: 8, packCount: 24 }],
    },
  });
  if (!created.ok()) throw new Error(`创建产品失败：HTTP ${created.status()} ${await created.text()}`);
  // 新建产品的 SKU 由服务端按 VT-#### 规则生成，必须用响应里回填的真实 SKU 定位，不能自己臆造。
  const product = (await created.json()).data as { id: string; sku: string };

  const uploaded = await page.request.post(`/api/products/${product.id}/images?category=product`, {
    multipart: { file: { name: 'e2e-product.png', mimeType: 'image/png', buffer: PNG_1X1 } },
  });
  if (!uploaded.ok()) throw new Error(`上传产品图片失败：HTTP ${uploaded.status()} ${await uploaded.text()}`);
  return product;
}

/**
 * 打开产品图片弹窗。桌面表格与手机卡片列表在 DOM 里同时存在、由 CSS 决定谁可见，
 * 所以必须用 :visible 过滤，否则会点到被 display:none 藏起来的那一份，click 直接超时。
 */
async function openImagesModal(page: Page, sku: string, mobile: boolean) {
  await page.goto('/');
  if (mobile) {
    await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
  }
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(sku);
  await page.locator('.product-image-button:visible').first().click();
  await expect(page.locator('.product-images-content')).toBeVisible();
}

/** 弹窗打开后不再默认勾选任何图片；要带图保存/复制时，先手动点一张缩略图。 */
async function selectFirstThumbnail(page: Page) {
  await page.locator('.product-image-thumbnail').first().click();
}

test.describe('手机端：触摸 + 局域网 http（非安全上下文）', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('只提供「保存到相册」，不再出现注定失败的复制按钮', async ({ page, context }) => {
    await forceInsecureContext(context);
    // 触摸标记要在弹窗挂载前生效，useTouchDevice 才能在首次渲染就读到。
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    const stamp = Date.now();
    const product = await seedProductWithImage(page, stamp);

    try {
      await openImagesModal(page, product.sku, true);
      await selectFirstThumbnail(page);

      await expect(page.locator('.product-images-save-button')).toHaveText(/保存到相册（1）/);
      // 这条是本用例的核心：局域网 http 下复制图片必然失败，所以按钮根本不该出现。
      await expect(page.locator('.product-images-copy-button')).toHaveCount(0);
      // 手机端不再走 <a download> + blob（iOS/安卓会静默忽略），那条路径的按钮也不该出现。
      await expect(page.locator('.product-images-download-button')).toHaveCount(0);
      await expect(page.locator('.product-images-help')).toContainText('长按大图可保存到相册');
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });

  test('点「保存到相册」打开全屏大图，长按走系统存储到照片', async ({ page, context }) => {
    await forceInsecureContext(context);
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    const stamp = Date.now();
    const product = await seedProductWithImage(page, stamp);

    try {
      await openImagesModal(page, product.sku, true);
      await selectFirstThumbnail(page);

      await page.locator('.product-images-save-button').click();

      const viewer = page.locator('.image-save-viewer');
      await expect(viewer).toBeVisible();
      await expect(viewer.locator('.image-save-viewer-image')).toBeVisible();
      await expect(viewer.locator('.image-save-viewer-hint')).toContainText('存储到照片');
      await expect(viewer.locator('.image-save-viewer-counter')).toHaveText('1 / 1');
      // 单张选中时没有上一张/下一张，避免出现点了没反应的死按钮。
      await expect(viewer.locator('.image-save-viewer-step')).toHaveCount(0);

      await viewer.locator('.image-save-viewer-close').click();
      await expect(viewer).toHaveCount(0);
      // 关掉大图不应把整个图库弹窗一起带走。
      await expect(page.locator('.product-images-content')).toBeVisible();
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });
  test('App 1.18+：网页抓图后交给原生写相册，不再让壳自己下载', async ({ page, context }) => {
    await forceInsecureContext(context);
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    // 伪造成 1.18 壳：记下网页交来的字节，并按壳的真实行为回执保存结果。
    await context.addInitScript(() => {
      const target = window as unknown as {
        __nativeSaves: { base64: string; name?: string }[];
        __nativeUrls: string[];
        workbenchApp: unknown;
      };
      target.__nativeSaves = [];
      target.__nativeUrls = [];
      target.workbenchApp = {
        getNetworks: () => '[]',
        switchNetwork: () => {},
        openAddressEditor: () => {},
        setOverlayOpen: () => {},
        saveImage: (url: string) => { target.__nativeUrls.push(url); },
        saveImageData: (base64: string, name?: string) => {
          target.__nativeSaves.push({ base64, name });
          window.setTimeout(() => {
            (window as unknown as { __workbenchImageSaved?: (ok: boolean) => void }).__workbenchImageSaved?.(true);
          }, 0);
        },
      };
    });

    const stamp = Date.now();
    const product = await seedProductWithImage(page, stamp);

    try {
      await openImagesModal(page, product.sku, true);
      await selectFirstThumbnail(page);

      await expect(page.locator('.product-images-help')).toContainText('点「保存到相册」即可存进手机相册');
      await page.locator('.product-images-save-button').click();

      await expect(page.locator('.product-images-copy-message')).toHaveText('已保存 1 张到手机相册');
      // 网页交给原生的必须是原图字节（1×1 PNG），不是缩略图、也不是空数据。
      const saves = await page.evaluate(() => (window as unknown as { __nativeSaves: { base64: string; name?: string }[] }).__nativeSaves);
      expect(saves).toHaveLength(1);
      expect(Buffer.from(saves[0].base64, 'base64').equals(PNG_1X1)).toBe(true);
      // 新通道生效后，壳自己下载的老通道不该再被调用。
      const legacyUrls = await page.evaluate(() => (window as unknown as { __nativeUrls: string[] }).__nativeUrls);
      expect(legacyUrls).toHaveLength(0);
      // 有原生保存能力时不该再打开那个靠长按的全屏大图（WebView 里长按本来就是空操作）。
      await expect(page.locator('.image-save-viewer')).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });

  test('旧壳没有新通道时退回原生下载，地址升级为完整地址', async ({ page, context }) => {
    await forceInsecureContext(context);
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await context.addInitScript(() => {
      const target = window as unknown as { __nativeSaves: { url: string; name?: string }[]; workbenchApp: unknown };
      target.__nativeSaves = [];
      target.workbenchApp = {
        getNetworks: () => '[]',
        switchNetwork: () => {},
        openAddressEditor: () => {},
        setOverlayOpen: () => {},
        saveImage: (url: string, name?: string) => {
          target.__nativeSaves.push({ url, name });
          window.setTimeout(() => {
            (window as unknown as { __workbenchImageSaved?: (ok: boolean) => void }).__workbenchImageSaved?.(true);
          }, 0);
        },
      };
    });

    const stamp = Date.now();
    const product = await seedProductWithImage(page, stamp);

    try {
      await openImagesModal(page, product.sku, true);
      await selectFirstThumbnail(page);
      await page.locator('.product-images-save-button').click();
      await expect(page.locator('.product-images-copy-message')).toHaveText('已保存 1 张到手机相册');
      const saves = await page.evaluate(() => (window as unknown as { __nativeSaves: { url: string }[] }).__nativeSaves);
      expect(saves).toHaveLength(1);
      // 壳不再自己从当前页地址拼接，必须收到完整地址；且必须是原图而非 240px 缩略图。
      expect(saves[0].url).toMatch(/^http/);
      expect(saves[0].url).toContain('/files/product-images/');
      expect(saves[0].url).not.toContain('/api/thumbs/');
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });

  test('保存失败：失败环节显示在界面并回报到服务端诊断接口', async ({ page, context }) => {
    await forceInsecureContext(context);
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await context.addInitScript(() => {
      const target = window as unknown as { __saved: unknown[]; __legacy: unknown[]; workbenchApp: unknown };
      target.__saved = [];
      target.__legacy = [];
      target.workbenchApp = {
        getNetworks: () => '[]',
        switchNetwork: () => {},
        openAddressEditor: () => {},
        setOverlayOpen: () => {},
        // 真实 1.18 壳两个方法都在：能力判断仍看 saveImage，走哪条通道看 saveImageData。
        saveImage: (url: string) => { target.__legacy.push(url); },
        // 不自动回执：由用例模拟壳里写入失败时的两个回调。
        saveImageData: () => { target.__saved.push(true); },
      };
    });
    const diagnostics: unknown[] = [];
    await page.route('**/api/client-diagnostics', async (route) => {
      diagnostics.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { received: true } }) });
    });

    const stamp = Date.now();
    const product = await seedProductWithImage(page, stamp);

    try {
      await openImagesModal(page, product.sku, true);
      await selectFirstThumbnail(page);
      await page.locator('.product-images-save-button').click();
      // 等网页把图片抓完并交给壳之后再模拟壳的失败回执（原生也是先回报环节、再给保存回执）。
      await expect.poll(() => page.evaluate(() => (window as unknown as { __saved: unknown[] }).__saved.length)).toBe(1);
      await page.evaluate(() => {
        const target = window as unknown as {
          __workbenchSaveFailed?: (stage: string, message: string) => void;
          __workbenchImageSaved?: (ok: boolean) => void;
        };
        target.__workbenchSaveFailed?.('write', 'IOException: boom');
        target.__workbenchImageSaved?.(false);
      });

      await expect(page.locator('.product-images-copy-message')).toContainText('写入相册失败');
      await expect.poll(() => diagnostics.length).toBe(1);
      expect((diagnostics[0] as { stage?: string; kind?: string }).stage).toBe('write');
      expect((diagnostics[0] as { kind?: string }).kind).toBe('image-save');
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });
});

test.describe('桌面端：安全上下文', () => {
  test('保留复制按钮，并始终提供下载兜底', async ({ page }) => {
    const stamp = Date.now();
    const product = await seedProductWithImage(page, stamp);

    try {
      await openImagesModal(page, product.sku, false);
      await selectFirstThumbnail(page);

      const canCopyImages = await page.evaluate(() => (
        window.isSecureContext && typeof navigator.clipboard?.write === 'function' && typeof ClipboardItem !== 'undefined'
      ));
      expect(canCopyImages).toBe(true);

      await expect(page.locator('.product-images-copy-button')).toHaveText(/复制所选图片（1）/);
      // 下载兜底不再藏在「复制失败提示」后面，安全上下文下也一直可见。
      await expect(page.locator('.product-images-download-button')).toHaveText(/下载所选图片（1）/);
      await expect(page.locator('.product-images-save-button')).toHaveCount(0);
      await expect(page.locator('.product-images-help')).toContainText('右键保存图片');
    } finally {
      await page.request.delete(`/api/products/${product.id}`);
    }
  });
});
