// 一次性视觉巡检脚本：对生产构建截取手机视口的关键页面（浅色 + 深色）。
// 用法: node scripts/screenshot-mobile.mjs （需先在 52399 端口起好生产服务）
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:52399';
const OUT = 'test-results/ui-shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

await page.goto(BASE + '/');
await page.waitForSelector('.auth-card', { timeout: 15000 });
await page.screenshot({ path: `${OUT}/01-login-light.png` });

await page.fill('#auth-username', 'e2e-admin');
await page.fill('#auth-password', 'wb-e2e-admin-2026');
await page.click('.auth-submit');
await page.waitForSelector('.mobile-tabbar', { timeout: 15000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/02-orders-light.png` });

// 底部 Tab 直达财务
await page.getByRole('button', { name: '财务', exact: true }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/03-finance-light.png` });

// “更多”抽屉
await page.getByRole('button', { name: '更多' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/04-drawer-light.png` });
await page.getByRole('button', { name: '设置' }).click();
await page.getByRole('button', { name: '手机连接' }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/05-settings-mobile-light.png` });

// 深色模式
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/06-settings-mobile-dark.png` });
await page.getByRole('button', { name: '订单', exact: true }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/07-orders-dark.png` });

// 登出回到登录页（深色）
await page.getByRole('button', { name: '更多' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '退出登录' }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/08-login-dark.png` });

await browser.close();
console.log('done');
