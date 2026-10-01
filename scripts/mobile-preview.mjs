// 手机视口走查：对预览实例截图，覆盖全部 8 个模块 + 底部 Tab/抽屉/订单表单，
// 并检查每页是否出现横向溢出（scrollWidth 超出视口宽度）。
// 运行：node scripts/mobile-preview.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:52342';
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

const shot = async (name) => {
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return { scrollWidth: document.scrollingElement.scrollWidth, width, overflow: document.scrollingElement.scrollWidth > width };
  });
  if (overflow.overflow) console.warn(`[overflow] ${name}: scrollWidth ${overflow.scrollWidth} > viewport ${overflow.width}`);
  await page.screenshot({ path: `${outDir}/${name}.png` });
};

const openFromDrawer = async (label) => {
  await page.locator('.mobile-tabbar button', { hasText: '更多' }).click();
  await page.waitForTimeout(450);
  await page.locator('.sidebar nav button, .sidebar button', { hasText: label }).first().click();
  await page.waitForLoadState('networkidle');
};

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1200);
await shot('01-orders');

// 底部 Tab：报价 / 发货 / 财务
for (const [label, name] of [['报价', '02-quotations'], ['发货', '03-shipping'], ['财务', '04-finance']]) {
  await page.locator('.mobile-tabbar button', { hasText: label }).first().click();
  await page.waitForLoadState('networkidle');
  await shot(name);
}

// “更多”抽屉 + 抽屉里的四个模块
await page.locator('.mobile-tabbar button', { hasText: '更多' }).click();
await page.waitForTimeout(450);
await shot('05-drawer');
await page.locator('.sidebar-mobile-close').click();
await page.waitForTimeout(300);

for (const [label, name] of [['产品库', '06-products'], ['客户产品库', '07-customer-products'], ['销售开单', '08-sales-documents'], ['设置', '09-settings']]) {
  await openFromDrawer(label);
  await shot(name);
}

// 回订单页：新建订单表单（移动端表单是适配重点）
await page.locator('.mobile-tabbar button', { hasText: '订单' }).first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: '新建订单' }).click();
await page.waitForTimeout(600);
await shot('10-order-form');
await page.getByRole('button', { name: '填写订单详情' }).click();
await page.waitForTimeout(600);
await shot('11-order-detail-editor');

await browser.close();
console.log(`screenshots saved to ${outDir}`);
