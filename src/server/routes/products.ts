import type { FastifyInstance, FastifyRequest } from 'fastify';
import { mapAttachment, mapProduct, mapVideo, toCatalogProduct } from '../services/product-record-mapper.js';
import * as XLSX from 'xlsx';
import sharp from 'sharp';
import type { DatabaseRepositories, PackagingInput, ProductImportInput, ProductInput } from '../db/repositories.js';
import { normalizeProductStatus } from '../../shared/product-status.js';
import { FileStore, FileStoreError } from '../files/file-store.js';
import {
  ApiError,
  asRecord,
  finiteNumber,
  mapDatabaseError,
  optionalText,
  parseId,
  positiveInteger,
  requiredText,
  sendFailure,
  sendSuccess,
} from './api-response.js';
import { contractFileOptions, imageFileOptions, videoFileOptions } from './multipart-limits.js';
import { PdfRenderer } from '../documents/pdf-renderer.js';
import { ThumbnailService, isResizableImage } from '../files/thumbnail-service.js';
import {
  catalogThumbnailSize,
  pickCatalogImage,
  renderProductCatalogHtml,
  type CatalogCover,
  type CatalogProduct,
} from '../documents/product-catalog-template.js';
import type { SettingsRepository } from '../db/settings-repository.js';
import type { CatalogRepository } from '../db/catalog-repository.js';
import {
  DEFAULT_PRODUCT_IMAGE_CATEGORY,
  MAX_PRODUCT_IMAGE_NOTE_LENGTH,
  isProductImageCategory,
  type ProductImageCategory,
} from '../../shared/product-image-categories.js';
import { DEFAULT_CATALOG_DENSITY, isCatalogDensity } from '../../shared/product-catalog.js';

const DEFAULT_COLORS = ['蓝', '红', '黄'];
const DEFAULT_BATTERY_PLUGS = ['牧田', '德伟', '米沃奇'];
/** 缩略图分批处理的并发数：整本图册一次内联所有主图，分批读避免峰值内存过高。 */
const CATALOG_IMAGE_CONCURRENCY = 6;
const PRODUCT_ATTACHMENT_CATEGORIES = new Set(['manual', 'packaging-design', 'label-dieline', 'other']);

/** 删除文件前限定目录白名单，防止数据库路径被篡改后越权删除存储目录外的文件。 */
function assertDeletableImagePath(relativePath: string, expectedDirectory: string): void {
  const normalized = relativePath.replaceAll('\\', '/');
  if (!normalized.startsWith(`${expectedDirectory}/`)) {
    throw new ApiError(400, 'INVALID_FILE_PATH', '附件路径不安全');
  }
}

interface ProductRouteOptions {
  repositories: DatabaseRepositories;
  fileStore?: FileStore;
  pdfRenderer?: Pick<PdfRenderer, 'render'>;
  thumbnailService?: ThumbnailService;
  /** 图册封面要读公司资料（名称/电话/地址/Logo/微信二维码）。 */
  settingsRepository?: SettingsRepository;
  /** 编辑器「添加到产品图册」：保存产品后把 id 追加进所选图册。 */
  catalogRepository?: CatalogRepository;
}

/**
 * 「保存时添加到产品图册」：目标图册由编辑器的图册下拉给出（addToCatalogId）。
 * 只负责加入、不负责移出；已在册不重复加；图册不存在时忽略。
 * 顺带加入失败不让保存报错——产品已经入库，报错会引导用户重试并产生重复产品。
 */
function appendProductToCatalog(catalogRepository: CatalogRepository | undefined, body: unknown, productId: number): void {
  if (!catalogRepository || !Number.isSafeInteger(productId) || productId <= 0) return;
  const catalogId = Number((body as { addToCatalogId?: unknown } | null | undefined)?.addToCatalogId);
  if (!Number.isSafeInteger(catalogId) || catalogId <= 0) return;
  if (!catalogRepository.get(catalogId)) return;
  try {
    const productIds = catalogRepository.listItemProductIds(catalogId);
    if (productIds.includes(productId)) return;
    catalogRepository.update(catalogId, { productIds: [...productIds, productId] });
  } catch {
    // 尽力而为：产品保存是主目的，图册可从选品编辑补加。
  }
}

/** 小图转 data URL（图册封面用）：Logo 与二维码都按最长边缩放，避免把大图塞进 PDF。 */
async function imageFileToDataUrl(fileStore: FileStore | undefined, relativePath: string | null | undefined, maxEdge: number): Promise<string | undefined> {
  if (!fileStore || !relativePath) return undefined;
  try {
    const buffer = await fileStore.readFile(relativePath);
    const jpeg = await sharp(buffer)
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    // 读不出就当作没传：封面缺这一项照常排。
    return undefined;
  }
}

interface ImageParams {
  id: string;
  imageId: string;
}

interface PackagingImageParams extends ImageParams {
  packagingId: string;
}

function parsePackaging(value: unknown): PackagingInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', '至少需要一行包装方式', 'packaging');
  }

  return value.map((rawItem, index) => {
    const item = asRecord(rawItem);
    const prefix = `packaging[${index}]`;
    return {
      name: optionalText(item.name, `${prefix}.name`, '包装名称'),
      id: item.id == null || item.id === '' ? undefined : parseId(String(item.id), `${prefix}.id`),
      imageIds: Array.isArray(item.imageIds) ? item.imageIds.map((value) => parseId(String(value), `${prefix}.imageIds`)) : undefined,
      innerSize: optionalText(item.innerSize, `${prefix}.innerSize`, '内盒尺寸'),
      innerWeight: finiteNumber(item.innerWeight, `${prefix}.innerWeight`, '内盒重量'),
      outerSize: optionalText(item.outerSize, `${prefix}.outerSize`, '外箱尺寸'),
      outerLength: finiteNumber(item.outerLength, `${prefix}.outerLength`, '外箱长度'),
      outerWidth: finiteNumber(item.outerWidth, `${prefix}.outerWidth`, '外箱宽度'),
      outerHeight: finiteNumber(item.outerHeight, `${prefix}.outerHeight`, '外箱高度'),
      outerWeight: finiteNumber(item.outerWeight, `${prefix}.outerWeight`, '外箱重量'),
      packCount: positiveInteger(item.packCount, `${prefix}.packCount`, '装箱数'),
      purchasePrice: item.purchasePrice === undefined || item.purchasePrice === null || item.purchasePrice === ''
        ? null
        : finiteNumber(item.purchasePrice, `${prefix}.purchasePrice`, '包装采购价'),
    };
  });
}

const PRODUCT_HEADERS = ['产品标识（必填）', 'SKU', '产品名称（必填）', '参数', '分类', '产品默认采购价', '供应商', '颜色（多个用、分隔）', '电池插脚（多个用、分隔）', '配件', '备注', '产品图片路径'];
const PACKAGING_HEADERS = ['产品标识（必填）', 'SKU', '包装名称（必填）', '内盒尺寸', '内盒重量(kg)', '外箱尺寸', '外箱重量(kg)', '装箱数（必填）', '包装采购价'];

type ExcelRow = Record<string, unknown>;

function excelText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function excelNumber(value: unknown, field: string, rowIndex: number, options: { required?: boolean; integer?: boolean } = {}): number | undefined {
  const text = excelText(value);
  if (!text) {
    if (options.required) throw new ApiError(400, 'EXCEL_VALIDATION_ERROR', `第 ${rowIndex} 行的${field}不能为空`, field);
    return undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || (options.integer && !Number.isInteger(number)) || (options.integer && number <= 0) || (!options.integer && number < 0)) {
    throw new ApiError(400, 'EXCEL_VALIDATION_ERROR', `第 ${rowIndex} 行的${field}格式不正确`, field);
  }
  return number;
}

function excelList(value: unknown): string[] | undefined {
  const text = excelText(value);
  return text ? [...new Set(text.split(/[、,，;；\n]/).map((item) => item.trim()).filter(Boolean))] : undefined;
}

function sheetRows(workbook: XLSX.WorkBook, sheetName: string, headers: string[], required = true): ExcelRow[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    if (required) throw new ApiError(400, 'EXCEL_FORMAT_ERROR', `Excel 文件缺少“${sheetName}”工作表`, sheetName);
    return [];
  }
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(sheet, { defval: '', raw: true });
  const actualHeaders = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true })[0] ?? [];
  const missing = headers.filter((header) => !actualHeaders.map((item) => excelText(item)).includes(header));
  if (missing.length) throw new ApiError(400, 'EXCEL_FORMAT_ERROR', `“${sheetName}”缺少列：${missing.join('、')}`, sheetName);
  return rows;
}

function parseExcelImport(buffer: Buffer): ProductImportInput[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch {
    throw new ApiError(400, 'EXCEL_FORMAT_ERROR', '无法读取 Excel 文件，请使用产品库模板');
  }

  const productRows = sheetRows(workbook, '产品', PRODUCT_HEADERS);
  const packagingRows = sheetRows(workbook, '包装', PACKAGING_HEADERS);
  if (!productRows.length) throw new ApiError(400, 'EXCEL_VALIDATION_ERROR', '“产品”工作表至少需要一行产品');

  const products = new Map<string, ProductImportInput>();
  productRows.forEach((row, index) => {
    const rowIndex = index + 2;
    const key = excelText(row['产品标识（必填）']);
    if (!key) throw new ApiError(400, 'EXCEL_VALIDATION_ERROR', `“产品”工作表第 ${rowIndex} 行缺少产品标识`, '产品标识');
    if (products.has(key)) throw new ApiError(400, 'DUPLICATE_PRODUCT_KEY', `产品标识重复：${key}`, '产品标识');
    const sourceSku = excelText(row.SKU);
    const input: ProductInput = {
      name: excelText(row['产品名称（必填）']),
      sku: sourceSku,
      specification: '',
      parameters: excelText(row.参数),
      category: excelText(row['分类']),
      purchasePrice: excelNumber(row['产品默认采购价'], '产品默认采购价', rowIndex),
      supplier: excelText(row['供应商']),
      colors: excelList(row['颜色（多个用、分隔）']),
      batteryPlugs: excelList(row['电池插脚（多个用、分隔）']),
      accessories: excelText(row['配件']),
      remark: excelText(row['备注']),
      packaging: [],
    };
    products.set(key, { sourceSku, product: input });
  });

  packagingRows.forEach((row, index) => {
    const rowIndex = index + 2;
    const key = excelText(row['产品标识（必填）']);
    const target = products.get(key);
    if (!target) throw new ApiError(400, 'EXCEL_VALIDATION_ERROR', `“包装”工作表第 ${rowIndex} 行找不到产品标识：${key}`, '产品标识');
    const name = excelText(row['包装名称（必填）']);
    if (!name) throw new ApiError(400, 'EXCEL_VALIDATION_ERROR', `“包装”工作表第 ${rowIndex} 行缺少包装名称`, '包装名称');
    const packCount = excelNumber(row['装箱数（必填）'], '装箱数', rowIndex, { required: true, integer: true });
    if (packCount === undefined) throw new ApiError(400, 'EXCEL_VALIDATION_ERROR', `“包装”工作表第 ${rowIndex} 行缺少装箱数`, '装箱数');
    target.product.packaging!.push({
      name,
      innerSize: excelText(row['内盒尺寸']),
      innerWeight: excelNumber(row['内盒重量(kg)'], '内盒重量', rowIndex),
      outerSize: excelText(row['外箱尺寸']),
      outerWeight: excelNumber(row['外箱重量(kg)'], '外箱重量', rowIndex),
      packCount,
      purchasePrice: excelNumber(row['包装采购价'], '包装采购价', rowIndex),
    });
  });

  for (const [key, input] of products) {
    if (!input.product.name) throw new ApiError(400, 'EXCEL_VALIDATION_ERROR', `产品“${key}”缺少产品名称`, '产品名称');
    if (!input.product.packaging?.length) throw new ApiError(400, 'EXCEL_VALIDATION_ERROR', `产品“${key}”至少需要一行包装`, '包装');
    input.product = parseProductInput(input.product);
  }
  const skus = new Set<string>();
  for (const input of products.values()) {
    if (input.sourceSku && skus.has(input.sourceSku)) throw new ApiError(400, 'DUPLICATE_SKU', `导入文件中存在重复 SKU：${input.sourceSku}`, 'SKU');
    if (input.sourceSku) skus.add(input.sourceSku);
  }
  return [...products.values()];
}

function workbookBuffer(products: Array<Record<string, unknown>>, includeSample = false): Buffer {
  const workbook = XLSX.utils.book_new();
  const productRows = includeSample
    ? [PRODUCT_HEADERS, ['示例-001', '', '示例产品', '', '工具', 0, '', '蓝、红', '牧田', '', '请删除示例行后填写', '']]
    : [PRODUCT_HEADERS, ...products.map((product) => [
      `P-${product.id}`,
      product.sku,
      product.name,
      product.parameters,
      product.category,
      product.purchasePrice ?? '',
      product.supplier,
      Array.isArray(product.colors) ? product.colors.join('、') : '',
      Array.isArray(product.batteryPlugs) ? product.batteryPlugs.join('、') : '',
      product.accessories,
      product.remark,
      Array.isArray(product.images) ? product.images.map((image) => String((image as Record<string, unknown>).relativePath ?? '')).filter(Boolean).join('、') : '',
    ])];
  const packagingRows = includeSample
    ? [PACKAGING_HEADERS, ['示例-001', '', '彩盒包装', '', '', '', '', 1, 0]]
    : [PACKAGING_HEADERS, ...products.flatMap((product) => (Array.isArray(product.packaging) ? product.packaging : []).map((packaging) => {
      const item = packaging as Record<string, unknown>;
      return [`P-${product.id}`, product.sku, item.name, item.innerSize, item.innerWeight, item.outerSize, item.outerWeight, item.packCount, item.purchasePrice ?? ''];
    }))];
  const notes = [
    ['产品库 Excel 导入模板'],
    ['填写规则'],
    ['1. “产品”工作表每个产品填写一行，“产品标识”是本次导入的分组键；同一产品的包装行要在“包装”工作表使用相同标识。'],
    ['2. 已存在产品填写原 SKU 可更新；新产品 SKU 可留空，系统会自动生成。'],
    ['3. 每个包装单独一行，在“包装采购价”填写该包装自己的采购价；产品默认采购价用于历史数据兼容。'],
    ['4. 请删除示例行后再导入，颜色和电池插脚可使用“、”分隔多个值。'],
  ];
  const productSheet = XLSX.utils.aoa_to_sheet(productRows);
  const packagingSheet = XLSX.utils.aoa_to_sheet(packagingRows);
  const notesSheet = XLSX.utils.aoa_to_sheet(notes);
  productSheet['!cols'] = PRODUCT_HEADERS.map(() => ({ wch: 18 }));
  packagingSheet['!cols'] = PACKAGING_HEADERS.map(() => ({ wch: 18 }));
  notesSheet['!cols'] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(workbook, productSheet, '产品');
  XLSX.utils.book_append_sheet(workbook, packagingSheet, '包装');
  XLSX.utils.book_append_sheet(workbook, notesSheet, '说明');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function parseStringArray(value: unknown, field: string, label: string, defaultValue: string[]): string[] {
  if (value === undefined || value === null) return [...defaultValue];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${label}必须是非空文本数组`, field);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function parseParameters(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', '参数必须是文本', 'parameters');
  }
  return value;
}

function parseProductInput(value: unknown): ProductInput {
  const body = asRecord(value);
  const status = normalizeProductStatus(body.status);
  return {
    name: status === 'draft'
      ? optionalText(body.name, 'name', '品名')
      : requiredText(body.name, 'name', '品名'),
    sku: optionalText(body.sku, 'sku', 'SKU'),
    specification: optionalText(body.specification, 'specification', '规格'),
    parameters: parseParameters(body.parameters),
    category: optionalText(body.category, 'category', '分类'),
    purchasePrice: finiteNumber(body.purchasePrice, 'purchasePrice', '采购价', 0),
    supplier: optionalText(body.supplier, 'supplier', '供应商'),
    colors: parseStringArray(body.colors, 'colors', '颜色', DEFAULT_COLORS),
    batteryPlugs: parseStringArray(body.batteryPlugs, 'batteryPlugs', '电池插脚', DEFAULT_BATTERY_PLUGS),
    accessories: optionalText(body.accessories, 'accessories', '配件'),
    remark: optionalText(body.remark, 'remark', '备注'),
    status,
    // 报价数组：没带就是不动（Excel 导入路径），带了就整表覆盖。
    purchaseQuotes: Array.isArray(body.purchaseQuotes) ? body.purchaseQuotes : undefined,
    packaging: parsePackaging(body.packaging),
  };
}

function parseProductImport(value: unknown): ProductImportInput[] {
  const body = Array.isArray(value) ? { products: value } : asRecord(value);
  const rawProducts = body.products;
  if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', '导入文件至少需要包含一个产品', 'products');
  }

  const sourceSkus = new Set<string>();
  return rawProducts.map((rawProduct, index) => {
    const raw = asRecord(rawProduct);
    const sourceSku = optionalText(raw.sku, `products[${index}].sku`, 'SKU');
    if (sourceSku && sourceSkus.has(sourceSku)) {
      throw new ApiError(400, 'DUPLICATE_SKU', `导入文件中存在重复 SKU：${sourceSku}`, `products[${index}].sku`);
    }
    if (sourceSku) sourceSkus.add(sourceSku);

    return {
      sourceSku,
      product: parseProductInput({
        ...raw,
        // Older exports may omit packaging. Keep the import useful while
        // preserving the same valid shape used by the product editor.
        packaging: raw.packaging ?? [{ name: '标准包装', packCount: 1 }],
      }),
    };
  });
}

function mapImage(row: Record<string, unknown>) {
  const relativePath = String(row.relativePath ?? row.relative_path ?? '');
  const category = row.category ?? row.imageCategory;
  return {
    id: Number(row.id),
    relativePath,
    originalName: String(row.originalName ?? row.original_name ?? ''),
    mimeType: String(row.mimeType ?? row.mime_type ?? ''),
    size: Number(row.size ?? row.size_bytes ?? 0),
    category: isProductImageCategory(category) ? category : DEFAULT_PRODUCT_IMAGE_CATEGORY,
    note: String(row.note ?? ''),
    createdAt: String(row.createdAt ?? row.created_at ?? ''),
  };
}

/** 分类留空按“产品图”处理，非法值直接拒绝，避免脏分类进入图库筛选。 */
function parseImageCategory(value: unknown, field = 'category'): ProductImageCategory {
  const text = String(value ?? '').trim();
  if (!text) return DEFAULT_PRODUCT_IMAGE_CATEGORY;
  if (!isProductImageCategory(text)) {
    throw new ApiError(400, 'VALIDATION_ERROR', '图片分类无效', field);
  }
  return text;
}

function parseImageNote(value: unknown, field = 'note'): string {
  if (typeof value !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', '图片备注必须是文本', field);
  }
  const text = value.trim();
  if (text.length > MAX_PRODUCT_IMAGE_NOTE_LENGTH) {
    throw new ApiError(400, 'VALIDATION_ERROR', `图片备注不能超过 ${MAX_PRODUCT_IMAGE_NOTE_LENGTH} 个字`, field);
  }
  return text;
}

function getProductId(request: FastifyRequest<{ Params: { id: string } }>): number {
  return parseId(request.params.id);
}

async function safeRoute<T>(
  handler: () => Promise<T> | T,
  reply: Parameters<typeof sendFailure>[0],
): Promise<unknown> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ApiError) return sendFailure(reply, error);
    if (error instanceof FileStoreError) {
        const statusCode = error.code === 'IMAGE_TOO_LARGE' || error.code === 'PRODUCT_ATTACHMENT_TOO_LARGE' || error.code === 'VIDEO_TOO_LARGE' ? 413 : error.code === 'UNSUPPORTED_IMAGE_TYPE' || error.code === 'UNSUPPORTED_PRODUCT_ATTACHMENT_TYPE' || error.code === 'UNSUPPORTED_VIDEO_TYPE' ? 415 : 400;
      return sendFailure(reply, new ApiError(statusCode, error.code, error.message, 'file'));
    }
    return sendFailure(reply, mapDatabaseError(error));
  }
}

export async function registerProductRoutes(app: FastifyInstance, options: ProductRouteOptions): Promise<void> {
  const { repositories, fileStore, thumbnailService } = options;
  const pdfRenderer = options.pdfRenderer ?? new PdfRenderer();

  app.get('/api/products/export', async (_request, reply) =>
    safeRoute(() => {
      // 草稿是未完成的产品资料，不进入导出文件。
      const products = repositories.listProducts({ status: 'active' }).flatMap((product) => {
        const mapped = mapProduct(product);
        return mapped ? [mapped] : [];
      });
      const fileName = `产品库-${new Date().toISOString().slice(0, 10)}.xlsx`;
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="products.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
        .send(workbookBuffer(products));
    }, reply),
  );

  app.get('/api/products/import-template', async (_request, reply) =>
    safeRoute(() => reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="product-import-template.xlsx"; filename*=UTF-8''${encodeURIComponent('产品库导入模板.xlsx')}`)
      .send(workbookBuffer([], true)), reply),
  );

  app.post('/api/products/import', async (request, reply) =>
    safeRoute(async () => {
      const file = await request.file();
      if (!file) throw new ApiError(400, 'FILE_REQUIRED', '请选择产品库 Excel 文件', 'file');
      const buffer = await file.toBuffer();
      if (!buffer.length) throw new ApiError(400, 'EXCEL_FORMAT_ERROR', '导入文件不能为空', 'file');
      const inputs = parseExcelImport(buffer);
      const result = repositories.importProducts(inputs);
      return sendSuccess(reply, {
        formatVersion: 2,
        total: inputs.length,
        created: result.created,
        updated: result.updated,
        products: result.products.map((product) => mapProduct(product)),
      });
    }, reply),
  );

  app.get('/api/products', async (request, reply) =>
    safeRoute(() => {
      const query = request.query as Record<string, string | undefined>;
      const page = Math.max(1, Number(query.page ?? 1) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(query.pageSize ?? 50) || 50));
      const all = repositories.listProducts({
        query: query.q,
        name: query.name,
        sku: query.sku,
        specification: query.specification,
        status: query.status === 'draft' || query.status === 'active' || query.status === 'discontinued' ? query.status : undefined,
      });
      const items = all.slice((page - 1) * pageSize, page * pageSize).map((row) => mapProduct(row));
      return sendSuccess(reply, { items, total: all.length, page, pageSize });
    }, reply),
  );

  // 产品图册：把当前筛选结果排成 A4 网格 PDF（主图 + 参数 + 包装）。
  // 客户版口径在服务端定死——供应商与各档采购价根本不进入模板。
  app.post('/api/products/catalog', async (request, reply) =>
    safeRoute(async () => {
      const body = asRecord(request.body);
      const density = isCatalogDensity(body.density) ? body.density : DEFAULT_CATALOG_DENSITY;
      if (!Array.isArray(body.ids) || !body.ids.length) {
        throw new ApiError(400, 'VALIDATION_ERROR', '请选择要生成图册的产品', 'ids');
      }
      const ids = body.ids.map((value) => parseId(String(value), 'ids'));
      // 一次全量查询建索引，避免逐 id 命中数据库；输出顺序跟随请求里的 ids，与页面列表一致。
      const byId = new Map(repositories.listProducts()
        .map((row) => mapProduct(row))
        .filter((product): product is NonNullable<typeof product> => Boolean(product))
        .map((product) => [product.id, product] as const));
      const products: CatalogProduct[] = ids.map((id) => {
        const product = byId.get(id);
        if (!product) throw new ApiError(404, 'NOT_FOUND', '产品不存在');
        return toCatalogProduct(product);
      });

      const imageDataUrls = new Map<number, string | undefined>();
      if (thumbnailService) {
        const size = catalogThumbnailSize(density);
        const targets = products
          .map((product) => ({ product, relativePath: pickCatalogImage(product) }))
          .filter((item): item is { product: CatalogProduct; relativePath: string } =>
            Boolean(item.relativePath) && isResizableImage(item.relativePath ?? ''));
        // 原图平均 1.5MB、最大 6MB，分批处理避免一次把上百张原图读进内存。
        for (let offset = 0; offset < targets.length; offset += CATALOG_IMAGE_CONCURRENCY) {
          await Promise.all(targets.slice(offset, offset + CATALOG_IMAGE_CONCURRENCY).map(async (item) => {
            try {
              const image = await thumbnailService.get(size, item.relativePath);
              // 缩略图缓存是 WebP，但 Chromium 打 PDF 会把 WebP 无损重编码（实测 103 图 20.8MB），
              // 转成 JPEG 后按 DCT 直通，同一本图册 2.9MB。
              const jpeg = await sharp(image).flatten({ background: '#ffffff' }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
              imageDataUrls.set(item.product.id, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
            } catch {
              // 单张图读不出来不值得整本失败，那一格回落到「图待补」。
            }
          }));
        }
      }

      // 封面（默认带，body.cover === false 时不出）：公司名/电话/地址/Logo/微信二维码来自公司资料；全空则不排封面页。
      let cover: CatalogCover | undefined;
      if (body.cover !== false && options.settingsRepository) {
        const profile = options.settingsRepository.getCompanyProfile();
        const [logoDataUrl, qrDataUrl] = await Promise.all([
          imageFileToDataUrl(options.fileStore, profile.logoRelativePath, 600),
          imageFileToDataUrl(options.fileStore, profile.wechatQrRelativePath, 600),
        ]);
        if (profile.name || profile.phone || profile.address || logoDataUrl || qrDataUrl) {
          cover = { companyName: profile.name, phone: profile.phone, address: profile.address, logoDataUrl, qrDataUrl };
        }
      }

      const pdf = await pdfRenderer.render(renderProductCatalogHtml(products, { density, imageDataUrls, cover }));
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="product-catalog.pdf"; filename*=UTF-8''${encodeURIComponent('产品图册.pdf')}`)
        .send(pdf);
    }, reply),
  );

  // 在售 ↔ 停售：只切状态，不动资料，也不刷新 updated_at（否则老品会窜到列表最前）。
  app.post('/api/products/:id/status', async (request: FastifyRequest<{ Params: { id: string } }>, reply) =>
    safeRoute(() => {
      const id = parseId(request.params.id);
      const body = asRecord(request.body);
      if (body.status !== 'active' && body.status !== 'discontinued') {
        throw new ApiError(400, 'VALIDATION_ERROR', '产品状态只能是「在售」或「停售」', 'status');
      }
      const product = repositories.setProductStatus(id, body.status);
      if (!product) throw new ApiError(404, 'NOT_FOUND', '产品不存在');
      return sendSuccess(reply, mapProduct(product));
    }, reply),
  );

  app.get('/api/products/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) =>
    safeRoute(() => {
      const product = repositories.getProduct(getProductId(request));
      if (!product) throw new ApiError(404, 'NOT_FOUND', '产品不存在');
      return sendSuccess(reply, mapProduct(product));
    }, reply),
  );

  app.post('/api/products', async (request, reply) =>
    safeRoute(() => {
      const product = repositories.saveProduct(parseProductInput(request.body));
      if (!product) throw new ApiError(500, 'SAVE_FAILED', '产品保存失败');
      appendProductToCatalog(options.catalogRepository, request.body, Number((product as { id?: number }).id));
      return sendSuccess(reply, mapProduct(product), 201);
    }, reply),
  );

  app.put('/api/products/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) =>
    safeRoute(() => {
      const id = getProductId(request);
      if (!repositories.getProduct(id)) throw new ApiError(404, 'NOT_FOUND', '产品不存在');
      const product = repositories.saveProduct(parseProductInput(request.body), id);
      if (!product) throw new ApiError(500, 'SAVE_FAILED', '产品保存失败');
      appendProductToCatalog(options.catalogRepository, request.body, Number((product as { id?: number }).id));
      return sendSuccess(reply, mapProduct(product));
    }, reply),
  );

  app.delete('/api/products/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) =>
    safeRoute(async () => {
      const id = getProductId(request);
      if (!repositories.getProduct(id)) throw new ApiError(404, 'NOT_FOUND', '产品不存在');
      const paths = repositories.deleteProduct(id);
      if (fileStore) await Promise.all(paths.map((path) => fileStore.deleteFile(path)));
      return sendSuccess(reply, null);
    }, reply),
  );

  app.post('/api/products/:id/images', async (request: FastifyRequest<{ Params: { id: string }; Querystring: { category?: string; note?: string } }>, reply) =>
    safeRoute(async () => {
      if (!fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
      const id = getProductId(request);
      if (!repositories.getProduct(id)) throw new ApiError(404, 'NOT_FOUND', '产品不存在');
      const category = parseImageCategory(request.query?.category);
      const note = parseImageNote(request.query?.note ?? '');
      const file = await request.file(imageFileOptions);
      if (!file) throw new ApiError(400, 'FILE_REQUIRED', '请选择产品图片', 'file');
      const stored = await fileStore.optimizeStoredImage(await fileStore.saveImage(file.file, 'product', file.filename, file.mimetype));
      try {
        const image = repositories.addProductImage(id, stored, category, note);
        return sendSuccess(reply, image ? mapImage(image) : null, 201);
      } catch (error) {
        await fileStore.deleteFile(stored.relativePath);
        throw error;
      }
    }, reply),
  );

  app.patch(
    '/api/products/:id/images/:imageId',
    async (request: FastifyRequest<{ Params: ImageParams; Body: { category?: unknown; note?: unknown } }>, reply) =>
      safeRoute(() => {
        const productId = parseId(request.params.id);
        const imageId = parseId(request.params.imageId, 'imageId');
        const body = asRecord(request.body);
        const patch: { category?: string; note?: string } = {};
        if (body.category !== undefined) patch.category = parseImageCategory(body.category);
        if (body.note !== undefined) patch.note = parseImageNote(body.note);
        if (patch.category === undefined && patch.note === undefined) {
          throw new ApiError(400, 'VALIDATION_ERROR', '请提供要修改的图片分类或备注', 'category');
        }
        if (!repositories.updateProductImage(productId, imageId, patch)) {
          throw new ApiError(404, 'NOT_FOUND', '产品图片不存在');
        }
        const image = repositories.getProduct(productId)?.images.find((row: { id?: unknown }) => Number(row.id) === imageId);
        return sendSuccess(reply, image ? mapImage(image as Record<string, unknown>) : null);
      }, reply),
  );

  app.put(
    '/api/products/:id/images/order',
    async (request: FastifyRequest<{ Params: { id: string }; Body: { imageIds?: unknown } }>, reply) =>
      safeRoute(() => {
        const productId = getProductId(request);
        if (!repositories.getProduct(productId)) throw new ApiError(404, 'NOT_FOUND', '产品不存在');
        const body = asRecord(request.body);
        if (!Array.isArray(body.imageIds) || body.imageIds.some((value) => !/^\d+$/.test(String(value)))) {
          throw new ApiError(400, 'VALIDATION_ERROR', '图片顺序参数无效', 'imageIds');
        }
        if (!repositories.reorderProductImages(productId, body.imageIds.map((value) => Number(value)))) {
          throw new ApiError(400, 'VALIDATION_ERROR', '图片顺序与产品图片不匹配', 'imageIds');
        }
        return sendSuccess(reply, null);
      }, reply),
  );

  app.delete(
    '/api/products/:id/images/:imageId',
    async (request: FastifyRequest<{ Params: ImageParams }>, reply) =>
      safeRoute(async () => {
        if (!fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
        const productId = parseId(request.params.id);
        const imageId = parseId(request.params.imageId, 'imageId');
        const relativePath = repositories.removeProductImage(productId, imageId);
        if (!relativePath) throw new ApiError(404, 'NOT_FOUND', '产品图片不存在');
        assertDeletableImagePath(relativePath, 'product-images');
        await fileStore.deleteFile(relativePath);
        return sendSuccess(reply, null);
      }, reply),
  );

  app.post('/api/products/:id/videos', async (request: FastifyRequest<{ Params: { id: string } }>, reply) =>
    safeRoute(async () => {
      if (!fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
      const id = getProductId(request);
      if (!repositories.getProduct(id)) throw new ApiError(404, 'NOT_FOUND', '产品不存在');
      const file = await request.file(videoFileOptions);
      if (!file) throw new ApiError(400, 'FILE_REQUIRED', '请选择产品视频', 'file');
      const stored = await fileStore.saveFile(file.file, 'product-video', file.filename, file.mimetype);
      try {
        const video = repositories.addProductVideo(id, stored);
        return sendSuccess(reply, video ? mapVideo(video as Record<string, unknown>) : null, 201);
      } catch (error) {
        await fileStore.deleteFile(stored.relativePath);
        throw error;
      }
    }, reply),
  );

  app.delete('/api/products/:id/videos/:videoId', async (request: FastifyRequest<{ Params: { id: string; videoId: string } }>, reply) =>
    safeRoute(async () => {
      if (!fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
      const productId = getProductId(request);
      const videoId = parseId(request.params.videoId, 'videoId');
      const relativePath = repositories.deleteProductVideo(productId, videoId);
      if (relativePath === null) throw new ApiError(404, 'NOT_FOUND', '视频不存在');
      assertDeletableImagePath(relativePath, 'product-videos');
      await fileStore.deleteFile(relativePath);
      return sendSuccess(reply, null);
    }, reply),
  );

  app.get('/api/products/:id/attachments', async (request: FastifyRequest<{ Params: { id: string } }>, reply) =>
    safeRoute(() => {
      const productId = getProductId(request);
      if (!repositories.getProduct(productId)) throw new ApiError(404, 'NOT_FOUND', '产品不存在');
      return sendSuccess(reply, repositories.listProductAttachments(productId).map((row) => mapAttachment(row as Record<string, unknown>)));
    }, reply),
  );

  app.post('/api/products/:id/attachments', async (request: FastifyRequest<{ Params: { id: string }; Querystring: { category?: string } }>, reply) =>
    safeRoute(async () => {
      if (!fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
      const productId = getProductId(request);
      if (!repositories.getProduct(productId)) throw new ApiError(404, 'NOT_FOUND', '产品不存在');
      const category = String(request.query?.category ?? 'other').trim() || 'other';
      if (!PRODUCT_ATTACHMENT_CATEGORIES.has(category)) throw new ApiError(400, 'VALIDATION_ERROR', '附件类型无效', 'category');
      const file = await request.file(contractFileOptions);
      if (!file) throw new ApiError(400, 'FILE_REQUIRED', '请选择产品附件', 'file');
      const stored = await fileStore.saveFile(file.file, 'product-attachment', file.filename, file.mimetype);
      try {
        const attachment = repositories.addProductAttachment(productId, category, stored);
        return sendSuccess(reply, attachment ? mapAttachment(attachment as Record<string, unknown>) : null, 201);
      } catch (error) {
        await fileStore.deleteFile(stored.relativePath);
        throw error;
      }
    }, reply),
  );

  app.patch('/api/products/:id/attachments/:attachmentId', async (request: FastifyRequest<{ Params: { id: string; attachmentId: string }; Body: { category?: unknown } }>, reply) =>
    safeRoute(() => {
      const productId = getProductId(request);
      const attachmentId = parseId(request.params.attachmentId, 'attachmentId');
      const category = String(asRecord(request.body).category ?? '').trim();
      if (!PRODUCT_ATTACHMENT_CATEGORIES.has(category)) throw new ApiError(400, 'VALIDATION_ERROR', '附件类型无效', 'category');
      if (!repositories.updateProductAttachmentCategory(attachmentId, productId, category)) throw new ApiError(404, 'NOT_FOUND', '产品附件不存在');
      const attachment = repositories.listProductAttachments(productId).find((row) => Number((row as { id?: unknown }).id) === attachmentId);
      return sendSuccess(reply, attachment ? mapAttachment(attachment as Record<string, unknown>) : null);
    }, reply),
  );

  app.delete('/api/products/:id/attachments/:attachmentId', async (request: FastifyRequest<{ Params: { id: string; attachmentId: string } }>, reply) =>
    safeRoute(async () => {
      if (!fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
      const productId = getProductId(request);
      const attachmentId = parseId(request.params.attachmentId, 'attachmentId');
      const relativePath = repositories.deleteProductAttachment(productId, attachmentId);
      if (!relativePath) throw new ApiError(404, 'NOT_FOUND', '产品附件不存在');
      await fileStore.deleteFile(relativePath);
      return sendSuccess(reply, null);
    }, reply),
  );

  app.post(
    '/api/products/:id/packaging/:packagingId/images',
    async (request: FastifyRequest<{ Params: { id: string; packagingId: string } }>, reply) =>
      safeRoute(async () => {
        if (!fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
        const productId = parseId(request.params.id);
        const packagingId = parseId(request.params.packagingId, 'packagingId');
        if (!repositories.getProductPackaging(productId, packagingId)) throw new ApiError(404, 'NOT_FOUND', '包装不存在');
        const file = await request.file(imageFileOptions);
        if (!file) throw new ApiError(400, 'FILE_REQUIRED', '请选择包装图片', 'file');
        const stored = await fileStore.saveImage(file.file, 'product-packaging', file.filename, file.mimetype);
        try {
          const image = repositories.addProductPackagingImage(packagingId, stored);
          return sendSuccess(reply, image ? mapImage(image) : null, 201);
        } catch (error) {
          await fileStore.deleteFile(stored.relativePath);
          throw error;
        }
      }, reply),
  );

  app.delete(
    '/api/products/:id/packaging/:packagingId/images/:imageId',
    async (request: FastifyRequest<{ Params: PackagingImageParams }>, reply) =>
      safeRoute(async () => {
        if (!fileStore) throw new ApiError(503, 'FILE_STORE_UNAVAILABLE', '附件存储尚未配置');
        const productId = parseId(request.params.id);
        const packagingId = parseId(request.params.packagingId, 'packagingId');
        const imageId = parseId(request.params.imageId, 'imageId');
        if (!repositories.getProductPackaging(productId, packagingId)) throw new ApiError(404, 'NOT_FOUND', '包装不存在');
        const relativePath = repositories.removeProductPackagingImage(packagingId, imageId);
        if (!relativePath) throw new ApiError(404, 'NOT_FOUND', '包装图片不存在');
        assertDeletableImagePath(relativePath, 'product-packaging-images');
        await fileStore.deleteFile(relativePath);
        return sendSuccess(reply, null);
      }, reply),
  );
}

export const productRoutes = registerProductRoutes;

export { FileStoreError };
