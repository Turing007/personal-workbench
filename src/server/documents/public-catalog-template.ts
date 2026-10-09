import { escapeHtml } from './quotation-template.js';
import { parseParameterRows, packagingLine, type CatalogProduct } from './product-catalog-template.js';
import type { CompanySnapshot } from '../../shared/documents.js';

/**
 * 在线图册（客户打开的样子）：独立轻量页，不加载工作台登录包。
 * 客户版口径与 PDF 完全一致：只有品名/SKU/参数/颜色插脚/包装，供应商与价格根本不出现在这份 HTML 里。
 */
export interface PublicCatalogPageData {
  catalog: { name: string; token: string };
  company: CompanySnapshot;
  groups: Array<{ category: string; products: CatalogProduct[] }>;
}

function renderCover(data: PublicCatalogPageData): string {
  const { company, catalog } = data;
  const token = catalog.token;
  const name = company.name.trim() || catalog.name;
  const contact = [
    company.phone ? `<div><span>电话</span>${escapeHtml(company.phone)}</div>` : '',
    company.address ? `<div><span>地址</span>${escapeHtml(company.address)}</div>` : '',
  ].join('');
  return `<header class="cover" id="top">
    ${company.logoRelativePath ? `<img class="cover-logo" src="/c/${token}/logo" alt="">` : ''}
    <h1 class="cover-name">${escapeHtml(name)}</h1>
    ${contact ? `<div class="cover-contact">${contact}</div>` : ''}
    ${company.wechatQrRelativePath ? `<div class="cover-qr"><img src="/c/${token}/qr" alt="微信二维码"><span>扫码加微信</span></div>` : ''}
    <div class="cover-caption">${escapeHtml(catalog.name)}</div>
  </header>`;
}

function renderCard(product: CatalogProduct, token: string): string {
  const rows = parseParameterRows(product.parameters);
  const meta = [
    product.colors.filter(Boolean).length ? `<div><span>颜色</span>${escapeHtml(product.colors.filter(Boolean).join(' / '))}</div>` : '',
    product.batteryPlugs.filter(Boolean).length ? `<div><span>插脚</span>${escapeHtml(product.batteryPlugs.filter(Boolean).join(' / '))}</div>` : '',
  ].join('');
  const packaging = product.packaging.length
    ? `<div class="card-pack">${product.packaging.map((item) => `<div>${escapeHtml(packagingLine(item))}</div>`).join('')}</div>`
    : '';
  const image = `/c/${token}/img/${product.id}`;
  return `<article class="card">
    <button class="card-image" type="button" data-large="${image}?size=960" aria-label="查看大图">
      <img src="${image}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async">
    </button>
    <h3>${escapeHtml(product.name)}</h3>
    ${product.sku ? `<div class="card-sku">${escapeHtml(product.sku)}</div>` : ''}
    ${rows.length ? `<table>${rows.map((row) => row.label
      ? `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`
      : `<tr><td colspan="2">${escapeHtml(row.value)}</td></tr>`).join('')}</table>` : ''}
    ${meta ? `<div class="card-meta">${meta}</div>` : ''}
    ${packaging}
  </article>`;
}

export function renderPublicCatalogPage(data: PublicCatalogPageData): string {
  const token = data.catalog.token;
  const groups = data.groups;
  const nav = groups.map((group, index) => `<a href="#cat-${index}">${escapeHtml(group.category)}</a>`).join('');
  const sections = groups.map((group, index) => `<section class="cat" id="cat-${index}">
    <h2>${escapeHtml(group.category)}<span>${group.products.length} 款</span></h2>
    <div class="grid">${group.products.map((product) => renderCard(product, token)).join('')}</div>
  </section>`).join('');
  const footerName = data.company.name.trim() || data.catalog.name;
  const footer = [escapeHtml(footerName), data.company.phone ? escapeHtml(data.company.phone) : ''].filter(Boolean).join(' · ');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(data.catalog.name)}${data.company.name.trim() ? ` · ${escapeHtml(data.company.name.trim())}` : ''}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f6f7; color: #15181c; font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; -webkit-text-size-adjust: 100%; }
  .wrap { max-width: 1080px; margin: 0 auto; background: #fff; min-height: 100vh; padding-bottom: 64px; }
  /* 封面区：客户打开第一眼看到公司信息 */
  .cover { display: grid; justify-items: center; text-align: center; padding: 36px 20px 28px; gap: 14px; }
  .cover-logo { max-width: 180px; max-height: 72px; object-fit: contain; }
  .cover-name { margin: 0; font-size: 26px; letter-spacing: 2px; }
  .cover-contact { display: grid; gap: 6px; font-size: 14px; color: #3d434a; }
  .cover-contact span { color: #8b929a; margin-right: 8px; }
  .cover-qr { display: grid; justify-items: center; gap: 6px; margin-top: 6px; }
  .cover-qr img { width: 132px; height: 132px; object-fit: contain; border: 1px solid #e3e6ea; border-radius: 8px; }
  .cover-qr span { font-size: 12px; color: #8b929a; letter-spacing: 1px; }
  .cover-caption { margin-top: 4px; font-size: 13px; color: #2f6f6a; font-weight: 600; letter-spacing: 1px; }
  /* 分类导航：吸顶横滑 */
  .cat-nav { position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; overflow-x: auto; padding: 10px 16px; background: rgba(255,255,255,.96); border-bottom: 1px solid #e8ebee; backdrop-filter: blur(6px); }
  .cat-nav a { flex: none; padding: 6px 14px; border-radius: 999px; background: #f1f4f6; color: #3d434a; font-size: 13px; text-decoration: none; }
  .cat-nav a:active { background: #e2e8ea; }
  .cat { padding: 18px 16px 6px; }
  .cat h2 { margin: 0 0 12px; font-size: 17px; }
  .cat h2 span { margin-left: 8px; font-size: 12px; color: #8b929a; font-weight: 400; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .card { border: 1px solid #e3e6ea; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; background: #fff; }
  .card-image { padding: 0; border: 0; background: #f7f9fa; border-radius: 8px; cursor: zoom-in; aspect-ratio: 1 / 1; overflow: hidden; }
  .card-image img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .card h3 { margin: 4px 0 0; font-size: 14px; line-height: 1.35; }
  .card-sku { font-size: 12px; color: #2f6f6a; font-weight: 600; }
  .card table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .card tr + tr { border-top: 1px solid #f0f2f4; }
  .card th { width: 42%; text-align: left; font-weight: 400; color: #8b929a; font-size: 11.5px; padding: 3px 6px 3px 0; vertical-align: top; }
  .card td { font-size: 11.5px; padding: 3px 0; vertical-align: top; word-break: break-word; line-height: 1.45; }
  .card-meta { display: grid; gap: 2px; font-size: 11.5px; color: #3d434a; }
  .card-meta span { color: #8b929a; margin-right: 6px; }
  .card-pack { border-top: 1px dashed #e3e6ea; padding-top: 6px; font-size: 11px; color: #61676e; display: grid; gap: 2px; }
  .empty { padding: 48px 16px; text-align: center; color: #8b929a; }
  .page-foot { position: fixed; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; gap: 16px; padding: 10px 16px; background: rgba(255,255,255,.96); border-top: 1px solid #e8ebee; font-size: 12.5px; color: #61676e; backdrop-filter: blur(6px); }
  .page-foot a { color: #2f6f6a; text-decoration: none; }
  /* 点图看大图 */
  .lightbox { position: fixed; inset: 0; z-index: 20; display: none; align-items: center; justify-content: center; background: rgba(10,14,18,.88); padding: 20px; }
  .lightbox.is-open { display: flex; }
  .lightbox img { max-width: min(96vw, 900px); max-height: 88vh; object-fit: contain; background: #fff; border-radius: 6px; }
  .lightbox button { position: absolute; top: 14px; right: 14px; width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(255,255,255,.16); color: #fff; font-size: 22px; line-height: 1; cursor: pointer; }
  @media (min-width: 720px) {
    .grid { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }
    .cover { padding-top: 56px; }
  }
</style></head>
<body><div class="wrap">
${renderCover(data)}
${groups.length ? `<nav class="cat-nav" aria-label="产品分类">${nav}</nav>${sections}` : '<div class="empty">图册正在整理中，请稍后再来。</div>'}
<footer class="page-foot"><span>${footer}</span><a href="#top">回顶部</a></footer>
</div>
<div class="lightbox" id="lightbox"><img alt=""><button type="button" aria-label="关闭">×</button></div>
<script>
  (function () {
    var box = document.getElementById('lightbox');
    var img = box.querySelector('img');
    function close() { box.classList.remove('is-open'); img.removeAttribute('src'); }
    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('.card-image');
      if (trigger) { img.src = trigger.getAttribute('data-large'); box.classList.add('is-open'); return; }
      if (event.target === box || event.target.closest('.lightbox button')) close();
    });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); });
  })();
</script>
</body></html>`;
}

/** 非法/停用链接的兜底页（仍是友好的一页，而不是裸 404 文本）。 */
export function renderCatalogUnavailablePage(): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>图册不可用</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f7;color:#61676e;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}div{text-align:center;display:grid;gap:8px}h1{font-size:18px;margin:0;color:#15181c}p{margin:0;font-size:13px}</style></head><body><div><h1>这个图册链接不可用</h1><p>可能已停用或地址不完整，请向发你链接的人确认。</p></div></body></html>`;
}
