import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

let sessionCookie: string;

test.beforeAll(async ({ request }) => {
  sessionCookie = await ensureAuthenticated(request);
});

test.beforeEach(async ({ context }) => {
  await injectSession(context, sessionCookie);
});

/** 与服务端 parsePackaging 对齐的包装字段，packCount 为必填正整数。 */
const PACKAGING = {
  name: '彩盒包装',
  innerSize: '10×5×3',
  innerWeight: 0.5,
  outerSize: '40×30×25',
  outerWeight: 8,
  packCount: 24,
};

const EXPECTED_COPY_TEXT = [
  '名称：彩盒包装',
  '内盒尺寸：10×5×3cm',
  '内盒重量：0.5kg',
  '外箱尺寸：40×30×25cm',
  '外箱重量：8kg',
  '装箱数量：24个/箱',
].join('\n');

/**
 * 把页面强行变成「非安全上下文」，复现手机通过 http://局域网IP:端口 访问的情形。
 *
 * 这一层伪装是本用例存在的理由：navigator.clipboard 只在安全上下文（https / localhost）下存在，
 * 而 Playwright 自己跑在 http://127.0.0.1，天生是安全上下文。不伪装的话测到的永远是
 * navigator.clipboard 那条分支，而这正是当初「真机点复制没反应、本地怎么都复现不出来」的原因。
 */
async function forceInsecureContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { get: () => false, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    const captured: string[] = [];
    (window as unknown as { __copiedTexts: string[] }).__copiedTexts = captured;
    // 兜底分支最终落到 execCommand('copy')，把当时选中的 textarea 内容记为「已复制文本」。
    document.execCommand = ((commandId: string) => {
      if (commandId === 'copy' && document.activeElement instanceof HTMLTextAreaElement) {
        captured.push(document.activeElement.value);
      }
      return true;
    }) as typeof document.execCommand;
  });
}

async function seedProduct(page: Page, stamp: number) {
  const response = await page.request.post('/api/products', {
    data: {
      name: `E2E复制包装${stamp}`,
      supplier: 'E2E供应商',
      status: 'active',
      packaging: [PACKAGING],
    },
  });
  expect(response.ok()).toBeTruthy();
  // 新建产品的 SKU 由服务端按 VT-#### 规则生成（客户端传入的 sku 仅在导入时生效），
  // 因此这里必须用响应里回填的真实 SKU 去定位行，不能自己臆造一个。
  return (await response.json()).data as { id: string; sku: string };
}

async function openProductRow(page: Page, sku: string) {
  await page.goto('/');
  await page.locator('.sidebar-nav').getByRole('button', { name: '产品库', exact: true }).click();
  await page.locator('.products-page .page-toolbar .search-control input').fill(sku);
  const row = page.locator('.products-data-table tbody tr', { hasText: sku });
  await expect(row).toHaveCount(1);
  return row;
}

test('产品库包装信息复制按钮在非安全上下文（局域网 http）下仍能复制', async ({ page, context }) => {
  await forceInsecureContext(context);
  const stamp = Date.now();
  const product = await seedProduct(page, stamp);

  try {
    const row = await openProductRow(page, product.sku);
    const copyButton = row.locator('.product-packaging-copy-button');
    await copyButton.click();

    // 复制成功才允许翻成「已复制」；失败时保持原文案，不会再假装成功。
    await expect(copyButton).toHaveAttribute('title', '已复制包装详情');
    expect(await page.evaluate(() => (window as unknown as { __copiedTexts: string[] }).__copiedTexts))
      .toEqual([EXPECTED_COPY_TEXT]);
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});

test('产品库包装信息复制按钮在安全上下文下走原生剪贴板接口并给出反馈', async ({ page }) => {
  const stamp = Date.now();
  const product = await seedProduct(page, stamp);

  try {
    const row = await openProductRow(page, product.sku);
    const copyButton = row.locator('.product-packaging-copy-button');

    const usedNativeApi = await row.evaluate(() => window.isSecureContext && !!navigator.clipboard?.writeText);
    expect(usedNativeApi).toBe(true);

    await copyButton.click();
    await expect(copyButton).toHaveAttribute('title', '已复制包装详情');
  } finally {
    await page.request.delete(`/api/products/${product.id}`);
  }
});
