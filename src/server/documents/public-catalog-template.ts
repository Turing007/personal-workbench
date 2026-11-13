import { escapeHtml } from './quotation-template.js';
import { parseParameterRows, packagingDetailBlock, type CatalogProduct, type PackagingDetailBlock } from './product-catalog-template.js';
import type { CompanySnapshot } from '../../shared/documents.js';
import { SITE_FILINGS, beianFooterItems } from '../../shared/site-filings.js';
import type { PublicCatalogProduct } from '../services/catalog-service.js';

/**
 * 在线图册（客户打开的样子）：独立轻量页，不加载工作台登录包。
 * 客户版口径与 PDF 完全一致：只有品名/SKU/参数/颜色插脚/包装，供应商与价格根本不出现在这份 HTML 里。
 */
export interface PublicCatalogPageData {
  catalog: { name: string; token: string; markupPercent: number };
  company: CompanySnapshot;
  groups: Array<{ category: string; products: PublicCatalogProduct[] }>;
  /** 起算日之后加入图册的新品；空数组时页面不排「新品」分区。 */
  newArrivals: PublicCatalogProduct[];
}

interface CardDetail {
  name: string;
  rows: Array<{ label: string; value: string }>;
  colors: string;
  plugs: string;
  /** 每个包装一组：名称单独成标签，明细行内盒 / 外箱+装箱数。 */
  packaging: PackagingDetailBlock[];
}

function cardDetail(product: CatalogProduct): CardDetail {
  return {
    name: product.name,
    rows: parseParameterRows(product.parameters),
    colors: product.colors.filter(Boolean).join(' / '),
    plugs: product.batteryPlugs.filter(Boolean).join(' / '),
    packaging: product.packaging.map((item) => packagingDetailBlock(item)),
  };
}

/** 封面描述语（固定营销文案）。 */
const COVER_TAGLINE = '500+款锂电工具，外贸跨境一站式解决。';

/** 封面：左 Logo / 中 公司名+一句描述 / 右 二维码，一条横带，尽量少占屏幕。 */
function renderCover(data: PublicCatalogPageData): string {
  const { company, catalog } = data;
  const token = catalog.token;
  const name = company.name.trim() || catalog.name;
  return `<header class="cover" id="top">
    ${company.logoRelativePath ? `<div class="cover-logo"><img src="/c/${token}/logo" alt=""></div>` : ''}
    <div class="cover-main">
      <h1>${escapeHtml(name)}</h1>
      <p>${escapeHtml(COVER_TAGLINE)}</p>
    </div>
    ${company.wechatQrRelativePath ? `<div class="cover-qr" title="点击放大二维码"><img src="/c/${token}/qr" alt="微信二维码"><span>扫码加微信</span><span class="cover-qr-zoom">点击放大</span></div>` : ''}
  </header>
  <div class="catalog-caption">${escapeHtml(catalog.name)}<span>点产品卡片看大图与详细参数</span></div>`;
}

/** 卡片底部的价格按钮：有报价显示「¥xx 起」，没报价显示「询价」；点开看全部配置。 */
function renderPriceButton(product: PublicCatalogProduct, showPrices: boolean): string {
  if (!showPrices) return '';
  if (!product.priceTable) {
    const data = escapeHtml(JSON.stringify({ name: product.name, inquiry: true }));
    return `<button class="card-price is-inquiry" type="button" data-price="${data}">询价</button>`;
  }
  const table = product.priceTable;
  const data = escapeHtml(JSON.stringify({
    name: product.name,
    voltage: table.voltage,
    capacities: table.capacities,
    columns: table.columns,
    prices: table.prices,
    barePrice: table.barePrice,
    minPrice: table.minPrice,
  }));
  return `<button class="card-price" type="button" data-price="${data}" title="查看全部配置价格"><strong>¥${table.minPrice} 起</strong></button>`;
}

/** 加购按钮：不打开大图，只把产品放进购物车。没有价格按钮时占满整行。 */
function renderAddButton(product: PublicCatalogProduct, showPrices: boolean): string {
  return `<button class="card-add${showPrices ? '' : ' is-solo'}" type="button" data-add="${product.id}" aria-label="将 ${escapeHtml(product.name)} 加入购物车" title="加入购物车"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg><span>加购</span></button>`;
}

function renderCard(product: PublicCatalogProduct, token: string, isNew = false, showPrices = false): string {
  const image = `/c/${token}/img/${product.id}`;
  const detail = escapeHtml(JSON.stringify(cardDetail(product)));
  // 卡片只展示名称、SKU、价格与加购按钮；全部参数、颜色插脚与包装都在点开的大图层里看。
  return `<article class="card" data-product-id="${product.id}" data-large="${image}?size=960" data-detail="${detail}" data-search="${escapeHtml(`${product.name} ${product.sku ?? ''}`.toLowerCase())}" title="点开看大图与详细参数">
    ${isNew ? '<span class="card-badge">新品</span>' : ''}
    <div class="card-image">
      <img src="${image}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async">
    </div>
    <h3>${escapeHtml(product.name)}</h3>
    ${product.sku ? `<div class="card-sku">${escapeHtml(product.sku)}</div>` : ''}
    <div class="card-actions">${renderPriceButton(product, showPrices)}${renderAddButton(product, showPrices)}</div>
  </article>`;
}

export function renderPublicCatalogPage(data: PublicCatalogPageData): string {
  const token = data.catalog.token;
  const { groups, newArrivals } = data;
  const newIds = new Set(newArrivals.map((product) => product.id));
  // 图册毛利率为 0 = 这本图册不报价：不渲染价格按钮，已有链接保持原样。
  const showPrices = Number(data.catalog.markupPercent) > 0;
  const categoryOptions = [
    newArrivals.length ? '<option value="new-arrivals">新品</option>' : '',
    ...groups.map((group, index) => `<option value="cat-${index}">${escapeHtml(group.category)}（${group.products.length}）</option>`),
  ].join('');
  const newSection = newArrivals.length ? `<section class="cat" id="new-arrivals">
    <h2>新品<span>${newArrivals.length} 款</span></h2>
    <div class="grid">${newArrivals.map((product) => renderCard(product, token, true, showPrices)).join('')}</div>
  </section>` : '';
  const sections = groups.map((group, index) => `<section class="cat" id="cat-${index}">
    <h2>${escapeHtml(group.category)}<span>${group.products.length} 款</span></h2>
    <div class="grid">${group.products.map((product) => renderCard(product, token, newIds.has(product.id), showPrices)).join('')}</div>
  </section>`).join('');
  const footerName = data.company.name.trim() || data.catalog.name;
  const footer = [escapeHtml(footerName), data.company.phone ? escapeHtml(data.company.phone.trim()) : ''].filter(Boolean).join(' · ');
  // 页尾备案号：公安备案通过后 30 日内须悬挂；号码未配置时不渲染。
  const filingsHtml = beianFooterItems(SITE_FILINGS).map((item) => item.href
    ? `<a href="${escapeHtml(item.href)}" target="_blank" rel="noreferrer">${escapeHtml(item.text)}</a>`
    : `<span>${escapeHtml(item.text)}</span>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(data.catalog.name)}${data.company.name.trim() ? ` · ${escapeHtml(data.company.name.trim())}` : ''}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f6f7; color: #15181c; font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; -webkit-text-size-adjust: 100%; }
  .wrap { max-width: 1080px; margin: 0 auto; background: #fff; min-height: 100vh; padding-bottom: 84px; padding-bottom: calc(84px + env(safe-area-inset-bottom, 0px)); }
  /* 封面横带：左 Logo / 中 公司名+描述语 / 右 二维码，尽量少占屏 */
  .cover { display: flex; align-items: center; gap: 12px; padding: 12px 14px 10px; }
  .cover-logo { width: 52px; height: 52px; flex: none; display: grid; place-items: center; overflow: hidden; }
  .cover-logo img { width: 100%; height: 100%; object-fit: contain; }
  .cover-main { flex: 1; min-width: 0; }
  .cover-main h1 { margin: 0; font-size: 18px; letter-spacing: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cover-main p { margin: 3px 0 0; font-size: 12px; color: #3d434a; overflow-wrap: anywhere; }
  .cover-qr { flex: none; display: grid; justify-items: center; gap: 3px; cursor: zoom-in; }
  .cover-qr img { width: 54px; height: 54px; object-fit: contain; border: 1px solid #e3e6ea; border-radius: 6px; }
  .cover-qr span { font-size: 10px; color: #8b929a; }
  .cover-qr .cover-qr-zoom { color: #2f6f6a; font-weight: 600; }
  .catalog-caption { padding: 0 16px 10px; font-size: 12px; color: #2f6f6a; font-weight: 600; letter-spacing: 1px; }
  .catalog-caption span { margin-left: 10px; color: #8b929a; font-weight: 400; letter-spacing: 0; }
  /* 分类导航：吸顶横滑；新品排第一 */
  .cat-nav { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 8px; padding: 9px 16px; background: rgba(255,255,255,.96); border-bottom: 1px solid #e8ebee; backdrop-filter: blur(6px); }
  .cat-search { flex: 1; min-width: 0; border: 1px solid #dbe3ea; border-radius: 999px; padding: 7px 14px; font: inherit; font-size: 13px; background: #f7f9fa; }
  .cat-search:focus { outline: none; border-color: #2f6f6a; background: #fff; }
  .cat-select { flex: none; max-width: 46%; border: 1px solid #dbe3ea; border-radius: 999px; padding: 7px 10px; font: inherit; font-size: 13px; color: #3d434a; background: #f7f9fa; }
  .cat-clear { flex: none; width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid #dbe3ea; border-radius: 50%; background: #fff; color: #61676e; font-size: 18px; line-height: 1; cursor: pointer; }
  .search-empty { padding: 36px 16px; text-align: center; color: #8b929a; font-size: 13px; }
  [hidden] { display: none !important; }
  .cat { padding: 16px 16px 4px; }
  .cat h2 { margin: 0 0 12px; font-size: 17px; }
  .cat h2 span { margin-left: 8px; font-size: 12px; color: #8b929a; font-weight: 400; }
  #new-arrivals h2 { color: #0f766e; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .card { position: relative; border: 1px solid #e3e6ea; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; background: #fff; cursor: zoom-in; }
  .card-badge { position: absolute; top: 16px; left: 16px; z-index: 2; padding: 2px 8px; border-radius: 999px; background: #0f766e; color: #fff; font-size: 11px; font-weight: 600; letter-spacing: 1px; box-shadow: 0 1px 4px rgba(15,23,42,.18); }
  .card-image { background: #f7f9fa; border-radius: 8px; aspect-ratio: 1 / 1; overflow: hidden; }
  .card-image img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .card h3 { margin: 4px 0 0; font-size: 14px; line-height: 1.35; }
  .card-sku { font-size: 12px; color: #2f6f6a; font-weight: 600; }
  /* 卡片底部：价格按钮 + 加购按钮并排；没有价格按钮时加购占满整行。 */
  .card-actions { display: flex; align-items: stretch; gap: 6px; margin-top: auto; }
  .card-price { display: flex; flex: 1; min-width: 0; align-items: center; justify-content: center; gap: 6px; border: 1px solid #0f766e; border-radius: 999px; padding: 6px 8px; background: #f0fdfa; color: #0f766e; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
  .card-price strong { font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .card-price:active { opacity: .85; }
  .card-price.is-inquiry { border-color: #dbe3ea; background: #f7f9fa; color: #3d434a; font-weight: 500; }
  .card-add { flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 3px; border: 1px solid #0f766e; border-radius: 999px; padding: 6px 9px; background: #0f766e; color: #fff; font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .card-add svg { width: 13px; height: 13px; }
  .card-add:active { opacity: .86; }
  .card-add.is-solo { flex: 1; }
  .card-add.is-added { background: #ecfdf5; color: #0f766e; }
  /* 价格弹层：容量 × 节数矩阵，只显示最终售价；窄屏内部横向滚动。 */
  .pricebox { position: fixed; inset: 0; z-index: 21; display: none; place-items: center; padding: 14px; background: rgba(10,14,18,.72); }
  .pricebox.is-open { display: grid; }
  .pricebox-panel { width: min(100%, 900px); max-height: min(88vh, 780px); display: flex; flex-direction: column; overflow: hidden; border-radius: 12px; background: #fff; }
  .pricebox-head { display: flex; align-items: flex-start; gap: 10px; padding: 14px 16px 10px; border-bottom: 1px solid #eef0f2; }
  .pricebox-head h3 { margin: 0; font-size: 16px; line-height: 1.35; }
  .pricebox-head p { margin: 4px 0 0; font-size: 12px; color: #8b929a; }
  .pricebox-close { flex: none; margin-left: auto; width: 34px; height: 34px; border: 0; border-radius: 50%; background: #f2f5f6; color: #3d434a; font-size: 20px; line-height: 1; cursor: pointer; }
  .pricebox-scroll { overflow: auto; padding: 8px 0; }
  .pricebox-bare { display: flex; align-items: baseline; gap: 8px; padding: 9px 16px; border-bottom: 1px solid #eef0f2; background: #f7fafb; color: #3d434a; font-size: 12px; }
  .pricebox-bare span { font-weight: 600; }
  .pricebox-bare strong { color: #0f766e; font-size: 18px; font-variant-numeric: tabular-nums; }
  .pricebox-bare em { color: #8b929a; font-style: normal; font-size: 11px; }
  .pricebox-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .pricebox-table th, .pricebox-table td { padding: 7px 10px; border-bottom: 1px solid #eef0f2; text-align: center; white-space: nowrap; }
  .pricebox-table thead th { background: #f7fafb; color: #3d434a; font-weight: 600; }
  .pricebox-table th.pricebox-group-start,
  .pricebox-table td.pricebox-group-start { border-left: 1px solid #99f6e4; }
  .pricebox-table .pricebox-corner,
  .pricebox-table .pricebox-capacity { position: sticky; left: 0; box-shadow: 1px 0 0 #e8ebee; text-align: left; }
  .pricebox-table .pricebox-corner { z-index: 3; background: #f7fafb; }
  .pricebox-table .pricebox-capacity { z-index: 1; background: #fff; color: #15181c; font-weight: 600; }
  .pricebox-table tbody tr:last-child th, .pricebox-table tbody tr:last-child td { border-bottom: 0; }
  .pricebox-table td { color: #0f766e; font-variant-numeric: tabular-nums; }
  .pricebox-table td.is-empty { color: #b3b9bf; }
  .pricebox-note { margin: 0; padding: 10px 16px 14px; border-top: 1px solid #eef0f2; color: #8b929a; font-size: 11.5px; line-height: 1.5; }
  .pricebox-empty { padding: 32px 16px; text-align: center; color: #8b929a; font-size: 13px; }
  .empty { padding: 48px 16px; text-align: center; color: #8b929a; }
  /* 底部固定条：新品角标（.card-badge）是带 z-index 的定位元素，滚动经过时会浮在普通流上方——
     底栏必须显式抬到更高层级才能压住它们；不透明底色保证任何内容不透出。安全区 + .wrap 底部留白，页尾不遮内容。
     层级：角标 2 < 吸顶导航 5 < 底栏 10 < 大图层 20 < 二维码放大 30。 */
  .page-foot { position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 14px; padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)); background: #fff; border-top: 1px solid #e8ebee; font-size: 12.5px; color: #61676e; }
  .page-foot span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .page-foot-btn { flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 7px 16px; border-radius: 999px; background: #0f766e; color: #fff; font-size: 12.5px; font-weight: 600; text-decoration: none; box-shadow: 0 2px 8px rgba(15,118,110,.35); }
  .page-foot-btn:active { opacity: .88; }
  /* 购物车：底部悬浮入口 + 右侧抽屉（手机为底部面板），不需要登录。 */
  .cart-nav { flex: none; display: inline-flex; align-items: center; gap: 5px; height: 34px; padding: 0 10px; border: 1px solid #0f766e; border-radius: 999px; background: #0f766e; color: #fff; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .cart-nav svg { width: 15px; height: 15px; }
  .cart-nav b { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: #fff; color: #0f766e; font-size: 10.5px; font-variant-numeric: tabular-nums; }
  .cart-nav.is-empty b { background: rgba(255,255,255,.22); color: #fff; }
  .cart-backdrop { position: fixed; inset: 0; z-index: 25; background: rgba(10,14,18,.48); }
  .cart-panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 26; display: flex; flex-direction: column; width: min(92vw, 430px); background: #fff; box-shadow: -8px 0 30px rgba(15,23,42,.18); }
  .cart-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 14px 16px 12px; border-bottom: 1px solid #eef0f2; }
  .cart-head strong { color: #111827; font-size: 15px; }
  .cart-head span { display: block; margin-top: 2px; color: #8b929a; font-size: 10.5px; }
  .cart-head-actions { display: flex; align-items: center; gap: 5px; }
  .cart-clear { border: 0; background: transparent; color: #8b929a; font: inherit; font-size: 11px; cursor: pointer; padding: 4px; }
  .cart-close { width: 32px; height: 32px; border: 0; border-radius: 50%; background: #f2f5f6; color: #3d434a; font-size: 20px; line-height: 1; cursor: pointer; }
  .cart-list { flex: 1; overflow-y: auto; padding: 4px 16px; display: grid; align-content: start; gap: 2px; }
  .cart-item { display: grid; gap: 7px; padding: 11px 0; border-bottom: 1px solid #eef0f2; }
  .cart-item-main { display: grid; gap: 1px; min-width: 0; }
  .cart-item-main strong { color: #111827; font-size: 13px; line-height: 1.4; }
  .cart-item-main span { color: #8b929a; font-size: 10.5px; line-height: 1.4; }
  .cart-item-note { width: 100%; height: 30px; border: 1px solid #dbe3ea; border-radius: 6px; padding: 0 8px; color: #15181c; background: #fff; font: inherit; font-size: 11.5px; }
  .cart-item-note::placeholder { color: #a6adb5; }
  .cart-item-note:focus { outline: none; border-color: #0f766e; box-shadow: 0 0 0 2px rgba(15,118,110,.1); }
  .cart-item-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .cart-qty { display: inline-flex; align-items: center; overflow: hidden; border: 1px solid #dbe3ea; border-radius: 8px; background: #fff; }
  .cart-qty button { width: 30px; height: 30px; border: 0; background: #f7f9fa; color: #3d434a; font-size: 16px; line-height: 1; cursor: pointer; }
  .cart-qty input { width: 44px; height: 30px; border: 0; text-align: center; color: #15181c; font: inherit; font-size: 12.5px; -moz-appearance: textfield; }
  .cart-qty input::-webkit-outer-spin-button, .cart-qty input::-webkit-inner-spin-button { margin: 0; -webkit-appearance: none; }
  .cart-line { text-align: right; min-width: 0; }
  .cart-line small { display: block; color: #8b929a; font-size: 10px; white-space: nowrap; }
  .cart-line strong { color: #0f766e; font-size: 13px; font-variant-numeric: tabular-nums; }
  .cart-remove { border: 0; background: transparent; color: #b45309; font: inherit; font-size: 11px; cursor: pointer; padding: 2px; }
  .cart-empty { padding: 52px 24px; color: #8b929a; font-size: 12.5px; line-height: 1.8; text-align: center; }
  .cart-foot { display: grid; gap: 8px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid #e8ebee; background: #fff; }
  .cart-total { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 10px; }
  .cart-total span { color: #61676e; font-size: 12px; }
  .cart-total strong { color: #0f766e; font-size: 21px; font-variant-numeric: tabular-nums; }
  .cart-total small { flex-basis: 100%; color: #8b929a; font-size: 10px; line-height: 1.45; }
  .cart-export { height: 42px; border: 0; border-radius: 10px; background: #0f766e; color: #fff; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
  .cart-export[disabled] { background: #e5e7eb; color: #9aa1a8; cursor: not-allowed; }
  .cart-toast { position: fixed; right: 14px; bottom: calc(112px + env(safe-area-inset-bottom, 0px)); z-index: 13; padding: 8px 14px; border-radius: 999px; background: rgba(17,24,39,.9); color: #fff; font-size: 12px; }
  @media (max-width: 719px) {
    .cart-nav { padding: 0 8px; }
    .cart-nav span { display: none; }
    .cart-panel { top: auto; left: 0; right: 0; width: 100%; max-height: 82vh; border-radius: 14px 14px 0 0; }
  }
  /* 页尾备案号行：公安备案号通过后 30 日内须悬挂；小字居中，压在固定底栏上方的留白里。 */
  .site-filings { display: flex; justify-content: center; flex-wrap: wrap; gap: 4px 14px; padding: 6px 16px 12px; font-size: 11px; color: #9aa1a8; }
  .site-filings a { color: inherit; text-decoration: none; }
  /* 点开：大图 + 全部参数 */
  .lightbox { position: fixed; inset: 0; z-index: 20; display: none; background: rgba(10,14,18,.88); padding: 16px; }
  .lightbox.is-open { display: block; }
  .lightbox-panel { height: 100%; display: flex; flex-direction: column; gap: 10px; align-items: center; overflow: auto; }
  /* 宽度用 100%（面板内容宽）而不是 96vw：96vw 没算 .lightbox 的左右内边距，会右边溢出、看着不居中。 */
  .lightbox-image { max-width: min(100%, 760px); max-height: 46vh; object-fit: contain; background: #fff; border-radius: 8px; }
  .lightbox-info { width: min(100%, 760px); background: #fff; border-radius: 10px; padding: 12px 14px; display: grid; gap: 8px; }
  .lightbox-info h3 { margin: 0; font-size: 15px; }
  .lightbox-info table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .lightbox-info tr + tr { border-top: 1px solid #f0f2f4; }
  .lightbox-info th { width: 40%; text-align: left; font-weight: 400; color: #8b929a; font-size: 12px; padding: 4px 8px 4px 0; vertical-align: top; }
  .lightbox-info td { font-size: 12px; padding: 4px 0; vertical-align: top; word-break: break-word; line-height: 1.5; }
  .lightbox-meta { display: grid; gap: 3px; font-size: 12px; color: #3d434a; }
  .lightbox-meta span { color: #8b929a; margin-right: 6px; }
  .lightbox-pack { border-top: 1px dashed #e3e6ea; padding-top: 7px; font-size: 11px; color: #61676e; display: grid; gap: 8px; }
  .lightbox-pack-label { color: #8b929a; font-size: 11px; }
  /* 同一包装的几行贴在一起，不同包装之间留 8px，避免糊成一片。 */
  .lightbox-pack-group { display: grid; gap: 2px; }
  /* 包装名称用浅绿标签托底，和后面的明细文字区分开。 */
  .lightbox-pack-name { display: inline-block; padding: 0 7px; margin-right: 6px; border-radius: 4px; background: #e7f3f1; color: #0f766e; font-weight: 600; }
  /* 每条包装占一行、整行不折行（字号收紧到 11px 让装箱数完整放下）；特别长时该行可横向滑动。 */
  .lightbox-pack-line { white-space: nowrap; overflow-x: auto; scrollbar-width: thin; }
  .lightbox-close { position: fixed; top: 12px; right: 12px; width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(255,255,255,.18); color: #fff; font-size: 22px; line-height: 1; cursor: pointer; }
  /* 二维码放大层：手机不方便扫 54px 的小图，点开后放到接近全屏宽 */
  .qr-zoom { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; align-content: center; gap: 14px; background: rgba(10,14,18,.92); padding: 24px; cursor: zoom-out; }
  .qr-zoom img { width: min(78vw, 420px); background: #fff; padding: 12px; border-radius: 12px; }
  .qr-zoom span { color: #fff; font-size: 13px; letter-spacing: 1px; opacity: .85; }
  @media (min-width: 720px) {
    .grid { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }
    .cover { padding: 18px 20px 12px; }
    .cover-logo { width: 64px; height: 64px; }
    .cover-main h1 { font-size: 20px; }
    .lightbox-panel { flex-direction: row; justify-content: center; align-items: flex-start; }
    .lightbox-image { max-width: 52vw; max-height: 82vh; flex: none; }
    .lightbox-info { width: 360px; flex: none; }
  }
</style></head>
<body><div class="wrap">
${renderCover(data)}
${groups.length || newArrivals.length ? `<nav class="cat-nav" aria-label="产品分类">
    <input class="cat-search" id="cat-search" type="search" placeholder="搜索产品名称 / SKU" aria-label="搜索产品" autocomplete="off">
    <select class="cat-select" id="cat-select" aria-label="按类目筛选"><option value="">全部类目</option>${categoryOptions}</select>
    <button class="cat-clear" id="cat-clear" type="button" aria-label="清空类目筛选" title="显示全部产品" hidden>×</button>
    <button class="cart-nav is-empty" id="cart-open" type="button" aria-label="打开购物车"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg><span>购物车</span><b id="cart-count">0</b></button>
  </nav>
  <div class="search-empty" id="search-empty" hidden>没有匹配的产品</div>
  ${newSection}${sections}` : '<div class="empty">图册正在整理中，请稍后再来。</div>'}
${filingsHtml ? `<div class="site-filings">${filingsHtml}</div>` : ''}
<footer class="page-foot"><span>${footer}</span><a class="page-foot-btn" href="#top">↑ 回顶部</a></footer>
</div>
<div class="lightbox" id="lightbox">
  <div class="lightbox-panel">
    <img class="lightbox-image" alt="">
    <div class="lightbox-info">
      <h3></h3>
      <table></table>
      <div class="lightbox-meta"></div>
      <div class="lightbox-pack"></div>
    </div>
  </div>
  <button class="lightbox-close" type="button" aria-label="关闭">×</button>
</div>
<div class="pricebox" id="pricebox">
  <div class="pricebox-panel">
    <div class="pricebox-head">
      <div>
        <h3 id="pricebox-title"></h3>
        <p id="pricebox-sub"></p>
      </div>
      <button class="pricebox-close" type="button" aria-label="关闭价格">×</button>
    </div>
    <div class="pricebox-bare" id="pricebox-bare"></div>
    <div class="pricebox-scroll" id="pricebox-scroll"></div>
    <p class="pricebox-note">套装价含整机、包装与一个充电器；裸机价不含电池与充电器；均不含税费与运费。</p>
  </div>
</div>
<div class="cart-backdrop" id="cart-backdrop" hidden></div>
<aside class="cart-panel" id="cart-panel" hidden aria-label="购物车">
  <div class="cart-head">
    <div><strong>购物车</strong><span>无需登录，填好数量后可直接导出 PDF</span></div>
    <div class="cart-head-actions"><button class="cart-clear" id="cart-clear" type="button" hidden>清空</button><button class="cart-close" id="cart-close" type="button" aria-label="关闭购物车">×</button></div>
  </div>
  <div class="cart-list" id="cart-list"></div>
  <div class="cart-empty" id="cart-empty">购物车还是空的。<br>点产品卡片下方的「加购」开始选品。</div>
  <div class="cart-foot">
    <div class="cart-total"><span id="cart-total-label">合计</span><strong id="cart-total">¥0.00</strong><small id="cart-note-hint">单价为图册最低配置起价，不含税费与运费</small></div>
    <button class="cart-export" id="cart-export" type="button" disabled>导出 PDF</button>
  </div>
</aside>
<div class="cart-toast" id="cart-toast" hidden></div>
${data.company.wechatQrRelativePath ? `<div class="qr-zoom" id="qr-zoom" hidden><img src="/c/${data.catalog.token}/qr" alt="微信二维码"><span>扫码加微信 · 点击任意处关闭</span></div>` : ''}
<script>
  (function () {
    // 公司名只占一行：超宽自动缩字号（下限 11px、同时去掉字距）；极端超长时才用省略号收尾。
    var coverName = document.querySelector('.cover-main h1');
    function fitCoverName() {
      if (!coverName) return;
      coverName.style.fontSize = '';
      coverName.style.letterSpacing = '0';
      var size = parseFloat(getComputedStyle(coverName).fontSize) || 18;
      while (coverName.scrollWidth > coverName.clientWidth + 1 && size > 11) {
        size -= 0.5;
        coverName.style.fontSize = size + 'px';
      }
    }
    fitCoverName();
    window.addEventListener('resize', fitCoverName);

    // 搜索（名称/SKU）+ 类目筛选：选中类目只显示该类产品，小叉清掉恢复全部。
    var searchInput = document.getElementById('cat-search');
    var searchEmpty = document.getElementById('search-empty');
    var catSelect = document.getElementById('cat-select');
    var catClear = document.getElementById('cat-clear');
    var activeCategory = '';
    function applyFilters() {
      var needle = (searchInput.value || '').trim().toLowerCase();
      var anyVisible = false;
      Array.prototype.forEach.call(document.querySelectorAll('.cat'), function (section) {
        var categoryMatch = !activeCategory || section.id === activeCategory;
        var visible = 0;
        Array.prototype.forEach.call(section.querySelectorAll('.card'), function (card) {
          var match = categoryMatch && (!needle || (card.getAttribute('data-search') || '').indexOf(needle) !== -1);
          card.hidden = !match;
          if (match) visible += 1;
        });
        section.hidden = visible === 0;
        if (visible > 0) anyVisible = true;
      });
      searchEmpty.hidden = anyVisible || (!needle && !activeCategory);
      catClear.hidden = !activeCategory;
    }
    searchInput.addEventListener('input', applyFilters);
    catSelect.addEventListener('change', function (event) {
      activeCategory = event.target.value;
      applyFilters();
      if (activeCategory) {
        var target = document.getElementById(activeCategory);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    catClear.addEventListener('click', function () {
      activeCategory = '';
      catSelect.value = '';
      applyFilters();
    });

    // 购物车：本机保存，不登录；数量在购物车里填，导出时服务端再按 token 校验一遍。
    var cartToken = ${JSON.stringify(data.catalog.token)};
    var CART_KEY = 'catalog-cart:' + cartToken;
    var cartById = {};
    Array.prototype.forEach.call(document.querySelectorAll('.card[data-product-id]'), function (card) {
      cartById[card.getAttribute('data-product-id')] = card;
    });
    var cart = [];
    try {
      var storedCart = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      if (Array.isArray(storedCart)) {
        var normalized = {};
        storedCart.forEach(function (item) {
          var id = item && item.id != null ? String(item.id) : '';
          var qty = item && Number(item.qty);
          if (!cartById[id] || !Number.isInteger(qty) || qty <= 0) return;
          var note = item && typeof item.note === 'string' ? item.note.trim().slice(0, 120) : '';
          if (!normalized[id]) normalized[id] = { qty: 0, note: '' };
          normalized[id].qty = Math.min(9999, normalized[id].qty + qty);
          if (note && !normalized[id].note) normalized[id].note = note;
        });
        Object.keys(normalized).forEach(function (id) { cart.push({ id: id, qty: normalized[id].qty, note: normalized[id].note }); });
      }
    } catch (error) { cart = []; }

    var cartList = document.getElementById('cart-list');
    var cartEmpty = document.getElementById('cart-empty');
    var cartClear = document.getElementById('cart-clear');
    var cartCount = document.getElementById('cart-count');
    var cartFab = document.getElementById('cart-open');
    var cartPanel = document.getElementById('cart-panel');
    var cartBackdrop = document.getElementById('cart-backdrop');
    var cartTotal = document.getElementById('cart-total');
    var cartTotalLabel = document.getElementById('cart-total-label');
    var cartNoteHint = document.getElementById('cart-note-hint');
    var cartExport = document.getElementById('cart-export');
    var cartToast = document.getElementById('cart-toast');
    var cartToastTimer;

    function money(cents) { return '¥' + (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function encodeNote(text) {
      var bytes = new TextEncoder().encode(text);
      var binary = '';
      for (var index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
      return btoa(binary).split('+').join('-').split('/').join('_').replace(/=+$/, '');
    }
    function cartQty() { return cart.reduce(function (sum, item) { return sum + item.qty; }, 0); }
    function updateCartBadge() {
      var qty = cartQty();
      cartCount.textContent = String(qty);
      cartFab.classList.toggle('is-empty', qty === 0);
      cartFab.setAttribute('aria-label', '打开购物车，已选 ' + qty + ' 件');
    }
    function saveCart() {
      try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (error) { /* 本机存储不可用不影响本次选购 */ }
      updateCartBadge();
    }
    function productInfo(id) {
      var card = cartById[String(id)];
      if (!card) return null;
      var detail = {};
      try { detail = JSON.parse(card.getAttribute('data-detail') || '{}'); } catch (error) { detail = {}; }
      var price = null;
      var priceTrigger = card.querySelector('.card-price');
      if (priceTrigger) {
        try {
          var priceData = JSON.parse(priceTrigger.getAttribute('data-price') || '{}');
          if (typeof priceData.minPrice === 'number') price = priceData.minPrice;
        } catch (error) { price = null; }
      }
      var skuNode = card.querySelector('.card-sku');
      var nameNode = card.querySelector('h3');
      var spec = (detail.rows || []).slice(0, 2).map(function (row) { return row.label ? row.label + '：' + row.value : row.value; }).filter(Boolean).join(' · ');
      return { id: String(id), name: detail.name || (nameNode ? nameNode.textContent : ''), sku: skuNode ? skuNode.textContent.trim() : '', spec: spec, price: price };
    }
    function toast(message) {
      cartToast.textContent = message;
      cartToast.hidden = false;
      clearTimeout(cartToastTimer);
      cartToastTimer = setTimeout(function () { cartToast.hidden = true; }, 1500);
    }
    function addToCart(id) {
      if (!cartById[String(id)]) return;
      var item = cart.find(function (entry) { return entry.id === String(id); });
      if (item) item.qty = Math.min(9999, item.qty + 1);
      else cart.push({ id: String(id), qty: 1, note: '' });
      saveCart();
      if (!cartPanel.hidden) renderCart();
      toast('已加入购物车');
      var button = document.querySelector('.card-add[data-add="' + id + '"]');
      if (button) {
        button.classList.add('is-added');
        setTimeout(function () { button.classList.remove('is-added'); }, 700);
      }
    }
    function renderCart() {
      cartList.textContent = '';
      var totalCents = 0;
      var inquiryQty = 0;
      cart.forEach(function (item) {
        var info = productInfo(item.id);
        if (!info) return;
        var row = document.createElement('div');
        row.className = 'cart-item';
        var main = document.createElement('div');
        main.className = 'cart-item-main';
        var name = document.createElement('strong');
        name.textContent = info.name;
        main.appendChild(name);
        var metaText = [info.sku, info.spec].filter(Boolean).join(' · ');
        if (metaText) {
          var meta = document.createElement('span');
          meta.textContent = metaText;
          main.appendChild(meta);
        }
        row.appendChild(main);

        var line = document.createElement('div');
        line.className = 'cart-item-row';
        var qtyBox = document.createElement('div');
        qtyBox.className = 'cart-qty';
        qtyBox.setAttribute('data-id', item.id);
        var dec = document.createElement('button'); dec.type = 'button'; dec.textContent = '−'; dec.setAttribute('data-cart-action', 'dec'); dec.setAttribute('data-id', item.id); dec.setAttribute('aria-label', '减少数量');
        var input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = '9999'; input.inputMode = 'numeric'; input.value = String(item.qty); input.setAttribute('aria-label', info.name + ' 数量');
        var inc = document.createElement('button'); inc.type = 'button'; inc.textContent = '+'; inc.setAttribute('data-cart-action', 'inc'); inc.setAttribute('data-id', item.id); inc.setAttribute('aria-label', '增加数量');
        qtyBox.appendChild(dec); qtyBox.appendChild(input); qtyBox.appendChild(inc);
        line.appendChild(qtyBox);
        var priceBox = document.createElement('div');
        priceBox.className = 'cart-line';
        var small = document.createElement('small');
        var strong = document.createElement('strong');
        if (info.price == null) {
          small.textContent = '询价';
          strong.textContent = '—';
          inquiryQty += item.qty;
        } else {
          small.textContent = '¥' + info.price.toLocaleString('zh-CN') + ' 起 × ' + item.qty;
          strong.textContent = '¥' + (info.price * item.qty).toLocaleString('zh-CN');
          totalCents += info.price * 100 * item.qty;
        }
        priceBox.appendChild(small); priceBox.appendChild(strong);
        line.appendChild(priceBox);
        row.appendChild(line);

        var noteInput = document.createElement('input');
        noteInput.type = 'text';
        noteInput.className = 'cart-item-note';
        noteInput.maxLength = 120;
        noteInput.value = item.note || '';
        noteInput.placeholder = '备注（选填，显示在 PDF 该行）';
        noteInput.setAttribute('data-id', item.id);
        noteInput.setAttribute('aria-label', info.name + ' 备注');
        row.appendChild(noteInput);

        var actions = document.createElement('div');
        actions.className = 'cart-item-row';
        actions.style.justifyContent = 'flex-end';
        var remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'cart-remove'; remove.textContent = '移除'; remove.setAttribute('data-cart-action', 'remove'); remove.setAttribute('data-id', item.id);
        actions.appendChild(remove);
        row.appendChild(actions);
        cartList.appendChild(row);
      });
      cartEmpty.hidden = cart.length > 0;
      cartClear.hidden = cart.length === 0;
      cartTotal.textContent = money(totalCents);
      cartTotalLabel.textContent = inquiryQty ? '已计价合计' : '合计';
      cartNoteHint.textContent = inquiryQty
        ? '含 ' + inquiryQty + ' 件询价产品未计入合计；单价为最低配置起价，不含税费与运费'
        : '单价为图册最低配置起价，不含税费与运费';
      cartExport.disabled = cart.length === 0;
      updateCartBadge();
    }
    function removeFromCart(id) {
      cart = cart.filter(function (item) { return item.id !== String(id); });
      saveCart();
      renderCart();
    }
    function changeQty(id, next) {
      var item = cart.find(function (entry) { return entry.id === String(id); });
      if (!item) return;
      item.qty = Math.max(1, Math.min(9999, Math.floor(next)));
      saveCart();
      renderCart();
    }
    function openCart() {
      renderCart();
      cartPanel.hidden = false;
      cartBackdrop.hidden = false;
      document.body.style.overflow = 'hidden';
    }
    function closeCart() {
      cartPanel.hidden = true;
      cartBackdrop.hidden = true;
      document.body.style.overflow = '';
    }
    cartFab.addEventListener('click', openCart);
    document.getElementById('cart-close').addEventListener('click', closeCart);
    cartBackdrop.addEventListener('click', closeCart);
    cartClear.addEventListener('click', function () {
      if (!cart.length || !window.confirm('清空购物车？')) return;
      cart = [];
      saveCart();
      renderCart();
    });
    cartList.addEventListener('click', function (event) {
      var control = event.target.closest('[data-cart-action]');
      if (!control) return;
      var id = control.getAttribute('data-id');
      var action = control.getAttribute('data-cart-action');
      if (action === 'remove') { removeFromCart(id); return; }
      var item = cart.find(function (entry) { return entry.id === id; });
      if (!item) return;
      if (action === 'dec') { if (item.qty <= 1) removeFromCart(id); else changeQty(id, item.qty - 1); return; }
      if (action === 'inc') changeQty(id, item.qty + 1);
    });
    cartList.addEventListener('change', function (event) {
      if (!event.target.matches('.cart-qty input')) return;
      var box = event.target.closest('.cart-qty');
      if (!box) return;
      var value = Number(event.target.value);
      if (!Number.isFinite(value) || value <= 0) { renderCart(); return; }
      changeQty(box.getAttribute('data-id'), value);
    });
    cartList.addEventListener('input', function (event) {
      if (!event.target.matches('.cart-item-note')) return;
      var item = cart.find(function (entry) { return entry.id === event.target.getAttribute('data-id'); });
      if (!item) return;
      item.note = event.target.value.slice(0, 120);
      saveCart();
    });
    cartExport.addEventListener('click', function () {
      if (!cart.length) return;
      var query = cart.map(function (item) {
        var part = item.id + ':' + item.qty;
        var note = (item.note || '').trim();
        if (note) part += ':' + encodeNote(note);
        return part;
      }).join(',');
      var url = '/c/' + encodeURIComponent(cartToken) + '/quote.pdf?items=' + query;
      cartExport.textContent = '正在生成…';
      cartExport.disabled = true;
      var link = document.createElement('a');
      link.href = url;
      link.rel = 'noopener';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { cartExport.textContent = '导出 PDF'; cartExport.disabled = cart.length === 0; }, 2000);
    });
    updateCartBadge();

    var box = document.getElementById('lightbox');
    var panel = box.querySelector('.lightbox-panel');
    var image = box.querySelector('.lightbox-image');
    var title = box.querySelector('h3');
    var table = box.querySelector('table');
    var meta = box.querySelector('.lightbox-meta');
    var pack = box.querySelector('.lightbox-pack');

    function row(label, value) {
      var tr = document.createElement('tr');
      if (label) {
        var th = document.createElement('th'); th.textContent = label; tr.appendChild(th);
      }
      var td = document.createElement('td');
      if (!label) td.colSpan = 2;
      td.textContent = value;
      tr.appendChild(td);
      return tr;
    }
    function metaLine(label, value) {
      var div = document.createElement('div');
      var span = document.createElement('span'); span.textContent = label;
      div.appendChild(span);
      div.appendChild(document.createTextNode(value));
      return div;
    }
    function open(trigger) {
      var detail = {};
      try { detail = JSON.parse(trigger.getAttribute('data-detail') || '{}'); } catch (error) { detail = {}; }
      image.src = trigger.getAttribute('data-large');
      title.textContent = detail.name || '';
      table.textContent = '';
      (detail.rows || []).forEach(function (item) { table.appendChild(row(item.label, item.value)); });
      meta.textContent = '';
      if (detail.colors) meta.appendChild(metaLine('颜色', detail.colors));
      if (detail.plugs) meta.appendChild(metaLine('插脚', detail.plugs));
      pack.textContent = '';
      var packaging = detail.packaging || [];
      if (packaging.length) {
        var packLabel = document.createElement('div');
        packLabel.className = 'lightbox-pack-label';
        packLabel.textContent = '包装';
        pack.appendChild(packLabel);
      }
      packaging.forEach(function (group) {
        var wrap = document.createElement('div');
        wrap.className = 'lightbox-pack-group';
        var lines = group.lines.length ? group.lines : [''];
        lines.forEach(function (line, index) {
          var div = document.createElement('div');
          div.className = 'lightbox-pack-line';
          if (index === 0) {
            var chip = document.createElement('span');
            chip.className = 'lightbox-pack-name';
            chip.textContent = group.name;
            div.appendChild(chip);
          }
          if (line) div.appendChild(document.createTextNode(line));
          wrap.appendChild(div);
        });
        pack.appendChild(wrap);
      });
      box.classList.add('is-open');
    }
    function close() { box.classList.remove('is-open'); image.removeAttribute('src'); }

    // 价格弹层：卡片按钮点开后按容量 × 节数（一电一充/两电一充）列出全部售价。
    var priceBox = document.getElementById('pricebox');
    var priceTitle = document.getElementById('pricebox-title');
    var priceSub = document.getElementById('pricebox-sub');
    var priceScroll = document.getElementById('pricebox-scroll');
    var priceBare = document.getElementById('pricebox-bare');
    function openPrice(trigger) {
      var data = {};
      try { data = JSON.parse(trigger.getAttribute('data-price') || '{}'); } catch (error) { data = {}; }
      priceTitle.textContent = data.name || '';
      priceSub.textContent = '';
      priceScroll.textContent = '';
      priceBare.textContent = '';
      if (data.inquiry) {
        var inquiry = document.createElement('div');
        inquiry.className = 'pricebox-empty';
        inquiry.textContent = '该产品暂未配置报价，请联系我们。';
        priceScroll.appendChild(inquiry);
      } else {
        // 裸机价固定在上方，不随表格横向滚动。
        var bareLabel = document.createElement('span');
        bareLabel.textContent = '裸机价';
        var bareValue = document.createElement('strong');
        bareValue.textContent = '¥' + data.barePrice;
        var bareHint = document.createElement('em');
        bareHint.textContent = '不含电池与充电器';
        priceBare.appendChild(bareLabel);
        priceBare.appendChild(bareValue);
        priceBare.appendChild(bareHint);

        var columns = data.columns || [];
        if (!columns.length) {
          priceSub.textContent = (data.voltage || '') + ' 电池 · 暂无电池配置报价';
          var noBattery = document.createElement('div');
          noBattery.className = 'pricebox-empty';
          noBattery.textContent = '该电压暂时没有电池配置报价，请联系我们。';
          priceScroll.appendChild(noBattery);
        } else {
          priceSub.textContent = (data.voltage || '') + ' 电池 · 一电一充 / 两电一充';
          var table = document.createElement('table');
          table.className = 'pricebox-table';
          var thead = document.createElement('thead');
          var groups = [];
          var groupStart = {};
          var columnOffset = 0;
          columns.forEach(function (column) {
            var last = groups[groups.length - 1];
            if (last && last.packCount === column.packCount) {
              last.columns.push(column);
            } else {
              groupStart[columnOffset] = true;
              groups.push({ packCount: column.packCount, columns: [column] });
            }
            columnOffset += 1;
          });
          var headGroup = document.createElement('tr');
          var corner = document.createElement('th');
          corner.rowSpan = 2;
          corner.className = 'pricebox-corner';
          corner.textContent = '单节电芯容量';
          headGroup.appendChild(corner);
          groups.forEach(function (group) {
            var th = document.createElement('th');
            th.colSpan = group.columns.length;
            th.className = 'pricebox-group-start';
            th.textContent = group.packCount + ' 节';
            headGroup.appendChild(th);
          });
          var headVariant = document.createElement('tr');
          columns.forEach(function (column, colIndex) {
            var th = document.createElement('th');
            if (groupStart[colIndex]) th.className = 'pricebox-group-start';
            th.textContent = column.label;
            headVariant.appendChild(th);
          });
          thead.appendChild(headGroup);
          thead.appendChild(headVariant);
          table.appendChild(thead);
          var tbody = document.createElement('tbody');
          (data.capacities || []).forEach(function (capacity, rowIndex) {
            var tr = document.createElement('tr');
            var th = document.createElement('th');
            th.className = 'pricebox-capacity';
            th.textContent = capacity + ' mAh';
            tr.appendChild(th);
            columns.forEach(function (_column, colIndex) {
              var td = document.createElement('td');
              var price = data.prices && data.prices[rowIndex] ? data.prices[rowIndex][colIndex] : null;
              var classes = [];
              if (groupStart[colIndex]) classes.push('pricebox-group-start');
              if (price == null) { td.textContent = '—'; classes.push('is-empty'); }
              else td.textContent = '¥' + price;
              if (classes.length) td.className = classes.join(' ');
              tr.appendChild(td);
            });
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          priceScroll.appendChild(table);
        }
      }
      priceBox.classList.add('is-open');
    }
    function closePrice() { priceBox.classList.remove('is-open'); }

    // 二维码点击放大：手机不方便直接扫 54px 的小图，点开接近全屏宽。
    var qrZoom = document.getElementById('qr-zoom');
    var coverQr = document.querySelector('.cover-qr');
    if (qrZoom && coverQr) {
      coverQr.addEventListener('click', function () { qrZoom.hidden = false; });
      qrZoom.addEventListener('click', function () { qrZoom.hidden = true; });
    }

    document.addEventListener('click', function (event) {
      var addTrigger = event.target.closest('.card-add');
      if (addTrigger) { event.preventDefault(); addToCart(addTrigger.getAttribute('data-add')); return; }
      var priceTrigger = event.target.closest('.card-price');
      if (priceTrigger) { event.preventDefault(); openPrice(priceTrigger); return; }
      var trigger = event.target.closest('[data-detail]');
      if (trigger) { open(trigger); return; }
      if (event.target === priceBox || event.target.closest('.pricebox-close')) { closePrice(); return; }
      if (event.target === box || event.target === panel || event.target.closest('.lightbox-close')) close();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      close();
      closePrice();
      if (qrZoom) qrZoom.hidden = true;
      if (!cartPanel.hidden) closeCart();
    });
  })();
</script>
</body></html>`;
}

/** 非法/停用链接的兜底页（仍是友好的一页，而不是裸 404 文本）。 */
export function renderCatalogUnavailablePage(): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>图册不可用</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f7;color:#61676e;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}div{text-align:center;display:grid;gap:8px}h1{font-size:18px;margin:0;color:#15181c}p{margin:0;font-size:13px}</style></head><body><div><h1>这个图册链接不可用</h1><p>可能已停用或地址不完整，请向发你链接的人确认。</p></div></body></html>`;
}
