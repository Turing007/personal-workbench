// 手机视口走查：对预览实例截图，检查底部 Tab、抽屉、订单卡片、表单与财务页。
// 运行：node scripts/mobile-preview.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:52399';
const outDir = 'test-results/mobile';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

const shot = async (name) => page.screenshot({ path: `${outDir}/${name}.png` });

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1200);
await shot('01-orders');

// 打开“更多”抽屉
await page.locator('.mobile-tabbar button', { hasText: '更多' }).click();
await page.waitForTimeout(450);
await shot('02-drawer');
await page.locator('.sidebar-mobile-close').click();
await page.waitForTimeout(300);

// 财务页
await page.locator('.mobile-tabbar button', { hasText: '财务' }).click();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(900);
await shot('03-finance');

// 回订单页，打开新建订单表单
await page.locator('.mobile-tabbar button', { hasText: '订单' }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: '新建订单' }).click();
await page.waitForTimeout(600);
await shot('04-order-form');
await page.getByRole('button', { name: '填写订单详情' }).click();
await page.waitForTimeout(600);
await shot('05-order-detail-editor');

await browser.close();
console.log(`screenshots saved to ${outDir}`);
