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

/** 1×1 PNG：文件头是标准 89 50 4E 47，供「只认文件头」那条兜底分支使用。 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** PDF 文件头，代表「确实不是图片」的文件。 */
const PDF_HEAD = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3];

const PRODUCT_IMAGE_ENDPOINT = /^\/api\/products\/\d+\/images$/;

/** 进入产品库；手机端主导航收在「更多模块」抽屉里。 */
async function openProducts(page: Page, mobile = false) {
  await page.goto('/');
  if (mobile) await page.locator('.mobile-tab-item[aria-label="更多模块"]').click();
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
}

/**
 * 点「添加」打开产品编辑器。
 *
 * 不能用 getByRole('button', { name: '添加产品' })：手机端「产品」两个字被 .products-mobile-hidden 藏起来，
 * 可访问名随宽度变化，所以直接锚定工具条上的主按钮。
 */
async function openProductEditor(page: Page) {
  await page.locator('.products-page .page-toolbar .button-primary').click();
  await expect(page.getByRole('dialog').locator('.product-editor')).toBeVisible();
}

/**
 * 把文件塞进图片上传框。
 *
 * 必须用 DataTransfer + 手动派发 change，而不是 page.setInputFiles：setInputFiles 会带上 Playwright
 * 自己推断出的 MIME，测不到手机端「file.type 为空 / application/octet-stream」这个真实情形——而它正是这个 bug 的根源。
 */
async function pickImageFile(page: Page, name: string, type: string, bytes: number[]) {
  await page.evaluate(({ name, type, bytes }) => {
    const input = document.querySelector('.product-editor .image-upload-empty input[type=file]') as HTMLInputElement | null;
    if (!input) throw new Error('找不到产品编辑器的图片上传输入框');
    const file = new File([new Uint8Array(bytes)], name, { type });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { name, type, bytes });
}

test.describe('手机端：系统选图/拍照回来的文件拿不到可靠 MIME', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('没有 MIME 的照片不再被静默丢弃，能进列表并成功传进产品库', async ({ page, context }) => {
    // 触摸标记要在编辑器挂载前生效，和真机 WebView 的行为保持一致。
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    await openProducts(page, true);
    await openProductEditor(page);

    const uploadStatuses: number[] = [];
    page.on('response', (response) => {
      if (PRODUCT_IMAGE_ENDPOINT.test(new URL(response.url()).pathname) && response.request().method() === 'POST') {
        uploadStatuses.push(response.status());
      }
    });

    await page.getByRole('dialog').locator('.form-grid-3 label', { hasText: '品名' }).locator('input').fill(`E2E手机上传${Date.now()}`);

    // 安卓相机 / 系统选图最常见的两种返回值：空字符串，和 application/octet-stream。
    await pickImageFile(page, 'IMG_20260918.jpg', '', Array.from(PNG_1X1));
    await pickImageFile(page, 'download', 'application/octet-stream', Array.from(PNG_1X1));

    // 核心断言：两张都进了待上传列表，而且没有任何「不支持」提示。
    await expect(page.locator('.product-editor .image-card')).toHaveCount(2);
    await expect(page.locator('.product-editor .image-upload-message')).toHaveCount(0);

    const createResponse = page.waitForResponse((response) => (
      new URL(response.url()).pathname === '/api/products' && response.request().method() === 'POST'
    ));

    await page.getByRole('dialog').getByRole('button', { name: '保存产品' }).click();

    const productId = String((await (await createResponse).json()).data.id);

    try {
      // 修之前：这两张图的 file.type 都不合法，会被静默丢弃，一个上传请求都发不出来，这里直接超时。
      await expect.poll(() => uploadStatuses.length, { message: '两张图片都该发出上传请求' }).toBe(2);
      // 服务端只放行 PNG / JPEG / WebP，201 就证明上传时带的 Content-Type 已被纠正（否则是 400 UNSUPPORTED_IMAGE_TYPE）。
      expect(uploadStatuses).toEqual([201, 201]);

      const detail = await page.request.get(`/api/products/${productId}`);
      expect(((await detail.json()).data as { images: unknown[] }).images).toHaveLength(2);
    } finally {
      await page.request.delete(`/api/products/${productId}`);
    }
  });

  test('确实不支持的格式给出可见提示，而不是「点了没反应」', async ({ page, context }) => {
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    await openProducts(page, true);
    await openProductEditor(page);

    await pickImageFile(page, 'IMG_0001.HEIC', 'image/heic', PDF_HEAD);

    // .image-upload-hint 在手机端被 CSS 隐藏，所以提示必须落在单独的元素上，否则用户什么都看不到。
    const message = page.locator('.product-editor .image-upload-message');
    await expect(message).toBeVisible();
    await expect(message).toHaveText('仅支持 JPG、PNG、WebP 图片');
    await expect(page.locator('.product-editor .image-card')).toHaveCount(0);
  });

  test('点「添加图片」磁贴必须真的打开系统选图器', async ({ page, context }) => {
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    await openProducts(page, true);
    await openProductEditor(page);

    // 图片墙已按分类分文件夹，每个文件夹有自己的磁贴；这里统一锚定第一个文件夹（精修图）的磁贴。
    const tile = page.locator('.product-editor .image-upload-empty').first();
    await expect(tile).toBeVisible();
    // 磁贴在弹窗底部，elementFromPoint 只认视口内的坐标，先滚到可见区域再量命中点。
    await tile.scrollIntoViewIfNeeded();

    // Android WebView 不会把 <label> 的点按转发给 display:none 的 file input：真机上表现为
    // 点「添加图片」毫无反应，连一个上传请求都发不出去。所以输入框必须保持「已渲染」。
    const inputDisplay = await tile.locator('input[type=file]').evaluate((input) => getComputedStyle(input).display);
    expect(inputDisplay).not.toBe('none');

    // 只断言「display 不是 none」挡不住回归：磁贴上的透明 input 一旦没铺满，
    // 真机手指落在图标/文字上，选图器照样不弹。这里直接验证磁贴中心点确实命中 input。
    expect(await tile.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit?.tagName.toLowerCase() === 'input';
    })).toBe(true);

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      tile.click(),
    ]);

    await chooser.setFiles({ name: 'IMG_20260918.jpg', mimeType: 'image/jpeg', buffer: PNG_1X1 });

    await expect(page.locator('.product-editor .image-card')).toHaveCount(1);

    // 「添加附件」原来是 <label> 包一个 hidden（display:none）的 input，真机上点了完全没反应，
    // 和图片磁贴是同一条激活链路，这里一并守住。
    const attachmentButton = page.locator('.product-editor .product-editor-file-button');
    await attachmentButton.scrollIntoViewIfNeeded();
    const [attachmentChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      attachmentButton.click(),
    ]);
    await attachmentChooser.setFiles({ name: '说明书.pdf', mimeType: 'application/pdf', buffer: Buffer.from(PDF_HEAD) });
    await expect(page.locator('.product-editor .attachment-row')).toHaveCount(1);

    // 未保存就关闭，不留下测试数据。
    await page.getByRole('dialog').locator('.modal-close').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('桌面端：安全上下文', () => {
  test('MIME 正常时原样接受，不出现多余提示', async ({ page }) => {
    await openProducts(page);
    await openProductEditor(page);

    await pickImageFile(page, 'photo.png', 'image/png', Array.from(PNG_1X1));

    await expect(page.locator('.product-editor .image-card')).toHaveCount(1);
    await expect(page.locator('.product-editor .image-upload-message')).toHaveCount(0);

    // 未保存就关闭，不留下测试数据。
    await page.getByRole('dialog').locator('.modal-close').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('App 内：原生选文件桥（WebView file input 激活链失效时的通路）', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('点磁贴/附件按钮优先调原生桥，回传后文件进列表，且不再弹 WebView 选图器', async ({ page, context }) => {
    // 模拟安卓壳注入的 window.workbenchApp：记录调用参数，并像真机一样异步回传 base64。
    await page.addInitScript((base64) => {
      const calls: Array<{ accept: string; multiple: boolean; max: number }> = [];
      (window as unknown as Record<string, unknown>).__pickCalls = calls;
      (window as unknown as Record<string, unknown>).workbenchApp = {
        pickFiles(acceptJson: string, multiple: boolean, maxCount: number, requestId: string) {
          calls.push({ accept: acceptJson, multiple, max: maxCount });
          setTimeout(() => {
            (window as unknown as { __workbenchPickedFiles?: (id: string, files: unknown[]) => void })
              .__workbenchPickedFiles?.(requestId, [
                { name: 'IMG_native.jpg', type: 'image/jpeg', size: 68, data: base64 },
              ]);
          }, 30);
          return true;
        },
      };
    }, PNG_1X1.toString('base64'));

    const client = await context.newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    await openProducts(page, true);
    await openProductEditor(page);

    // 原生桥接管后不允许再弹 WebView 自己的选图器（弹了说明 preventDefault 失效）。
    let webViewChooserOpened = false;
    page.on('filechooser', () => { webViewChooserOpened = true; });

    const tile = page.locator('.product-editor .image-upload-empty').first();
    await tile.scrollIntoViewIfNeeded();
    await tile.click();
    await expect(page.locator('.product-editor .image-card')).toHaveCount(1);

    const calls = await page.evaluate(() => (window as unknown as { __pickCalls: Array<{ accept: string; multiple: boolean }> }).__pickCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0].accept).toBe('["image/*"]');
    expect(calls[0].multiple).toBe(true);

    // 「添加附件」按钮与磁贴是同一条激活链，同样要走原生桥。
    const attachmentButton = page.locator('.product-editor .product-editor-file-button');
    await attachmentButton.scrollIntoViewIfNeeded();
    await attachmentButton.click();
    await expect(page.locator('.product-editor .attachment-row')).toHaveCount(1);

    expect(webViewChooserOpened).toBe(false);

    // 未保存就关闭，不留下测试数据。
    await page.getByRole('dialog').locator('.modal-close').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('原生桥拉起失败（返回 false）时退回 input 路径，仍能弹选图器', async ({ page, context }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).workbenchApp = {
        pickFiles: () => false, // 模拟个别 ROM 上连原生意图都拉不起来
      };
    });

    const client = await context.newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    await openProducts(page, true);
    await openProductEditor(page);

    const tile = page.locator('.product-editor .image-upload-empty').first();
    await tile.scrollIntoViewIfNeeded();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      tile.click(),
    ]);
    await chooser.setFiles({ name: 'fallback.jpg', mimeType: 'image/jpeg', buffer: PNG_1X1 });
    await expect(page.locator('.product-editor .image-card')).toHaveCount(1);

    await page.getByRole('dialog').locator('.modal-close').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
