import { escapeHtml } from './quotation-template.js';
import { parseParameterRows, packagingDetailBlock, type CatalogProduct, type PackagingDetailBlock } from './product-catalog-template.js';
import type { CompanySnapshot } from '../../shared/documents.js';

/**
 * 在线图册（客户打开的样子）：独立轻量页，不加载工作台登录包。
 * 客户版口径与 PDF 完全一致：只有品名/SKU/参数/颜色插脚/包装，供应商与价格根本不出现在这份 HTML 里。
 */
export interface PublicCatalogPageData {
  catalog: { name: string; token: string };
  company: CompanySnapshot;
  groups: Array<{ category: string; products: CatalogProduct[] }>;
  /** 起算日之后加入图册的新品；空数组时页面不排「新品」分区。 */
  newArrivals: CatalogProduct[];
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

function renderCard(product: CatalogProduct, token: string, isNew = false): string {
  const image = `/c/${token}/img/${product.id}`;
  const detail = escapeHtml(JSON.stringify(cardDetail(product)));
  // 卡片只展示名称与 SKU；全部参数、颜色插脚与包装都在点开的大图层里看。
  return `<article class="card" data-large="${image}?size=960" data-detail="${detail}" data-search="${escapeHtml(`${product.name} ${product.sku ?? ''}`.toLowerCase())}" title="点开看大图与详细参数">
    ${isNew ? '<span class="card-badge">新品</span>' : ''}
    <div class="card-image">
      <img src="${image}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async">
    </div>
    <h3>${escapeHtml(product.name)}</h3>
    ${product.sku ? `<div class="card-sku">${escapeHtml(product.sku)}</div>` : ''}
  </article>`;
}

export function renderPublicCatalogPage(data: PublicCatalogPageData): string {
  const token = data.catalog.token;
  const { groups, newArrivals } = data;
  const newIds = new Set(newArrivals.map((product) => product.id));
  const categoryOptions = [
    newArrivals.length ? '<option value="new-arrivals">新品</option>' : '',
    ...groups.map((group, index) => `<option value="cat-${index}">${escapeHtml(group.category)}（${group.products.length}）</option>`),
  ].join('');
  const newSection = newArrivals.length ? `<section class="cat" id="new-arrivals">
    <h2>新品<span>${newArrivals.length} 款</span></h2>
    <div class="grid">${newArrivals.map((product) => renderCard(product, token, true)).join('')}</div>
  </section>` : '';
  const sections = groups.map((group, index) => `<section class="cat" id="cat-${index}">
    <h2>${escapeHtml(group.category)}<span>${group.products.length} 款</span></h2>
    <div class="grid">${group.products.map((product) => renderCard(product, token, newIds.has(product.id))).join('')}</div>
  </section>`).join('');
  const footerName = data.company.name.trim() || data.catalog.name;
  const footer = [escapeHtml(footerName), data.company.phone ? escapeHtml(data.company.phone.trim()) : ''].filter(Boolean).join(' · ');

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
  .cat-nav { position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; padding: 9px 16px; background: rgba(255,255,255,.96); border-bottom: 1px solid #e8ebee; backdrop-filter: blur(6px); }
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
  .empty { padding: 48px 16px; text-align: center; color: #8b929a; }
  /* 底部固定条：新品角标（.card-badge）是带 z-index 的定位元素，滚动经过时会浮在普通流上方——
     底栏必须显式抬到更高层级才能压住它们；不透明底色保证任何内容不透出。安全区 + .wrap 底部留白，页尾不遮内容。
     层级：角标 2 < 吸顶导航 5 < 底栏 10 < 大图层 20 < 二维码放大 30。 */
  .page-foot { position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 14px; padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)); background: #fff; border-top: 1px solid #e8ebee; font-size: 12.5px; color: #61676e; }
  .page-foot span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .page-foot-btn { flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 7px 16px; border-radius: 999px; background: #0f766e; color: #fff; font-size: 12.5px; font-weight: 600; text-decoration: none; box-shadow: 0 2px 8px rgba(15,118,110,.35); }
  .page-foot-btn:active { opacity: .88; }
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
  </nav>
  <div class="search-empty" id="search-empty" hidden>没有匹配的产品</div>
  ${newSection}${sections}` : '<div class="empty">图册正在整理中，请稍后再来。</div>'}
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

    // 二维码点击放大：手机不方便直接扫 54px 的小图，点开接近全屏宽。
    var qrZoom = document.getElementById('qr-zoom');
    var coverQr = document.querySelector('.cover-qr');
    if (qrZoom && coverQr) {
      coverQr.addEventListener('click', function () { qrZoom.hidden = false; });
      qrZoom.addEventListener('click', function () { qrZoom.hidden = true; });
    }

    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('[data-detail]');
      if (trigger) { open(trigger); return; }
      if (event.target === box || event.target === panel || event.target.closest('.lightbox-close')) close();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      close();
      if (qrZoom) qrZoom.hidden = true;
    });
  })();
</script>
</body></html>`;
}

/** 非法/停用链接的兜底页（仍是友好的一页，而不是裸 404 文本）。 */
export function renderCatalogUnavailablePage(): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>图册不可用</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f7;color:#61676e;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}div{text-align:center;display:grid;gap:8px}h1{font-size:18px;margin:0;color:#15181c}p{margin:0;font-size:13px}</style></head><body><div><h1>这个图册链接不可用</h1><p>可能已停用或地址不完整，请向发你链接的人确认。</p></div></body></html>`;
}
