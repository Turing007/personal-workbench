import { escapeHtml } from './quotation-template.js';
import { DEFAULT_PRODUCT_IMAGE_CATEGORY } from '../../shared/product-image-categories.js';
import type { CatalogDensity } from '../../shared/product-catalog.js';

export type { CatalogDensity };

/** 图册只排客户要看的东西：包装尺寸与装箱数排进来，供应商与价格一律排除。 */
export interface CatalogProduct {
  id: number;
  name: string;
  sku: string;
  category?: string;
  parameters: string;
  colors: string[];
  batteryPlugs: string[];
  packaging: Array<{
    name?: string;
    innerSize?: string;
    innerWeight?: number;
    outerSize?: string;
    outerWeight?: number;
    packCount?: number;
  }>;
  /** 已经按图库排序的产品图，图册自己挑主图。 */
  images: Array<{ relativePath: string; category?: string }>;
}

interface ParameterRow {
  label: string;
  value: string;
}

interface CatalogCell {
  product: CatalogProduct;
  rows: ParameterRow[];
  /** 被容量截掉的参数项数，>0 时在格尾标注，避免静默丢数据。 */
  hiddenRowCount: number;
  packagingLines: string[];
  hiddenPackagingCount: number;
  colorText: string;
  plugText: string;
}

const LABEL_MAX_LENGTH = 12;
/** 包装区固定占格底两行，多余折叠成计数：它不参与格子高度计算，否则整本会被撑散。 */
const MAX_PACKAGING_LINES = 2;

/**
 * 每页固定 rows 行 × 2 列，格子等高。实测主图 98% 是 1:1 方图，
 * 定宽的方格刚好放满图区；参数超过 lineBudget 行的产品截断并标注（在售库里最多 10 行，标准档不截）。
 */
const DENSITY_CONFIG: Record<CatalogDensity, { rows: number; lineBudget: number; media: string; thumb: 480 | 960 }> = {
  comfortable: { rows: 2, lineBudget: 16, media: '48mm', thumb: 960 },
  standard: { rows: 3, lineBudget: 11, media: '38mm', thumb: 480 },
  compact: { rows: 4, lineBudget: 7, media: '27mm', thumb: 480 },
};

/**
 * 参数文本转两列表格。库里的参数是自由文本，实测三种写法并存：
 * 带冒号（335/385 行）、名称紧跟数字（`额定电压21v`）、以及缩进的续行（`32mm（45°）`）。
 * 拆不动的行并入上一项，绝不硬猜字段名。
 */
export function parseParameterRows(text: string): ParameterRow[] {
  const rows: ParameterRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const colon = line.search(/[：:]/);
    if (colon > 0 && colon <= LABEL_MAX_LENGTH) {
      rows.push({ label: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
      continue;
    }
    const split = line.match(/^([^\d]{2,12}?)(\d.*)$/);
    if (split) {
      rows.push({ label: split[1].trim(), value: split[2].trim() });
      continue;
    }
    const previous = rows.at(-1);
    if (previous) previous.value = `${previous.value} ${line}`.trim();
    else rows.push({ label: '', value: line });
  }
  return rows;
}

/** 主图优先取排序最前的精修图；没有精修图才回落到图库第一张。 */
export function pickCatalogImage(product: CatalogProduct): string | undefined {
  const refined = product.images.find((image) => (image.category ?? DEFAULT_PRODUCT_IMAGE_CATEGORY) === DEFAULT_PRODUCT_IMAGE_CATEGORY);
  return (refined ?? product.images[0])?.relativePath;
}

export function packagingLine(item: CatalogProduct['packaging'][number]): string {
  const name = item.name?.trim() || '包装';
  const inner = [item.innerSize?.trim(), item.innerWeight ? `${item.innerWeight}kg` : ''].filter(Boolean).join(' ');
  const outer = [item.outerSize?.trim(), item.outerWeight ? `${item.outerWeight}kg` : ''].filter(Boolean).join(' ');
  const parts = [name];
  if (inner) parts.push(`内盒 ${inner}`);
  if (outer) parts.push(`外箱 ${outer}`);
  if (item.packCount) parts.push(`装箱 ${item.packCount}`);
  return parts.join('｜');
}

function toCell(product: CatalogProduct, density: CatalogDensity): CatalogCell {
  const { lineBudget } = DENSITY_CONFIG[density];
  const allRows = parseParameterRows(product.parameters);
  const packagingLines = product.packaging.slice(0, MAX_PACKAGING_LINES).map(packagingLine);
  const kept = allRows.slice(0, lineBudget);
  return {
    product,
    rows: kept,
    hiddenRowCount: allRows.length - kept.length,
    packagingLines,
    hiddenPackagingCount: Math.max(0, product.packaging.length - packagingLines.length),
    colorText: product.colors.filter(Boolean).join(' / '),
    plugText: product.batteryPlugs.filter(Boolean).join(' / '),
  };
}

export interface CatalogPage {
  cells: CatalogCell[];
}

/**
 * 每页固定 rows 行 × 2 列，按阅读顺序左右交替填格，排满换页。
 * 格子等高（由 CSS 网格决定），所以一页正好 4 / 6 / 8 个产品，不会因内容多寡把版面排散。
 */
export function packCatalogPages(products: CatalogProduct[], density: CatalogDensity): CatalogPage[] {
  const perPage = DENSITY_CONFIG[density].rows * 2;
  const pages: CatalogPage[] = [];
  for (let offset = 0; offset < products.length; offset += perPage) {
    pages.push({
      cells: products.slice(offset, offset + perPage).map((product) => toCell(product, density)),
    });
  }
  return pages;
}

function renderCell(cell: CatalogCell, imageDataUrl: string | undefined): string {
  const { product } = cell;
  const name = product.name || product.sku || '未命名产品';
  const packaging = [...cell.packagingLines.map((line) => `<div>${escapeHtml(line)}</div>`),
    ...(cell.hiddenPackagingCount > 0 ? [`<div class="is-muted">…另有 ${cell.hiddenPackagingCount} 种包装</div>`] : [])].join('');
  const meta = [
    cell.colorText ? `<div><span>颜色</span>${escapeHtml(cell.colorText)}</div>` : '',
    cell.plugText ? `<div><span>插脚</span>${escapeHtml(cell.plugText)}</div>` : '',
  ].join('');

  return `<div class="cell">
    <div class="cell-name">${escapeHtml(name)}</div>
    ${product.sku ? `<div class="cell-sku">${escapeHtml(product.sku)}</div>` : ''}
    <div class="cell-body">
      <div class="cell-media">${imageDataUrl
        ? `<img src="${escapeHtml(imageDataUrl)}" alt="${escapeHtml(name)}">`
        : '<span class="cell-media-empty">图待补</span>'}</div>
      <div class="cell-info">${cell.rows.length || cell.hiddenRowCount
        ? `<table>${cell.rows.map((row) => row.label
          ? `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`
          : `<tr class="is-full"><td colspan="2">${escapeHtml(row.value)}</td></tr>`).join('')}${cell.hiddenRowCount
          ? `<tr class="is-muted"><td colspan="2">…另有 ${cell.hiddenRowCount} 项参数</td></tr>`
          : ''}</table>`
        : '<div class="is-muted">参数整理中</div>'}
      </div>
    </div>
    ${meta ? `<div class="cell-meta">${meta}</div>` : ''}
    ${packaging ? `<div class="cell-pack">${packaging}</div>` : ''}
  </div>`;
}

function renderPage(
  page: CatalogPage,
  options: { imageDataUrls: Map<number, string | undefined>; group: string; index: number; total: number; density: CatalogDensity },
): string {
  const { imageDataUrls, group, index, total, density } = options;
  const { rows, media } = DENSITY_CONFIG[density];
  const cells = page.cells.map((cell) => renderCell(cell, imageDataUrls.get(cell.product.id))).join('');
  return `<section class="page" style="--rows:${rows};--media:${media}">
    <header class="page-head"><span>${escapeHtml(group)}</span><span>${CATALOG_HEADING} · ${new Date().getFullYear()}</span></header>
    <div class="catalog-grid">${cells}</div>
    <footer class="page-foot"><span>第 ${index + 1} / ${total} 页</span></footer>
  </section>`;
}

export interface CatalogRenderOptions {
  density: CatalogDensity;
  /** productId -> 内联 data URL；无图的缺项允许为 undefined。 */
  imageDataUrls: Map<number, string | undefined>;
  /** 封面（公司信息）：给了就排一页封面；封面不计入页码。 */
  cover?: CatalogCover;
}

/** 图册封面：缺哪项都不排空标签，全空时由调用方直接不传 cover。 */
export interface CatalogCover {
  companyName: string;
  phone: string;
  address: string;
  logoDataUrl?: string;
  qrDataUrl?: string;
}

const CATALOG_HEADING = '产品图册';

function renderCover(cover: CatalogCover): string {
  const contactLines = [
    cover.phone ? `<div class="cover-line"><span>电话</span>${escapeHtml(cover.phone)}</div>` : '',
    cover.address ? `<div class="cover-line"><span>地址</span>${escapeHtml(cover.address)}</div>` : '',
  ].join('');
  return `<section class="page cover">
    <div class="cover-head">
      ${cover.logoDataUrl ? `<img class="cover-logo" src="${escapeHtml(cover.logoDataUrl)}" alt="">` : ''}
      ${cover.companyName ? `<h1 class="cover-name">${escapeHtml(cover.companyName)}</h1>` : ''}
    </div>
    <div class="cover-divider"></div>
    ${contactLines ? `<div class="cover-contact">${contactLines}</div>` : ''}
    ${cover.qrDataUrl ? `<div class="cover-qr"><img src="${escapeHtml(cover.qrDataUrl)}" alt="微信二维码"><div class="cover-qr-hint">扫码加微信</div></div>` : ''}
    <div class="cover-foot">${CATALOG_HEADING} · ${new Date().getFullYear()}</div>
  </section>`;
}

export function renderProductCatalogHtml(products: CatalogProduct[], options: CatalogRenderOptions): string {
  const { density, imageDataUrls, cover } = options;
  // 跨分类导出时按分类分节，每节重新起页，客户翻起来像一本目录。
  const groups = new Map<string, CatalogProduct[]>();
  for (const product of products) {
    const key = product.category?.trim() || '未分类';
    const list = groups.get(key);
    if (list) list.push(product);
    else groups.set(key, [product]);
  }

  const renderedGroups = [...groups.entries()].map(([group, list]) => ({ group, pages: packCatalogPages(list, density) }));
  const totalPages = renderedGroups.reduce((sum, item) => sum + item.pages.length, 0);
  let index = 0;
  const body = renderedGroups.map((entry) => entry.pages.map((sheet) => {
    index += 1;
    return renderPage(sheet, { imageDataUrls, group: entry.group, index: index - 1, total: totalPages, density });
  }).join('')).join('');
  // 封面排在最前；页码口径不受影响（产品页仍从「第 1 / N 页」起算）。
  const coverHtml = cover ? renderCover(cover) : '';

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>${CATALOG_HEADING}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #15181c; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; }
  .page { break-after: page; height: 268mm; display: flex; flex-direction: column; }
  .page:last-child { break-after: auto; }
  /* 封面：居中经典款。封面自身不计页码（页码只交给产品页）。 */
  .cover { align-items: center; text-align: center; padding-top: 42mm; }
  .cover-logo { max-width: 70mm; max-height: 30mm; object-fit: contain; }
  .cover-name { margin: 12mm 0 0; font-size: 26pt; font-weight: 700; letter-spacing: 2pt; }
  .cover-divider { width: 88mm; border-top: 0.6pt solid #1f2933; margin: 14mm 0 10mm; }
  .cover-contact { display: grid; gap: 4mm; font-size: 11pt; color: #2b3138; }
  .cover-line span { color: #8b929a; margin-right: 3mm; }
  .cover-qr { margin-top: 18mm; display: grid; justify-items: center; gap: 2.5mm; }
  .cover-qr img { width: 30mm; height: 30mm; object-fit: contain; }
  .cover-qr-hint { font-size: 9pt; color: #8b929a; letter-spacing: 1pt; }
  .cover-foot { margin-top: auto; padding-bottom: 4mm; font-size: 10pt; color: #61676e; letter-spacing: 1.5pt; }
  .page-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 0.5pt solid #1f2933; padding-bottom: 1.6mm; }
  .page-head span:first-child { font-size: 12pt; font-weight: 700; letter-spacing: 0.4pt; }
  .page-head span:last-child { font-size: 7.5pt; color: #6b7280; }
  .page-foot { border-top: 0.4pt solid #d7dbe0; margin-top: 2mm; padding-top: 1.4mm; text-align: right; font-size: 7pt; color: #8b929a; }
  .catalog-grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(var(--rows), 1fr); gap: 3mm 4mm; padding-top: 3mm; min-height: 0; }
  .cell { display: flex; flex-direction: column; min-height: 0; overflow: hidden; border: 0.4pt solid #e3e6ea; border-radius: 1.5mm; padding: 2mm 2.2mm; }
  .cell-name { font-size: 8.4pt; font-weight: 700; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .cell-sku { font-size: 6.8pt; color: #2f6f6a; font-weight: 600; letter-spacing: 0.2pt; margin-bottom: 1.2mm; }
  .cell-body { flex: 1; display: flex; align-items: center; gap: 2.4mm; min-height: 0; }
  .cell-media { width: var(--media); height: var(--media); flex: none; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .cell-media img { width: 100%; height: 100%; object-fit: contain; }
  .cell-media-empty { font-size: 7pt; color: #a8aeb6; }
  .cell-info { flex: 1; min-width: 0; }
  .cell-info table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .cell-info tr + tr { border-top: 0.3pt solid #eef0f2; }
  .cell-info th { width: 40%; text-align: left; font-weight: 500; color: #61676e; font-size: 6.9pt; padding: 0.5mm 1mm 0.5mm 0; vertical-align: top; }
  .cell-info td { font-size: 6.9pt; color: #15181c; padding: 0.5mm 0; vertical-align: top; word-break: break-word; line-height: 1.35; }
  .cell-info tr.is-full th { display: none; }
  .is-muted { color: #a8aeb6; font-size: 6.8pt; }
  .cell-meta { display: flex; flex-wrap: wrap; gap: 0.4mm 4mm; font-size: 6.8pt; color: #3d434a; margin-top: 1.4mm; }
  .cell-meta span { color: #8b929a; margin-right: 1mm; }
  .cell-pack { margin-top: auto; padding-top: 1.2mm; border-top: 0.4pt dashed #dfe3e7; font-size: 6.6pt; line-height: 1.45; color: #4a5058; word-break: break-word; }
</style></head>
<body>${coverHtml}${body}</body></html>`;
}

export function catalogThumbnailSize(density: CatalogDensity): 480 | 960 {
  return DENSITY_CONFIG[density].thumb;
}
