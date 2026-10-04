import { expect, test, type Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

/**
 * 产品文件后台上传：点保存之后不等图片传完就能走开，图片在后台继续传并最终落到产品上。
 *
 * 这里刻意把图片上传拖慢（每张 1.2 秒），模拟手机原图上传的真实耗时 ——
 * 不拖慢的话图片几乎瞬间传完，"编辑器先关、图片后到"根本测不出来。
 */
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

test.describe('产品图片后台上传', () => {
  test('点保存后编辑器立刻关闭，图片在后台传完并落到产品上', async ({ page }) => {
    // 每张图上传耗时 1.2 秒：串行两张要 2.4 秒，足够暴露"是不是在等上传"。
    await page.route('**/api/products/*/images*', async (route) => {
      if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 1200));
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

    // 断言 1：不等图片传完，编辑器就先关了（上传还在跑，至少 2.4 秒）
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 4000 });

    // 断言 2：顶部出现进度条，并给该产品打上「图片上传中」。
    // 产品库按名称排序、每页 20 条，新建的产品不一定在第 1 页，先按名字搜出来。
    await expect(page.locator('.upload-progress')).toBeVisible();
    await page.locator('.search-control input').fill(name);
    await expect(page.locator('.badge', { hasText: '图片上传中' }).first()).toBeVisible();

    // 断言 3：切到别的页面，上传不受影响
    await page.locator('.sidebar-nav').getByRole('button', { name: '订单', exact: true }).click();
    await expect(page.locator('.upload-progress')).toBeVisible();
    await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();

    // 断言 4：两张图最终都落到产品上
    await expect.poll(async () => {
      const response = await page.request.get(`/api/products?q=${encodeURIComponent(name)}`);
      const body = await response.json();
      const items = body.data.items ?? body.data.rows ?? [];
      const product = items.find((item: { name?: string }) => item.name === name);
      return product ? (product.images ?? []).length : -1;
    }, { timeout: 30_000, message: '两张图片最终都该上传完成' }).toBe(2);

    // 断言 5：传完进度条自动消失
    await expect(page.locator('.upload-progress')).toHaveCount(0, { timeout: 30_000 });
  });
});
