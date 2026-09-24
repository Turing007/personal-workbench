import { expect, test } from '@playwright/test';
import { ensureAuthenticated, injectSession } from './helpers/auth';

// 品牌标已从「工」换成字母 V（Vigortech），与 App 桌面图标同源；这两处是最容易被改回去的地方。
test('登录页品牌标显示为 V', async ({ page }) => {
  await page.goto('/');
  const mark = page.locator('.auth-brand-mark');
  await expect(mark).toBeVisible();
  await expect(mark).toHaveText('V');
});

test('未设置公司 Logo 时侧栏品牌标回退为 V', async ({ context, page, request }) => {
  await injectSession(context, await ensureAuthenticated(request));
  await page.goto('/');
  const logo = page.locator('.sidebar-logo');
  await expect(logo).toHaveText('V');
  // 字号必须显式给出：跟随正文会让 V 在 34px 的色块里显得过小。
  await expect(logo).toHaveCSS('font-size', '19px');
});
