import { expect, test, type Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

/**
 * 产品文件后台上传：点保存之后不等图片传完就能走开，图片在后台继续传并最终落到产品上。
 * 产品图库里按张显示上传占位（本地预览 + 图下进度条），失败的单张标红、可单独重试。
 *
 * 这里刻意把图片上传拖慢（每张 2.5 秒），模拟手机原图上传的真实耗时 ——
 * 不拖慢的话图片几乎瞬间传完，"编辑器先关、占位在传"根本测不出来。
 */
test.describe.configure({ timeout: 90_000 });

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context, page }) => {
  await injectSession(context, sessionCookie);
  // 关掉 Service Worker：本用例要拦 POST 上传并把响应拖慢，SW 发出的请求不吃 page.route。
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: () => Promise.reject(new Error('SW disabled for test')) } });
  });
});

/** 1×1 PNG：够触发一次真实上传即可。 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function pickImageFile(page: Page, name: string) {
  await page.evaluate(({ name, bytes }) => {
    const input = document.querySelector('.product-editor .image-upload-empty input[type=file]') as HTMLInputElement | null;
    if (!input) throw new Error('找不到产品编辑器的图片上传输入框');
    const file = new File([new Uint8Array(bytes)], name, { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { name, bytes: Array.from(PNG_1X1) });
}

/** 按名字筛出唯一一个产品并打开它的「全部图片」。切过页面后搜索词会被清掉，每次都要重新筛。 */
async function openProductImages(page: Page, name: string) {
  await page.locator('.search-control input').fill(name);
  await expect(page.locator('.product-gallery-card')).toHaveCount(1);
  await page.locator('.product-gallery-card .product-gallery-image-button').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.product-images-side')).toBeVisible();
  return dialog;
}

/** 造一张指定尺寸的真图片文件塞进编辑器的图片输入框（用来验证预览被压缩）。 */
async function pickBigImage(page: Page, name: string, width: number, height: number) {
  await page.evaluate(async ({ name, width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.fillStyle = '#2f6f66';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#fff';
    context.font = '80px sans-serif';
    context.fillText(name, 40, Math.round(height / 2));
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value as Blob), 'image/jpeg', 0.9));
    const file = new File([blob], name, { type: 'image/jpeg' });
    const input = document.querySelector('.product-editor .image-upload-empty input[type=file]') as HTMLInputElement | null;
    if (!input) throw new Error('找不到产品编辑器的图片上传输入框');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { name, width, height });
}

test.describe('产品图片后台上传', () => {
  test('点保存后编辑器立刻关闭，图库里逐张显示进度，传完自动变成正式图片', async ({ page }) => {
    // 每张图上传耗时 2.5 秒：串行两张要 5 秒，够我们打开图库看到还在传的占位与进度条。
    await page.route('**/api/products/*/images*', async (route) => {
      if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });

    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
    await page.locator('.products-page .page-toolbar .button-primary').click();
    await expect(page.getByRole('dialog').locator('.product-editor')).toBeVisible();

    const name = `E2E后台上传${Date.now()}`;
    await page.getByRole('dialog').getByRole('textbox', { name: '品名' }).fill(name);
    await pickImageFile(page, 'IMG_A.jpg');
    await pickImageFile(page, 'IMG_B.jpg');
    await expect(page.locator('.product-editor .image-card')).toHaveCount(2);

    const createResponse = page.waitForResponse((response) => (
      new URL(response.url()).pathname === '/api/products' && response.request().method() === 'POST'
    ));
    await page.getByRole('dialog').getByRole('button', { name: '保存产品' }).click();
    const productId = String((await (await createResponse).json()).data.id);

    // 断言 1：不等图片传完，编辑器就先关了（上传还在跑，至少 5 秒）
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 4000 });

    // 断言 2：顶部出现进度条，并给该产品打上「图片上传中」。
    // 产品库按名称排序、每页 20 条，新建的产品不一定在第 1 页，先按名字搜出来。
    await expect(page.locator('.upload-progress')).toBeVisible();
    await page.locator('.search-control input').fill(name);
    await expect(page.locator('.badge', { hasText: '图片上传中' }).first()).toBeVisible();

    // 断言 3：打开产品的「全部图片」，正在传的图逐张占位：本地预览 + 图下进度条。
    const imagesDialog = await openProductImages(page, name);
    await expect(imagesDialog.locator('.product-images-pending')).toBeVisible();
    await expect.poll(() => imagesDialog.locator('.product-upload-tile').count()).toBeGreaterThan(0);
    await expect(imagesDialog.locator('.upload-tile-bar').first()).toBeVisible();

    // 关掉弹窗，切到别的页面，上传不受影响
    await imagesDialog.locator('.modal-close').click();
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await expect(page.locator('.upload-progress')).toBeVisible();
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();

    // 断言 4：弹窗开着不动，传完的图自动从占位变成正式图片
    await openProductImages(page, name);
    await expect(imagesDialog.locator('.product-images-pending')).toHaveCount(0, { timeout: 30_000 });
    await expect(imagesDialog.locator('.product-image-thumbnail')).toHaveCount(2, { timeout: 15_000 });
    await imagesDialog.locator('.modal-close').click();

    // 断言 5：两张图最终都落到产品上
    await expect.poll(async () => {
      const response = await page.request.get(`/api/products?q=${encodeURIComponent(name)}`);
      const body = await response.json();
      const items = body.data.items ?? body.data.rows ?? [];
      const product = items.find((item: { name?: string; id?: number }) => item.name === name || String(item.id) === productId);
      return product ? (product.images ?? []).length : -1;
    }, { timeout: 30_000, message: '两张图片最终都该上传完成' }).toBe(2);

    // 断言 6：传完进度条自动消失
    await expect(page.locator('.upload-progress')).toHaveCount(0, { timeout: 30_000 });
  });

  test('单张失败在图库里看得见原因，点「重试」只重跑这一张', async ({ page }) => {
    let failUploads = true;
    await page.route('**/api/products/*/images*', async (route) => {
      if (route.request().method() === 'POST' && failUploads) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: { code: 'INJECTED', message: '测试：上传失败' } }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
    await page.locator('.products-page .page-toolbar .button-primary').click();
    const name = `E2E上传失败重试${Date.now()}`;
    await page.getByRole('dialog').getByRole('textbox', { name: '品名' }).fill(name);
    await pickImageFile(page, 'IMG_FAIL.jpg');
    const createResponse = page.waitForResponse((response) => (
      new URL(response.url()).pathname === '/api/products' && response.request().method() === 'POST'
    ));
    await page.getByRole('dialog').getByRole('button', { name: '保存产品' }).click();
    await (await createResponse).json();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 4000 });

    // 自动重试两次（1s + 3s）后判失败：图库里的占位标红，并写明失败原因。
    const imagesDialog = await openProductImages(page, name);
    const failedTile = imagesDialog.locator('.product-upload-tile.is-failed');
    await expect(failedTile).toBeVisible({ timeout: 20_000 });
    await expect(failedTile.locator('.product-upload-tile-error')).toContainText('上传失败');

    // 放通上传，点这一张的「重试」：传成功后占位换成正式图片。
    failUploads = false;
    await failedTile.getByRole('button', { name: '重试' }).click();
    await expect(imagesDialog.locator('.product-images-pending')).toHaveCount(0, { timeout: 30_000 });
    await expect(imagesDialog.locator('.product-image-thumbnail')).toHaveCount(1, { timeout: 15_000 });
  });

  test('大图预览自动压成小图，编辑器和上传占位都不再拿原图当预览', async ({ page }) => {
    // 上传拖慢 4 秒：保存后留出时间在图库里看到"上传中"的占位。
    await page.route('**/api/products/*/images*', async (route) => {
      if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 4000));
      await route.continue();
    });

    await page.goto('/');
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
    await page.locator('.products-page .page-toolbar .button-primary').click();
    await expect(page.getByRole('dialog').locator('.product-editor')).toBeVisible();

    const name = `E2E大图预览${Date.now()}`;
    await page.getByRole('dialog').getByRole('textbox', { name: '品名' }).fill(name);
    // 2400×1800 的"相机大图"：原图直接当预览，一张就要解码十几 MB，几张就爆内存。
    await pickBigImage(page, '大图-A.jpg', 2400, 1800);

    // 编辑器卡片：等占位（1×1）被压缩预览替换，最长边不超过 512。
    const cardImage = page.locator('.product-editor .image-card-img').first();
    await expect.poll(
      async () => cardImage.evaluate((element: HTMLImageElement) => element.naturalWidth > 1 && element.naturalWidth <= 512),
      { timeout: 15_000 },
    ).toBe(true);

    await page.getByRole('dialog').getByRole('button', { name: '保存产品' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 4000 });
    await page.locator('.search-control input').fill(name);
    await expect(page.locator('.product-gallery-card')).toHaveCount(1);
    await page.locator('.product-gallery-card .product-gallery-image-button').first().click();

    // 图库里的上传占位同样是小图。
    const tileImage = page.getByRole('dialog').locator('.product-upload-tile-image img').first();
    await expect(tileImage).toBeVisible({ timeout: 15_000 });
    const tileWidth = await tileImage.evaluate((element: HTMLImageElement) => element.naturalWidth);
    expect(tileWidth).toBeGreaterThan(1);
    expect(tileWidth).toBeLessThanOrEqual(512);

    // 等上传完成，别把未传完的批次留在库里影响其它用例。
    await expect(page.getByRole('dialog').locator('.product-images-pending')).toHaveCount(0, { timeout: 30_000 });
  });
});
