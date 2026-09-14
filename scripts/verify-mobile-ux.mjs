// 手机端交互验证脚本：产品库列表 + 客户产品库「选客户后隐藏列表」左右切换。
// 用法: node scripts/verify-mobile-ux.mjs （需先在 52399 端口跑起 e2e 数据实例）
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:52399';
const OUT = 'test-results/ux-shots';
mkdirSync(OUT, { recursive: true });

function e2eSecretFor(name) {
  return `wb-e2e-${name}-2026`;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

// 登录
await page.goto(BASE + '/');
await page.waitForSelector('.auth-card', { timeout: 15000 });
await page.fill('#auth-username', 'e2e-admin');
await page.fill('#auth-password', e2eSecretFor('admin'));
await page.click('.auth-submit');
await page.waitForSelector('.mobile-tabbar', { timeout: 15000 });
await page.waitForTimeout(1000);

// 造一个有产品的客户，保证客户产品库有内容可看
const stamp = Date.now();
const customerRes = await page.request.post(`${BASE}/api/customers`, {
  data: { name: `UX验证客户${stamp}`, contactName: '联系人', contactPhone: '13800000000', shippingInfo: '深圳市' },
});
const customer = (await customerRes.json()).data;
await page.request.post(`${BASE}/api/customers/${customer.id}/products`, {
  data: {
    name: `UX验证产品${stamp}`,
    specification: '标准款',
    sku: `UX-${stamp}`,
    packCount: 20,
    finalPriceCents: 8800,
    costPriceCents: 5200,
    packaging: [{ name: '彩盒', packCount: 20, innerSize: '', innerWeight: 0, outerSize: '', outerWeight: 0 }],
  },
});

// 造数在页面加载之后，刷新一次让新客户出现在列表里
await page.reload();
await page.waitForSelector('.mobile-tabbar', { timeout: 15000 });
await page.waitForTimeout(1200);

// 1) 产品库列表（验证卡片视图正常渲染）
await page.getByRole('button', { name: '更多' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '产品库', exact: true }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/01-products-list.png` });

// 断言：手机上产品以卡片渲染，桌面表格隐藏
const productCards = await page.locator('.products-card-list .product-card').count();
const productTableVisible = await page.locator('.products-table-desktop').isVisible();
console.log(`[01 产品库] 产品卡片数=${productCards} 桌面表格可见=${productTableVisible}`);

// 2) 客户产品库：客户列表视图
await page.getByRole('button', { name: '更多' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '客户产品库' }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/02-customer-list.png` });

const customerPanelVisibleBefore = await page.locator('.customer-list-panel').isVisible();
const customerItems = await page.locator('.customer-list-item').count();
console.log(`[02 客户列表] 客户面板可见=${customerPanelVisibleBefore} 客户行数=${customerItems}`);

// 3) 点选客户 → 客户列表应隐藏、整屏展示该客户产品
await page.getByRole('button', { name: new RegExp(`UX验证客户${stamp}`) }).first().click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/03-products-only.png` });

const customerPanelVisibleAfter = await page.locator('.customer-list-panel').isVisible();
const productCardCount = await page.locator('.customer-product-card').count();
const backButtonVisible = await page.locator('.customer-panel-back').isVisible();
console.log(`[03 选中客户] 客户面板可见=${customerPanelVisibleAfter} 产品卡片数=${productCardCount} 切换客户按钮可见=${backButtonVisible}`);

// 4) 点「切换客户」应回到客户列表
await page.getByRole('button', { name: '切换客户' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/04-back-to-list.png` });
const customerPanelVisibleBack = await page.locator('.customer-list-panel').isVisible();
console.log(`[04 返回] 客户面板可见=${customerPanelVisibleBack}`);

const failures = [];
if (productCards === 0) failures.push('产品库卡片未渲染');
if (productTableVisible) failures.push('手机端仍显示桌面表格');
if (!customerPanelVisibleBefore) failures.push('初始未显示客户列表');
if (customerPanelVisibleAfter) failures.push('选中客户后客户列表未隐藏');
if (productCardCount === 0) failures.push('选中客户后产品卡片未渲染');
if (!backButtonVisible) failures.push('切换客户按钮不可见');
if (!customerPanelVisibleBack) failures.push('切换客户后未回到客户列表');
console.log(failures.length ? `FAIL: ${failures.join('；')}` : 'PASS: 手机端交互断言全部通过');

// 清理
const productList = await (await page.request.get(`${BASE}/api/customers/${customer.id}/products`)).json();
for (const item of productList.data.items) {
  await page.request.delete(`${BASE}/api/customers/${customer.id}/products/${item.id}`);
}
await page.request.delete(`${BASE}/api/customers/${customer.id}`);

await browser.close();
console.log('done');
