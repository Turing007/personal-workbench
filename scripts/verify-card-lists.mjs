// 检测：手机视口下各卡片列表页面是否存在内容被裁剪（滑不到底）。
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:52399';
const stamp = Date.now();

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();

await page.goto(BASE + '/');
await page.waitForSelector('.auth-card', { timeout: 15000 });
await page.fill('#auth-username', 'e2e-admin');
await page.fill('#auth-password', 'wb-e2e-admin-2026');
await page.click('.auth-submit');
await page.waitForSelector('.mobile-tabbar', { timeout: 15000 });
await page.waitForTimeout(800);

// 造 12 张报价单 + 12 张销售单，制造长列表
const customer = (await (await page.request.post(`${BASE}/api/customers`, {
  data: { name: `裁剪检测客户${stamp}`, contactName: '联系人', contactPhone: '13800000000', shippingInfo: '深圳市' },
})).json()).data;
for (let index = 0; index < 12; index += 1) {
  await page.request.post(`${BASE}/api/quotations`, {
    data: {
      customerId: customer.id,
      quotationDate: '2026-09-14',
      customerName: customer.name,
      contactName: '联系人',
      contactPhone: '13800000000',
      customerAddress: '深圳市',
      validUntil: '2026-09-30',
      taxRateBps: 0,
      companySnapshot: { name: '验证公司', logoRelativePath: null, phone: '', address: '', defaultIssuer: '' },
      displayConfig: { showLogo: false, showCompanyPhone: true, showCompanyAddress: true, showContactPhone: true, showTax: true, showTaxIncludedTotal: true, columns: { image: true, name: true, specification: true, unitPrice: true, tierPrice: true, remark: true } },
      items: [{ clientKey: `line-${index}`, productId: null, isTemporary: true, name: `裁剪验证产品${stamp}-${index}`, sku: '', specification: '标准', unitPriceCents: 1000, remark: '', sortOrder: 0 }],
      customFields: [],
    },
  });
  await page.request.post(`${BASE}/api/sales-documents`, {
    data: {
      customerId: customer.id,
      documentDate: '2026-09-14',
      customerName: customer.name,
      contactName: '联系人',
      contactPhone: '13800000000',
      address: '深圳市',
      taxRateBps: 0,
      companySnapshot: { name: '验证公司', logoRelativePath: null, phone: '', address: '', defaultIssuer: '' },
      displayConfig: { showLogo: false, showCompanyPhone: true, showCompanyAddress: true, showContactPhone: true, showTax: true, showTaxIncludedTotal: true, columns: { image: true, name: true, specification: true, unitPrice: true, tierPrice: true, remark: true } },
      items: [{ clientKey: `line-${index}`, productId: null, isTemporary: true, name: `裁剪验证产品${stamp}-${index}`, sku: '', specification: '标准', unitPriceCents: 1000, remark: '', sortOrder: 0 }],
      customFields: [],
    },
  });
}

await page.reload();
await page.waitForSelector('.mobile-tabbar', { timeout: 15000 });

async function measure(label, cardSelector) {
  await page.waitForTimeout(1200);
  const result = await page.evaluate((selector) => {
    const cards = document.querySelectorAll(selector);
    const last = cards[cards.length - 1];
    const doc = document.scrollingElement;
    return {
      cards: cards.length,
      docScrollHeight: doc.scrollHeight,
      viewport: doc.clientHeight,
      lastCardBottom: last ? Math.round(last.getBoundingClientRect().bottom + doc.scrollTop) : null,
    };
  }, cardSelector);
  const clipped = result.lastCardBottom != null && result.lastCardBottom > result.docScrollHeight + 4;
  console.log(`${label}: 卡片数=${result.cards} 最后卡片底边=${result.lastCardBottom} 可滚动总高=${result.docScrollHeight} => ${clipped ? '被裁剪❌' : '正常✅'}`);
  return clipped;
}

async function openModule(name, exact = false) {
  await page.getByRole('button', { name: '更多' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name, exact }).click();
}

await openModule('产品库', true);
await measure('产品库', '.products-card-list .product-card');

await openModule('报价单');
await measure('报价单', '.quotation-card-list > *');

await openModule('销售开单');
await measure('销售开单', '.sales-doc-card-list > *');

await openModule('客户产品库');
await page.locator('.customer-list-item').first().click();
await page.waitForTimeout(800);
await measure('客户产品库', '.customer-product-card-list .customer-product-card');

await openModule('订单管理');
await measure('订单管理', '.orders-card-list > *');

// 清理
const quotations = await (await page.request.get(`${BASE}/api/quotations?pageSize=50`)).json();
for (const row of quotations.data.rows.filter((item) => item.customerName === customer.name)) {
  await page.request.delete(`${BASE}/api/quotations/${row.id}`, { data: { confirmed: true } });
}
const sales = await (await page.request.get(`${BASE}/api/sales-documents?pageSize=50`)).json();
for (const row of sales.data.rows.filter((item) => item.customerName === customer.name)) {
  await page.request.delete(`${BASE}/api/sales-documents/${row.id}`, { data: { confirmed: true } });
}
await page.request.delete(`${BASE}/api/customers/${customer.id}`);

await browser.close();
