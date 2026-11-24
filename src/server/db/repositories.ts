import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from './connection.js';
import { mapPackagingRecord, normalizePackagingItem, type PackagingInputLike } from './packaging.js';
import { normalizeAccessoryPrices } from '../../shared/accessory-prices.js';
import type { PackagingSourceRow } from '../../shared/packaging-presets.js';
import { OrderNumberService } from '../services/order-number-service.js';
import { autoPack, type PackedBox } from '../../shared/packing.js';
import { calculateOutstandingCents, deriveFinancePaymentStatus, isOrderPaymentCleared } from '../../shared/finance.js';
import { DEFAULT_PRODUCT_IMAGE_CATEGORY } from '../../shared/product-image-categories.js';
import { normalizeProductStatus, type ProductStatus } from '../../shared/product-status.js';
import { mapStoredPurchaseQuotes, normalizePurchaseQuotes, purchaseQuoteMirror } from '../../shared/product-purchase-quotes.js';
import { cartonLabelRequirement } from '../../shared/customers.js';
import type { PartialShipmentEntryInput, ShipmentItemRecord, ShipmentRecord } from '../../shared/shipping.js';

type SqlValue = string | number | null;

export interface PackagingInput {
  id?: number | string;
  imageIds?: number[];
  name?: string;
  innerSize?: string;
  innerWeight?: number;
  outerSize?: string;
  outerLength?: number;
  outerWidth?: number;
  outerHeight?: number;
  outerWeight?: number;
  packCount: number;
  purchasePrice?: number | null;
}

export interface ProductInput {
  name: string;
  sku?: string;
  specification?: string;
  parameters?: string;
  category?: string;
  purchasePrice?: number | null;
  supplier?: string;
  colors?: string[];
  batteryPlugs?: string[];
  /** 12V / 16.8V / 21V；缺省保持原值（新建默认 21V）。 */
  batteryVoltage?: string;
  accessories?: string;
  remark?: string;
  /** 草稿产品允许信息不完整，在售与停售都要求品名必填。 */
  status?: ProductStatus;
  /** 多档采购报价；传了就整表覆盖，没传（如 Excel 导入）保持原样。 */
  purchaseQuotes?: unknown[];
  /** 产品专有的「配件与价格」（售价计算器取数）；传了就整体覆盖，没传保持原样。 */
  accessoryPrices?: unknown[];
  packaging?: PackagingInput[];
}

export interface ProductImportInput {
  sourceSku?: string;
  product: ProductInput;
}

export interface CustomerProductInput {
  name: string;
  sku?: string;
  specification?: string;
  packCount?: number;
  packaging?: PackagingInput[];
  remark?: string;
}

export interface OrderItemInput {
  customerProductId?: number | null;
  /** 系统产品引用：从系统产品库直选的行带上，用于图片回退与后续存入客户产品库。 */
  productId?: number | null;
  name: string;
  sku?: string;
  specification?: string;
  packagingName?: string;
  packCount?: number;
  quantity: number;
  unitPriceCents?: number;
  amountCents?: number;
  freightPerBoxCents?: number;
  /** 单件成本快照（分）；null 表示已确认无此成本，undefined 表示沿用旧值/未填写。 */
  machineCostCents?: number | null;
  batteryCostCents?: number | null;
  chargerCostCents?: number | null;
  packagingCostCents?: number | null;
  accessoryCostCents?: number | null;
  otherCostCents?: number | null;
  /** 本行成本是否已核对；未核对时利润显示“成本待补”。 */
  costConfirmed?: boolean;
  packaging?: PackagingInput[];
  /** 备注：内部信息，不会印到箱唛上。 */
  remark?: string;
  /** 箱唛要求：要印在箱面上的作业指令。 */
  labelRequirement?: string;
}

export interface OrderAttachmentInput {
  category: 'label' | 'instruction' | 'packaging' | 'other';
  sourceCustomerProductId?: number | null;
  relativePath: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface CreateOrderInput {
  orderNo: string;
  orderedAt: string;
  customerId?: number | null;
  customerName?: string;
  customerContactName?: string;
  customerContactPhone?: string;
  customerShippingInfo?: string;
  recipientName?: string;
  recipientInfo?: string;
  amount?: number;
  amountCents?: number;
  shippingCents?: number;
  /** 实际物流支出，不是向客户收取的运费。 */
  logisticsCostCents?: number | null;
  /** 标贴按整单核算。 */
  labelCostCents?: number | null;
  /** 其他整单费用（打样、报关、佣金等）。 */
  otherCostCents?: number | null;
  otherCostNote?: string;
  /** 订单级成本是否已核对。 */
  costConfirmed?: boolean;
  trackingNo?: string;
  paymentNote?: string;
  orderDetail?: string;
  remark?: string;
  /** 订单渠道：online 线上 / offline 线下；旧接口不传时由服务层默认 online。 */
  channel?: string;
  /** 结算方式：corporate 对公（需开票）/ personal 对私（免开票），历史订单默认 corporate */
  settlementType?: string;
  /** 收款/开票公司；对公订单新建时必填，历史订单可为空 */
  companyId?: number | null;
  orderAttachments?: OrderAttachmentInput[];
  sourceSalesDocumentId?: number | null;
  /** 草稿订单：宽松校验，status 存为 draft，发布后回到正式流程。 */
  isDraft?: boolean;
  /** 创建人用户名，由服务端从会话注入，不接受客户端提交。 */
  createdBy?: string;
  items: OrderItemInput[];
}

export type UpdateOrderInput = CreateOrderInput;

export interface OrderListFilters {
  status?: string;
  channel?: string;
  query?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

function now(): string {
  return new Date().toISOString();
}

function json(value: unknown, fallback: unknown = []): string {
  return JSON.stringify(value ?? fallback);
}

function numberOrZero(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function normalizePackaging(packaging: PackagingInput[] | undefined, fallback: PackagingInput): PackagingInput[] {
  const values = packaging?.length ? packaging : [fallback];
  return values.map((item) => normalizePackagingItem({
    ...item,
    name: item.name ?? fallback.name ?? '',
    packCount: item.packCount ?? fallback.packCount,
  }));
}

interface LabelSignatureItem {
  name: string;
  sku: string;
  specification: string;
  quantity: number;
  packSizes: number[];
  requirement: string;
}

function effectivePackSizes(packaging: PackagingInput[] | undefined, packCount: number | undefined): number[] {
  const sizes = normalizePackaging(packaging, { name: '', packCount: packCount ?? 1 })
    .map((item) => Math.trunc(item.packCount))
    .filter((count) => count > 0);
  return sizes.length ? sizes : [Math.max(1, Math.trunc(packCount ?? 1))];
}

/** 只包含会影响箱唛内容的字段；价格、客户、附件等变化不触发重排。 */
function labelSignature(orderDetail: string, items: LabelSignatureItem[]): string {
  return JSON.stringify({ orderDetail, items });
}

function lastInsertId(result: { lastInsertRowid: number | bigint }): number {
  return Number(result.lastInsertRowid);
}

function rowId(row: Record<string, unknown> | undefined): number {
  return Number(row?.id ?? 0);
}

function nextProductSku(database: DatabaseSync, timestamp: string): string {
  const rows = database.prepare('SELECT sku FROM products WHERE sku LIKE ?').all('VT-%');
  const savedSequence = database
    .prepare("SELECT value FROM settings WHERE key = 'product_sku_last_value'")
    .get() as { value?: unknown } | undefined;
  let max = Number(savedSequence?.value ?? 0);
  if (!Number.isSafeInteger(max) || max < 0) max = 0;

  for (const row of rows) {
    const match = String(row.sku ?? '').trim().match(/^VT-(\d+)$/i);
    if (match) {
      const value = Number(match[1]);
      if (Number.isSafeInteger(value)) max = Math.max(max, value);
    }
  }

  const next = max + 1;
  database
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run('product_sku_last_value', String(next), timestamp);
  return `VT-${String(next).padStart(4, '0')}`;
}

export class DatabaseRepositories {
  private readonly orderNumbers: OrderNumberService;

  constructor(private readonly database: DatabaseSync) {
    this.orderNumbers = new OrderNumberService(database);
  }

  previewNextOrderNumber(date?: Date): string {
    return this.orderNumbers.preview(date);
  }

  listProducts(filters: { query?: string; name?: string; sku?: string; specification?: string; status?: ProductStatus } = {}) {
    const values: SqlValue[] = [];
    const conditions: string[] = [];
    const query = filters.query?.trim();
    if (query) {
      conditions.push('(p.name LIKE ? OR p.sku LIKE ? OR p.specification LIKE ?)');
      values.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    for (const [field, value] of [
      ['p.name', filters.name],
      ['p.sku', filters.sku],
      ['p.specification', filters.specification],
    ] as const) {
      if (value?.trim()) {
        conditions.push(`${field} LIKE ?`);
        values.push(`%${value.trim()}%`);
      }
    }
    if (filters.status) {
      conditions.push('p.status = ?');
      values.push(filters.status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.database
      .prepare(
        `SELECT p.*,
          COALESCE((SELECT json_group_array(json_object(
            'id', pp.id, 'name', pp.name, 'innerSize', pp.inner_size,
            'innerWeight', pp.inner_weight, 'outerSize', pp.outer_size,
            'outerLength', pp.outer_length,
            'outerWidth', pp.outer_width, 'outerHeight', pp.outer_height,
            'outerWeight', pp.outer_weight, 'packCount', pp.pack_count,
            'purchasePrice', pp.purchase_price,
            'sortOrder', pp.sort_order,
            'images', COALESCE((SELECT json_group_array(json_object(
              'id', ppi.id, 'relativePath', ppi.relative_path, 'originalName', ppi.original_name,
              'mimeType', ppi.mime_type, 'size', ppi.size_bytes, 'createdAt', ppi.created_at
            )) FROM product_packaging_images ppi WHERE ppi.packaging_id = pp.id ORDER BY ppi.created_at, ppi.id), '[]')
          )) FROM product_packaging pp WHERE pp.product_id = p.id ORDER BY pp.sort_order), '[]') AS packaging_json,
          COALESCE((SELECT json_group_array(json_object(
            'id', q.id, 'supplier', q.supplier, 'variant', q.variant,
            'price', q.price, 'isDefault', q.is_default
          )) FROM product_purchase_quotes q WHERE q.product_id = p.id
            ORDER BY q.is_default DESC, q.sort_order, q.id), '[]') AS purchase_quotes_json,
          COALESCE((SELECT json_group_array(json_object(
            'id', ordered_pi.id, 'relativePath', ordered_pi.relative_path, 'originalName', ordered_pi.original_name,
            'mimeType', ordered_pi.mime_type, 'size', ordered_pi.size_bytes,
            'category', ordered_pi.category, 'note', ordered_pi.note
          )) FROM (
            SELECT pi.id, pi.relative_path, pi.original_name, pi.mime_type, pi.size_bytes, pi.category, pi.note
            FROM product_images pi
            WHERE pi.product_id = p.id
            ORDER BY pi.sort_order, pi.id
          ) ordered_pi), '[]') AS images_json
          ,COALESCE((SELECT json_group_array(json_object(
            'id', pv.id, 'relativePath', pv.relative_path, 'originalName', pv.original_name,
            'mimeType', pv.mime_type, 'size', pv.size_bytes, 'createdAt', pv.created_at
          )) FROM product_videos pv WHERE pv.product_id = p.id ORDER BY pv.created_at, pv.id), '[]') AS videos_json
          ,COALESCE((SELECT json_group_array(json_object(
            'id', pa.id, 'category', pa.category, 'relativePath', pa.relative_path,
            'originalName', pa.original_name, 'mimeType', pa.mime_type,
            'size', pa.size_bytes, 'createdAt', pa.created_at
          )) FROM product_attachments pa WHERE pa.product_id = p.id ORDER BY pa.created_at, pa.id), '[]') AS attachments_json
         FROM products p ${where} ORDER BY p.updated_at DESC, p.id DESC`,
      )
      .all(...values);

    return rows.map((row) => ({
      ...row,
      colors: JSON.parse(String(row.colors_json)),
      batteryPlugs: JSON.parse(String(row.battery_plugs_json)),
      accessoryPrices: normalizeAccessoryPrices(JSON.parse(String(row.accessory_prices ?? '[]'))),
      accessoryPricesCustomized: Number(row.accessory_prices_customized ?? 0) === 1,
      packaging: JSON.parse(String(row.packaging_json)).map((item: PackagingInputLike) => mapPackagingRecord(item)),
      purchaseQuotes: mapStoredPurchaseQuotes(JSON.parse(String(row.purchase_quotes_json ?? '[]'))),
      images: JSON.parse(String(row.images_json)),
      videos: JSON.parse(String(row.videos_json ?? '[]')),
      attachments: JSON.parse(String(row.attachments_json)),
    }));
  }

  /** 包装预设的统计原料：全库包装记录里与预设相关的几个字段，连同所属产品的分类一起带回。 */
  listPackagingRowsForPresets(): PackagingSourceRow[] {
    const rows = this.database
      .prepare(`
        SELECT pp.name, pp.inner_size, pp.outer_size, pp.pack_count, pp.purchase_price, p.category
        FROM product_packaging pp
        JOIN products p ON p.id = pp.product_id
      `)
      .all() as Array<{ name: string | null; inner_size: string | null; outer_size: string | null; pack_count: number | null; purchase_price: number | null; category: string | null }>;
    return rows.map((row) => ({
      name: row.name ?? '',
      innerSize: row.inner_size ?? '',
      outerSize: row.outer_size ?? '',
      packSize: row.pack_count ?? 1,
      purchasePrice: row.purchase_price == null ? '' : String(row.purchase_price),
      category: row.category ?? '',
    }));
  }

  /**
   * 产品库现存分类（含产品数）：包装管理的「可以装哪些产品」候选来源。
   * 手动输入的新分类不在其中，由调用方自行合并。
   */
  listProductCategoriesWithCounts(): Array<{ name: string; productCount: number }> {
    const rows = this.database
      .prepare(`
        SELECT TRIM(category) AS name, COUNT(*) AS product_count
        FROM products
        WHERE TRIM(category) != ''
        GROUP BY TRIM(category)
        ORDER BY product_count DESC, name ASC
      `)
      .all() as Array<{ name: string; product_count: number }>;
    return rows.map((row) => ({ name: row.name, productCount: Number(row.product_count) }));
  }

  /**
   * 颜色 / 插脚的可选清单来源：产品库里实际用过的取值。
   * 设置页「从产品库重新统计」与首次自动生成都用它。
   */
  listProductOptionRows(): Array<{ colors: string[]; batteryPlugs: string[] }> {
    const rows = this.database
      .prepare('SELECT colors_json, battery_plugs_json FROM products')
      .all() as Array<{ colors_json: string | null; battery_plugs_json: string | null }>;
    const parse = (value: string | null): string[] => {
      if (!value) return [];
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
      } catch {
        return [];
      }
    };
    return rows.map((row) => ({ colors: parse(row.colors_json), batteryPlugs: parse(row.battery_plugs_json) }));
  }

  /**
   * 类目默认配件即将被改写：先把旧模板固化到仍在跟随该类目的产品上。
   * 这样已经建好的产品保持原样，新模板只影响以后新建的产品。
   * 只写配件两列，不刷新 updated_at（避免产品库列表顺序被这批快照改动）。
   */
  freezeCategoryAccessoryPrices(category: string, items: unknown): number {
    const key = category.trim();
    if (!key) return 0;
    const result = this.database
      .prepare(`
        UPDATE products
        SET accessory_prices = ?, accessory_prices_customized = 1
        WHERE TRIM(category) = ?
          AND accessory_prices_customized = 0
          AND (accessory_prices IS NULL OR TRIM(accessory_prices) IN ('', '[]'))
      `)
      .run(json(normalizeAccessoryPrices(items)), key);
    return Number(result.changes ?? 0);
  }

  saveProduct(input: ProductInput, productId?: number) {
    const timestamp = now();
    // 报价数组是唯一事实：给了就用默认档的供应商与价格回写镜像列，没给（Excel 导入等老路径）沿用手上的值。
    const quotesProvided = Array.isArray(input.purchaseQuotes);
    const quotes = quotesProvided ? normalizePurchaseQuotes(input.purchaseQuotes) : [];
    const accessoryPricesProvided = Array.isArray(input.accessoryPrices);
    const accessoryPrices = accessoryPricesProvided ? normalizeAccessoryPrices(input.accessoryPrices) : [];
    const mirror = quotesProvided ? purchaseQuoteMirror(quotes) : { supplier: input.supplier ?? '', purchasePrice: input.purchasePrice == null ? '' : String(input.purchasePrice) };
    const mirrorPrice = mirror.purchasePrice.trim() === '' ? null : Number(mirror.purchasePrice);
    const mirrorSupplier = mirror.supplier;
    return withTransaction(this.database, (database) => {
      let id = productId;
      const existingPackagingImages = productId
        ? this.database.prepare(`
            SELECT pp.id AS packaging_id, ppi.id, ppi.relative_path, ppi.original_name, ppi.mime_type, ppi.size_bytes, ppi.created_at
            FROM product_packaging pp
            JOIN product_packaging_images ppi ON ppi.packaging_id = pp.id
            WHERE pp.product_id = ?
          `).all(productId) as Array<Record<string, unknown>>
        : [];
      if (id) {
        database
          .prepare(
            `UPDATE products SET name = ?, specification = ?, category = ?, purchase_price = ?,
              parameters = ?, supplier = ?, colors_json = ?, battery_plugs_json = ?, battery_voltage = COALESCE(?, battery_voltage),
              accessories = ?, remark = ?, status = ?,
              accessory_prices = COALESCE(?, accessory_prices),
              accessory_prices_customized = CASE WHEN ? THEN 1 ELSE accessory_prices_customized END,
              updated_at = ?
             WHERE id = ?`,
          )
          .run(
            input.name.trim(),
            input.specification ?? '',
            input.category ?? '',
            mirrorPrice,
            input.parameters ?? '',
            mirrorSupplier,
            json(input.colors),
            json(input.batteryPlugs),
            input.batteryVoltage ?? null,
            input.accessories ?? '',
            input.remark ?? '',
            input.status ?? 'active',
            accessoryPricesProvided ? json(accessoryPrices) : null,
            accessoryPricesProvided ? 1 : 0,
            timestamp,
            id,
          );
        database.prepare('DELETE FROM product_packaging WHERE product_id = ?').run(id);
      } else {
        const sku = nextProductSku(database, timestamp);
        id = lastInsertId(
          database
            .prepare(
              `INSERT INTO products
                (name, sku, specification, parameters, category, purchase_price, supplier, colors_json, battery_plugs_json, battery_voltage, accessories, accessory_prices, accessory_prices_customized, remark, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              input.name.trim(),
              sku,
              input.specification ?? '',
              input.parameters ?? '',
              input.category ?? '',
              mirrorPrice,
              mirrorSupplier,
              json(input.colors),
              json(input.batteryPlugs),
              input.batteryVoltage ?? '21V',
              input.accessories ?? '',
              json(accessoryPrices),
              accessoryPricesProvided ? 1 : 0,
              input.remark ?? '',
              input.status ?? 'active',
              timestamp,
              timestamp,
            ),
        );
      }

      const packaging = input.packaging ?? [];
      const insertPackaging = database.prepare(
        `INSERT INTO product_packaging
          (product_id, name, inner_size, inner_weight, outer_size, outer_length, outer_width, outer_height, outer_weight, pack_count, purchase_price, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertedPackagingIds: number[] = [];
      packaging.forEach((item, index) => {
        const normalized = normalizePackagingItem(item);
        const result = insertPackaging.run(
          id,
          normalized.name,
          normalized.innerSize,
          normalized.innerWeight,
          normalized.outerSize,
          normalized.outerLength,
          normalized.outerWidth,
          normalized.outerHeight,
          normalized.outerWeight,
          normalized.packCount,
          normalized.purchasePrice,
          index,
          timestamp,
          timestamp,
        );
        insertedPackagingIds[index] = lastInsertId(result);
        const previousId = item.id == null ? 0 : Number(item.id);
        if (previousId && insertedPackagingIds[index]) {
          const selectedImageIds = Array.isArray(item.imageIds) ? new Set(item.imageIds.map(Number)) : undefined;
          const images = existingPackagingImages.filter((image) => Number(image.packaging_id) === previousId && (!selectedImageIds || selectedImageIds.has(Number(image.id))));
          const insertImage = database.prepare(`
            INSERT INTO product_packaging_images
              (packaging_id, relative_path, original_name, mime_type, size_bytes, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `);
          images.forEach((image) => insertImage.run(
            insertedPackagingIds[index],
            String(image.relative_path),
            String(image.original_name),
            String(image.mime_type),
            Number(image.size_bytes),
            String(image.created_at),
          ));
        }
      });

      if (quotesProvided) {
        database.prepare('DELETE FROM product_purchase_quotes WHERE product_id = ?').run(id);
        const insertQuote = database.prepare(
          `INSERT INTO product_purchase_quotes
            (product_id, supplier, variant, price, is_default, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        quotes.forEach((quote, index) => insertQuote.run(
          id,
          quote.supplier,
          quote.variant,
          quote.price === '' ? 0 : Number(quote.price),
          quote.isDefault ? 1 : 0,
          index,
          timestamp,
          timestamp,
        ));
      } else {
        // 没带报价数组的路径（Excel 导入、老客户端）：保证至少有一条默认档，镜像列不会成为孤儿事实。
        const hasQuote = database.prepare('SELECT 1 FROM product_purchase_quotes WHERE product_id = ?').get(id);
        if (!hasQuote && (mirrorPrice != null || mirrorSupplier)) {
          database.prepare(
            `INSERT INTO product_purchase_quotes
              (product_id, supplier, variant, price, is_default, sort_order, created_at, updated_at)
             VALUES (?, ?, '', ?, 1, 0, ?, ?)`,
          ).run(id, mirrorSupplier, mirrorPrice ?? 0, timestamp, timestamp);
        }
      }

      return this.listProducts({}).find((product) => rowId(product) === id);
    });
  }

  /** 在售 ↔ 停售 互切。故意不刷新 updated_at：产品库按最近更新排序，改状态不该让老品窜到最前。 */
  setProductStatus(productId: number, status: ProductStatus) {
    if (status === 'draft') return null;
    const result = this.database.prepare('UPDATE products SET status = ? WHERE id = ?').run(status, productId);
    return result.changes > 0 ? this.getProduct(productId) : null;
  }

  importProducts(inputs: ProductImportInput[]) {
    return withTransaction(this.database, () => {
      let created = 0;
      let updated = 0;
      const products = inputs.map(({ sourceSku, product }) => {
        // 按 SKU 匹配非草稿产品：停售的老品也要对上，否则重复导入会长出一条同 SKU 的新品。
        const existing = sourceSku?.trim()
          ? this.database.prepare("SELECT id, status FROM products WHERE sku = ? AND status != 'draft' ORDER BY id LIMIT 1").get(sourceSku.trim()) as { id?: number; status?: string } | undefined
          : undefined;
        // 导入不带状态列，更新时保留原状态（停售的不会因为导一次 Excel 就回到在售）。
        if (existing?.id != null) product.status = normalizeProductStatus(existing.status);
        const saved = this.saveProduct(product, existing?.id == null ? undefined : Number(existing.id));
        if (existing?.id == null) created += 1;
        else updated += 1;
        if (!saved) throw new Error('产品导入保存失败');
        return saved;
      });
      return { created, updated, products };
    });
  }

  deleteProduct(productId: number): string[] {
    const paths = [
      ...this.database.prepare('SELECT relative_path FROM product_images WHERE product_id = ?').all(productId),
      ...this.database.prepare(`SELECT ppi.relative_path FROM product_packaging_images ppi JOIN product_packaging pp ON pp.id = ppi.packaging_id WHERE pp.product_id = ?`).all(productId),
      ...this.database.prepare('SELECT relative_path FROM product_attachments WHERE product_id = ?').all(productId),
      ...this.database.prepare('SELECT relative_path FROM product_videos WHERE product_id = ?').all(productId),
    ].map((row) => String((row as { relative_path?: unknown }).relative_path ?? '')).filter(Boolean);
    this.database.prepare('DELETE FROM products WHERE id = ?').run(productId);
    return paths;
  }

  getProduct(productId: number) {
    return this.listProducts().find((product) => rowId(product) === productId);
  }

  addProductImage(
    productId: number,
    image: { relativePath: string; originalName: string; mimeType: string; size: number },
    category = DEFAULT_PRODUCT_IMAGE_CATEGORY,
    note = '',
  ) {
    const createdAt = now();
    const imageId = lastInsertId(
      this.database
        .prepare(
          `INSERT INTO product_images
            (product_id, relative_path, original_name, mime_type, size_bytes, sort_order, created_at, category, note)
           VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM product_images WHERE product_id = ?), ?, ?, ?)`,
        )
        .run(productId, image.relativePath, image.originalName, image.mimeType, image.size, productId, createdAt, category, note),
    );
    return this.database.prepare('SELECT * FROM product_images WHERE id = ?').get(imageId);
  }

  addProductVideo(
    productId: number,
    video: { relativePath: string; originalName: string; mimeType: string; size: number; transcodeStatus?: string },
  ) {
    const createdAt = now();
    const videoId = lastInsertId(
      this.database
        .prepare(
          `INSERT INTO product_videos
            (product_id, relative_path, original_name, mime_type, size_bytes, transcode_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(productId, video.relativePath, video.originalName, video.mimeType, video.size, video.transcodeStatus ?? 'pending', createdAt),
    );
    return this.database.prepare('SELECT * FROM product_videos WHERE id = ?').get(videoId);
  }

  /** 转码成功后把压缩结果落库：文件已被替换，体积换成压缩后的。 */
  completeProductVideoTranscode(videoId: number, sizeBytes: number): boolean {
    const result = this.database
      .prepare("UPDATE product_videos SET transcode_status = 'done', size_bytes = ?, transcoded_size_bytes = ? WHERE id = ?")
      .run(sizeBytes, sizeBytes, videoId);
    return Number(result.changes ?? 0) > 0;
  }

  /** 转码失败：保留原文件，只把状态标成 failed，界面照常能播放原画质。 */
  failProductVideoTranscode(videoId: number): boolean {
    const result = this.database
      .prepare("UPDATE product_videos SET transcode_status = 'failed' WHERE id = ?")
      .run(videoId);
    return Number(result.changes ?? 0) > 0;
  }

  /**
   * 待转码的视频（含卡在 processing 的）：服务重启后 processing 不会自动回到 pending，
   * 这里一并返回，由队列重置后重跑 —— 否则那条视频会永远停在「压缩中」。
   */
  listPendingVideoTranscodes(): Array<{ id: number; relativePath: string; originalName: string }> {
    const rows = this.database
      .prepare("SELECT id, relative_path, original_name FROM product_videos WHERE transcode_status IN ('pending', 'processing') ORDER BY id")
      .all() as Array<{ id: number; relative_path: string; original_name: string }>;
    return rows.map((row) => ({ id: Number(row.id), relativePath: String(row.relative_path), originalName: String(row.original_name) }));
  }

  /** 领取一个转码任务：把状态推进到 processing，避免重复入队。 */
  claimVideoTranscode(videoId: number): boolean {
    const result = this.database
      .prepare("UPDATE product_videos SET transcode_status = 'processing' WHERE id = ? AND transcode_status IN ('pending', 'processing')")
      .run(videoId);
    return Number(result.changes ?? 0) > 0;
  }

  /** 删除一条产品视频并返回文件路径（不存在返回 null），文件由调用方落盘删除。 */
  deleteProductVideo(productId: number, videoId: number): string | null {
    const row = this.database
      .prepare('SELECT relative_path FROM product_videos WHERE id = ? AND product_id = ?')
      .get(videoId, productId) as { relative_path?: unknown } | undefined;
    if (!row) return null;
    this.database.prepare('DELETE FROM product_videos WHERE id = ?').run(videoId);
    return String(row.relative_path ?? '');
  }

  updateProductImage(productId: number, imageId: number, patch: { category?: string; note?: string }): boolean {
    const assignments: string[] = [];
    const values: SqlValue[] = [];
    if (patch.category !== undefined) {
      assignments.push('category = ?');
      values.push(patch.category);
    }
    if (patch.note !== undefined) {
      assignments.push('note = ?');
      values.push(patch.note);
    }
    if (!assignments.length) return false;
    const result = this.database
      .prepare(`UPDATE product_images SET ${assignments.join(', ')} WHERE id = ? AND product_id = ?`)
      .run(...values, imageId, productId);
    return Number(result.changes ?? 0) > 0;
  }

  getProductPackaging(productId: number, packagingId: number) {
    return this.database.prepare('SELECT * FROM product_packaging WHERE id = ? AND product_id = ?').get(packagingId, productId);
  }

  addProductPackagingImage(
    packagingId: number,
    image: { relativePath: string; originalName: string; mimeType: string; size: number },
  ) {
    const createdAt = now();
    const imageId = lastInsertId(this.database.prepare(`
      INSERT INTO product_packaging_images
        (packaging_id, relative_path, original_name, mime_type, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(packagingId, image.relativePath, image.originalName, image.mimeType, image.size, createdAt));
    return this.database.prepare('SELECT * FROM product_packaging_images WHERE id = ?').get(imageId);
  }

  removeProductPackagingImage(packagingId: number, imageId: number): string | undefined {
    const image = this.database.prepare('SELECT relative_path FROM product_packaging_images WHERE id = ? AND packaging_id = ?').get(imageId, packagingId) as { relative_path?: unknown } | undefined;
    if (!image) return undefined;
    this.database.prepare('DELETE FROM product_packaging_images WHERE id = ? AND packaging_id = ?').run(imageId, packagingId);
    return String(image.relative_path);
  }

  removeProductImage(productId: number, imageId: number): string | undefined {
    const image = this.database
      .prepare('SELECT relative_path FROM product_images WHERE id = ? AND product_id = ?')
      .get(imageId, productId);
    if (!image) return undefined;
    this.database.prepare('DELETE FROM product_images WHERE id = ? AND product_id = ?').run(imageId, productId);
    return String(image.relative_path);
  }

  listProductAttachments(productId: number) {
    return this.database
      .prepare('SELECT * FROM product_attachments WHERE product_id = ? ORDER BY created_at, id')
      .all(productId);
  }

  addProductAttachment(
    productId: number,
    category: string,
    file: { relativePath: string; originalName: string; mimeType: string; size: number },
  ) {
    const id = lastInsertId(this.database.prepare(`
      INSERT INTO product_attachments
        (product_id, category, relative_path, original_name, mime_type, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(productId, category, file.relativePath, file.originalName, file.mimeType, file.size, now()));
    return this.database.prepare('SELECT * FROM product_attachments WHERE id = ?').get(id);
  }

  updateProductAttachmentCategory(attachmentId: number, productId: number, category: string): boolean {
    const result = this.database.prepare('UPDATE product_attachments SET category = ? WHERE id = ? AND product_id = ?').run(category, attachmentId, productId);
    return Number(result.changes ?? 0) > 0;
  }

  deleteProductAttachment(productId: number, attachmentId: number): string | undefined {
    const attachment = this.database.prepare('SELECT relative_path FROM product_attachments WHERE id = ? AND product_id = ?').get(attachmentId, productId) as { relative_path?: unknown } | undefined;
    if (!attachment) return undefined;
    this.database.prepare('DELETE FROM product_attachments WHERE id = ? AND product_id = ?').run(attachmentId, productId);
    return String(attachment.relative_path ?? '');
  }

  reorderProductImages(productId: number, imageIds: number[]): boolean {
    const rows = this.database
      .prepare('SELECT id FROM product_images WHERE product_id = ? ORDER BY id')
      .all(productId) as Array<{ id?: unknown }>;
    const existingIds = rows.map((row) => Number(row.id));
    const requestedIds = [...new Set(imageIds.map(Number))];
    if (requestedIds.length !== existingIds.length || requestedIds.some((id) => !existingIds.includes(id))) return false;
    withTransaction(this.database, (database) => {
      const update = database.prepare('UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?');
      requestedIds.forEach((imageId, index) => update.run(index, imageId, productId));
    });
    return true;
  }

  listCustomerProducts(filters: { query?: string; name?: string; sku?: string; specification?: string } = {}) {
    const values: SqlValue[] = [];
    const conditions: string[] = [];
    const query = filters.query?.trim();
    if (query) {
      conditions.push('(name LIKE ? OR sku LIKE ? OR specification LIKE ?)');
      values.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    for (const [field, value] of [
      ['name', filters.name],
      ['sku', filters.sku],
      ['specification', filters.specification],
    ] as const) {
      if (value?.trim()) {
        conditions.push(`${field} LIKE ?`);
        values.push(`%${value.trim()}%`);
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.database
      .prepare(`SELECT * FROM customer_products ${where} ORDER BY updated_at DESC, id DESC`)
      .all(...values)
      .map((row) => {
        const packaging = JSON.parse(String(row.packaging_json)).map((item: PackagingInputLike) => mapPackagingRecord(item));
        return { ...row, packaging, packCount: Number(packaging[0]?.packCount ?? 1) };
      });
  }

  saveCustomerProduct(input: CustomerProductInput, productId?: number) {
    const timestamp = now();
    const existing = productId
      ? this.database.prepare('SELECT packaging_json, remark FROM customer_products WHERE id = ?').get(productId) as Record<string, unknown> | undefined
      : undefined;
    const existingPackaging = existing?.packaging_json
      ? (JSON.parse(String(existing.packaging_json)) as PackagingInputLike[])
        .map((item) => mapPackagingRecord(item))
      : undefined;
    const packaging = input.packaging?.length
      ? normalizePackaging(input.packaging, { packCount: input.packCount ?? input.packaging[0]?.packCount ?? 1 })
      : existingPackaging?.length
        ? existingPackaging.map((item, index) => index === 0 && input.packCount != null
          ? { ...item, packCount: Math.trunc(input.packCount) }
          : item)
        : normalizePackaging(undefined, { name: '', packCount: input.packCount ?? 1 });
    const remark = input.remark === undefined ? String(existing?.remark ?? '') : input.remark;
    if (productId) {
      this.database
        .prepare(
          `UPDATE customer_products SET name = ?, sku = ?, specification = ?, packaging_json = ?, remark = ?, updated_at = ? WHERE id = ?`,
        )
        .run(input.name.trim(), input.sku ?? '', input.specification ?? '', json(packaging), remark, timestamp, productId);
      return this.listCustomerProducts().find((product) => rowId(product) === productId);
    }
    const id = lastInsertId(
      this.database
        .prepare(
          `INSERT INTO customer_products (name, sku, specification, packaging_json, remark, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.name.trim(), input.sku ?? '', input.specification ?? '', json(packaging), remark, timestamp, timestamp),
    );
    return this.listCustomerProducts().find((product) => rowId(product) === id);
  }

  deleteCustomerProduct(productId: number): void {
    this.database.prepare('DELETE FROM customer_products WHERE id = ?').run(productId);
  }

  getCustomerProduct(productId: number) {
    return this.listCustomerProducts().find((product) => rowId(product) === productId);
  }

  createOrder(input: CreateOrderInput) {
    const timestamp = now();
    const status = input.isDraft ? 'draft' : 'pending_stock';
    const settlementType = input.settlementType === 'personal' ? 'personal' : 'corporate';
    return withTransaction(this.database, (database) => {
      const orderNo = input.orderNo.trim() || this.orderNumbers.next();
      const amountCents = input.amountCents ?? Math.round((input.amount ?? 0) * 100);
      const orderId = lastInsertId(
        database
          .prepare(
        `INSERT INTO orders
          (customer_id, customer_name, customer_contact_name, customer_contact_phone, customer_shipping_info,
           order_no, ordered_at, recipient_name, recipient_info, amount, amount_cents, shipping_cents,
           logistics_cost_cents, label_cost_cents, other_cost_cents, other_cost_note, cost_confirmed,
           tracking_no, payment_note, order_detail, remark, status, channel, source_sales_document_id, settlement_type,
           company_id, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
          .run(
            input.customerId ?? null,
            input.customerName ?? '',
            input.customerContactName ?? '',
            input.customerContactPhone ?? '',
            input.customerShippingInfo ?? '',
            orderNo,
            input.orderedAt,
            input.recipientName ?? '',
            input.recipientInfo ?? '',
            input.amount ?? amountCents / 100,
            amountCents,
            input.shippingCents ?? 0,
            input.logisticsCostCents ?? null,
            input.labelCostCents ?? null,
            input.otherCostCents ?? null,
            input.otherCostNote ?? '',
            input.costConfirmed ? 1 : 0,
            input.trackingNo ?? '',
            input.paymentNote ?? '',
            input.orderDetail ?? '',
            input.remark ?? '',
            status,
            input.channel ?? 'offline',
            input.sourceSalesDocumentId ?? null,
            settlementType,
            input.companyId ?? null,
            timestamp,
            timestamp,
            input.createdBy ?? '',
          ),
      );
      database.prepare(`
        INSERT INTO order_finance
          (order_id, receivable_cents, received_cents, outstanding_cents, payment_status, proof_status, invoice_status, created_at, updated_at)
        VALUES (?, ?, 0, ?, 'unpaid', 'none', 'not_requested', ?, ?)
      `).run(orderId, amountCents, amountCents, timestamp, timestamp);

      const itemIds: number[] = [];
      const insertItem = database.prepare(
        `INSERT INTO order_items
          (order_id, customer_product_id, product_id, name, sku, specification, packaging_name, pack_count, quantity,
           unit_price_cents, amount_cents, freight_per_box_cents, remark, label_requirement,
           machine_cost_cents, battery_cost_cents, charger_cost_cents, packaging_cost_cents,
           accessory_cost_cents, other_cost_cents, cost_confirmed,
           sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertBoxSize = database.prepare(
        `INSERT INTO order_item_box_sizes
          (order_item_id, packaging_name, outer_length, outer_width, outer_height, outer_weight, pack_count, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertOrderAttachment = database.prepare(`
        INSERT INTO order_contracts
          (order_id, category, source_customer_product_id, relative_path, original_name, mime_type, size_bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const attachment of input.orderAttachments ?? []) {
        insertOrderAttachment.run(orderId, attachment.category, attachment.sourceCustomerProductId ?? null, attachment.relativePath, attachment.originalName, attachment.mimeType, attachment.size, timestamp);
      }

      input.items.forEach((item, itemIndex) => {
        const packaging = normalizePackaging(item.packaging, {
          name: item.packagingName,
          packCount: item.packCount ?? 1,
        });
        const itemId = lastInsertId(
          insertItem.run(
            orderId,
            item.customerProductId ?? null,
            item.productId ?? null,
            item.name,
            item.sku ?? '',
            item.specification ?? '',
            packaging[0]?.name ?? item.packagingName ?? '',
            packaging[0]?.packCount ?? item.packCount ?? 1,
            item.quantity,
            item.unitPriceCents ?? 0,
            item.amountCents ?? Math.round(item.quantity * (item.unitPriceCents ?? 0)),
            item.freightPerBoxCents ?? 0,
            item.remark ?? '',
            item.labelRequirement ?? '',
            item.machineCostCents ?? null,
            item.batteryCostCents ?? null,
            item.chargerCostCents ?? null,
            item.packagingCostCents ?? null,
            item.accessoryCostCents ?? null,
            item.otherCostCents ?? null,
            item.costConfirmed ? 1 : 0,
            itemIndex,
            timestamp,
            timestamp,
          ),
        );
        itemIds.push(itemId);
        packaging.forEach((size, sizeIndex) => {
          insertBoxSize.run(
            itemId,
            size.name ?? '',
            numberOrZero(size.outerLength),
            numberOrZero(size.outerWidth),
            numberOrZero(size.outerHeight),
            numberOrZero(size.outerWeight),
            Math.trunc(size.packCount),
            sizeIndex,
          );
        });
      });

      this.createAutomaticLabels(database, orderId, input.items, itemIds, timestamp);
      return this.getOrderDetail(orderId);
    });
  }

  updateOrder(orderId: number, input: UpdateOrderInput, options: { preserveItems?: boolean } = {}) {
    const timestamp = now();
    const settlementType = input.settlementType === 'personal' ? 'personal' : 'corporate';
    return withTransaction(this.database, (database) => {
      const existing = database.prepare(`SELECT id, order_detail, channel, logistics_cost_cents, label_cost_cents, other_cost_cents, other_cost_note, cost_confirmed
        FROM orders WHERE id = ?`).get(orderId) as Record<string, unknown> | undefined;
      if (!existing) return undefined;
      const previousItems = database.prepare(`SELECT id, name, sku, specification, pack_count, quantity, remark, label_requirement,
        machine_cost_cents, battery_cost_cents, charger_cost_cents,
        packaging_cost_cents, accessory_cost_cents, other_cost_cents, cost_confirmed
        FROM order_items WHERE order_id = ? ORDER BY sort_order, id`).all(orderId) as Array<Record<string, unknown>>;
      const preserveNullableCost = (value: number | null | undefined, previous: unknown): number | null => {
        if (value !== undefined) return value;
        return previous == null ? null : Number(previous);
      };
      const logisticsCostCents = preserveNullableCost(input.logisticsCostCents, existing.logistics_cost_cents);
      const labelCostCents = preserveNullableCost(input.labelCostCents, existing.label_cost_cents);
      const otherCostCents = preserveNullableCost(input.otherCostCents, existing.other_cost_cents);
      const otherCostNote = input.otherCostNote === undefined ? String(existing.other_cost_note ?? '') : input.otherCostNote;
      const orderCostConfirmed = input.costConfirmed === undefined ? Boolean(existing.cost_confirmed) : input.costConfirmed;

      const amountCents = input.amountCents ?? Math.round((input.amount ?? 0) * 100);

      database
        .prepare(
          `UPDATE orders SET customer_id = ?, customer_name = ?, customer_contact_name = ?, customer_contact_phone = ?,
            customer_shipping_info = ?, order_no = ?, ordered_at = ?,
            recipient_name = ?, recipient_info = ?, amount = ?, amount_cents = ?, shipping_cents = ?,
            logistics_cost_cents = ?, label_cost_cents = ?, other_cost_cents = ?, other_cost_note = ?, cost_confirmed = ?,
            tracking_no = ?, payment_note = ?, order_detail = ?, remark = ?, channel = ?, settlement_type = ?, company_id = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          input.customerId ?? null,
          input.customerName ?? '',
          input.customerContactName ?? '',
          input.customerContactPhone ?? '',
          input.customerShippingInfo ?? '',
          input.orderNo.trim(),
          input.orderedAt,
          input.recipientName ?? '',
          input.recipientInfo ?? '',
          input.amount ?? amountCents / 100,
          amountCents,
          input.shippingCents ?? 0,
          logisticsCostCents,
          labelCostCents,
          otherCostCents,
          otherCostNote,
          orderCostConfirmed ? 1 : 0,
          input.trackingNo ?? '',
          input.paymentNote ?? '',
          input.orderDetail ?? '',
          input.remark ?? '',
          input.channel ?? String(existing.channel ?? 'offline'),
          settlementType,
          input.companyId ?? null,
          timestamp,
          orderId,
        );

      // 订单金额变动时同步财务快照，保证应收/未收/付款状态与订单实时一致
      const financeRow = database.prepare('SELECT received_cents FROM order_finance WHERE order_id = ?').get(orderId) as { received_cents?: unknown } | undefined;
      if (financeRow) {
        const receivedCents = Number(financeRow.received_cents ?? 0);
        database.prepare(`
          UPDATE order_finance SET receivable_cents = ?, outstanding_cents = ?, payment_status = ?, updated_at = ?
          WHERE order_id = ?
        `).run(amountCents, calculateOutstandingCents(amountCents, receivedCents), deriveFinancePaymentStatus(amountCents, receivedCents), timestamp, orderId);
      }

      if (options.preserveItems) {
        const insertAttachment = database.prepare(`
          INSERT OR IGNORE INTO order_contracts
            (order_id, category, source_customer_product_id, relative_path, original_name, mime_type, size_bytes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const attachment of input.orderAttachments ?? []) {
          insertAttachment.run(orderId, attachment.category, attachment.sourceCustomerProductId ?? null, attachment.relativePath, attachment.originalName, attachment.mimeType, attachment.size, timestamp);
        }
        const updateItemCosts = database.prepare(`
          UPDATE order_items SET machine_cost_cents = ?, battery_cost_cents = ?, charger_cost_cents = ?,
            packaging_cost_cents = ?, accessory_cost_cents = ?, other_cost_cents = ?, cost_confirmed = ?, updated_at = ?
          WHERE id = ? AND order_id = ?
        `);
        input.items.forEach((item, index) => {
          const previousItem = previousItems[index];
          if (!previousItem) return;
          updateItemCosts.run(
            item.machineCostCents ?? null,
            item.batteryCostCents ?? null,
            item.chargerCostCents ?? null,
            item.packagingCostCents ?? null,
            item.accessoryCostCents ?? null,
            item.otherCostCents ?? null,
            item.costConfirmed ? 1 : 0,
            timestamp,
            Number(previousItem.id),
            orderId,
          );
        });
        return this.getOrderDetail(orderId);
      }

      // 明细、数量、装箱数、箱唛要求没变时保留现有箱唛，避免只改备注/附件/价格就丢手工合箱。
      const previousItemIds = previousItems.map((item) => Number(item.id));
      const previousBoxRows = database.prepare(
        `SELECT order_item_id, pack_count FROM order_item_box_sizes
         WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)
         ORDER BY sort_order, id`,
      ).all(orderId) as Array<Record<string, unknown>>;
      const previousPackSizes = new Map<number, number[]>();
      previousBoxRows.forEach((row) => {
        const itemId = Number(row.order_item_id);
        const sizes = previousPackSizes.get(itemId) ?? [];
        sizes.push(Math.trunc(Number(row.pack_count)));
        previousPackSizes.set(itemId, sizes);
      });
      const previousLabelSignature = labelSignature(String(existing.order_detail ?? ''), previousItems.map((item) => {
        const sizes = previousPackSizes.get(Number(item.id)) ?? [];
        return {
          name: String(item.name ?? ''),
          sku: String(item.sku ?? ''),
          specification: String(item.specification ?? ''),
          quantity: Math.trunc(Number(item.quantity ?? 1)),
          packSizes: sizes.length ? sizes : [Math.max(1, Math.trunc(Number(item.pack_count ?? 1)))],
          requirement: cartonLabelRequirement({ labelRequirement: String(item.label_requirement ?? ''), remark: String(item.remark ?? '') }),
        };
      }));
      const nextLabelSignature = labelSignature(String(input.orderDetail ?? ''), input.items.map((item) => ({
        name: item.name,
        sku: item.sku ?? '',
        specification: item.specification ?? '',
        quantity: Math.trunc(item.quantity),
        packSizes: effectivePackSizes(item.packaging, item.packCount),
        requirement: cartonLabelRequirement({ labelRequirement: item.labelRequirement, remark: item.remark }),
      })));
      const labelCount = Number((database.prepare('SELECT COUNT(*) AS count FROM carton_labels WHERE order_id = ?').get(orderId) as { count?: unknown } | undefined)?.count ?? 0);
      const keepLabels = labelCount > 0 && previousLabelSignature === nextLabelSignature;
      const savedLabelLinks = keepLabels
        ? database.prepare(
          `SELECT cli.id, cli.order_item_id FROM carton_label_items cli
           JOIN carton_labels cl ON cl.id = cli.carton_label_id
           WHERE cl.order_id = ? AND cli.order_item_id IS NOT NULL`,
        ).all(orderId) as Array<Record<string, unknown>>
        : [];
      if (!keepLabels) database.prepare('DELETE FROM carton_labels WHERE order_id = ?').run(orderId);
      database.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);

      const itemIds: number[] = [];
      const insertItem = database.prepare(
        `INSERT INTO order_items
          (order_id, customer_product_id, product_id, name, sku, specification, packaging_name, pack_count, quantity,
           unit_price_cents, amount_cents, freight_per_box_cents, remark, label_requirement,
           machine_cost_cents, battery_cost_cents, charger_cost_cents, packaging_cost_cents,
           accessory_cost_cents, other_cost_cents, cost_confirmed,
           sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertBoxSize = database.prepare(
        `INSERT INTO order_item_box_sizes
          (order_item_id, packaging_name, outer_length, outer_width, outer_height, outer_weight, pack_count, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertOrderAttachment = database.prepare(`
        INSERT OR IGNORE INTO order_contracts
          (order_id, category, source_customer_product_id, relative_path, original_name, mime_type, size_bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const attachment of input.orderAttachments ?? []) {
        insertOrderAttachment.run(orderId, attachment.category, attachment.sourceCustomerProductId ?? null, attachment.relativePath, attachment.originalName, attachment.mimeType, attachment.size, timestamp);
      }

      input.items.forEach((item, itemIndex) => {
        const previousItem = previousItems[itemIndex] ?? {};
        const itemCostConfirmed = item.costConfirmed === undefined ? Boolean(previousItem.cost_confirmed) : item.costConfirmed;
        const packaging = normalizePackaging(item.packaging, {
          name: item.packagingName,
          packCount: item.packCount ?? 1,
        });
        const itemId = lastInsertId(
          insertItem.run(
            orderId,
            item.customerProductId ?? null,
            item.productId ?? null,
            item.name,
            item.sku ?? '',
            item.specification ?? '',
            packaging[0]?.name ?? item.packagingName ?? '',
            packaging[0]?.packCount ?? item.packCount ?? 1,
            item.quantity,
            item.unitPriceCents ?? 0,
            item.amountCents ?? Math.round(item.quantity * (item.unitPriceCents ?? 0)),
            item.freightPerBoxCents ?? 0,
            item.remark ?? '',
            item.labelRequirement ?? '',
            preserveNullableCost(item.machineCostCents, previousItem.machine_cost_cents),
            preserveNullableCost(item.batteryCostCents, previousItem.battery_cost_cents),
            preserveNullableCost(item.chargerCostCents, previousItem.charger_cost_cents),
            preserveNullableCost(item.packagingCostCents, previousItem.packaging_cost_cents),
            preserveNullableCost(item.accessoryCostCents, previousItem.accessory_cost_cents),
            preserveNullableCost(item.otherCostCents, previousItem.other_cost_cents),
            itemCostConfirmed ? 1 : 0,
            itemIndex,
            timestamp,
            timestamp,
          ),
        );
        itemIds.push(itemId);
        packaging.forEach((size, sizeIndex) => {
          insertBoxSize.run(
            itemId,
            size.name ?? '',
            numberOrZero(size.outerLength),
            numberOrZero(size.outerWidth),
            numberOrZero(size.outerHeight),
            numberOrZero(size.outerWeight),
            Math.trunc(size.packCount),
            sizeIndex,
          );
        });
      });

      if (keepLabels) {
        const updateLabelItemSource = database.prepare('UPDATE carton_label_items SET order_item_id = ? WHERE id = ?');
        savedLabelLinks.forEach((link) => {
          const index = previousItemIds.indexOf(Number(link.order_item_id));
          const nextItemId = index >= 0 ? itemIds[index] : undefined;
          if (nextItemId != null) updateLabelItemSource.run(nextItemId, Number(link.id));
        });
      } else {
        this.createAutomaticLabels(database, orderId, input.items, itemIds, timestamp);
      }
      return this.getOrderDetail(orderId);
    });
  }

  deleteOrder(orderId: number): { deleted: boolean; filePaths: string[] } {
    return withTransaction(this.database, (database) => {
      const filePaths = [
        ...database.prepare('SELECT relative_path FROM order_contracts WHERE order_id = ?').all(orderId),
        ...database.prepare('SELECT relative_path FROM payment_proofs WHERE order_id = ?').all(orderId),
        ...database.prepare('SELECT relative_path FROM order_detail_images WHERE order_id = ?').all(orderId),
        // 发票文件挂在 finance_invoices 下，随订单级联删除前必须先收集物理路径。
        ...database.prepare(`
          SELECT f.relative_path FROM finance_invoice_files f
          JOIN finance_invoices i ON i.id = f.invoice_id
          WHERE i.order_id = ?
        `).all(orderId),
      ].map((row) => String(row.relative_path ?? '')).filter(Boolean);
      // 发货记录与批次明细对订单是 RESTRICT 外键，不会随订单级联删除，必须先显式清理。
      database.prepare('DELETE FROM shipment_batch_orders WHERE order_id = ?').run(orderId);
      database.prepare('DELETE FROM shipments WHERE order_id = ?').run(orderId);
      const result = database.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
      return { deleted: Number(result.changes ?? 0) > 0, filePaths };
    });
  }

  updateOrderStatus(orderId: number, status: string): boolean {
    const result = this.database
      .prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now(), orderId);
    return Number(result.changes ?? 0) > 0;
  }

  /** 订单详情用的轻量财务摘要，避免详情页加载全部水单/发票附件。 */
  getOrderFinanceLocks(orderId: number): { hasReceipt: boolean; hasValidInvoice: boolean; validInvoiceCents: number } {
    const row = this.database.prepare(`
      SELECT
        EXISTS(SELECT 1 FROM finance_receipts WHERE order_id = ?) AS has_receipt,
        EXISTS(SELECT 1 FROM finance_invoices WHERE order_id = ? AND status <> 'void') AS has_valid_invoice,
        COALESCE((SELECT SUM(amount_cents) FROM finance_invoices WHERE order_id = ? AND status <> 'void'), 0) AS valid_invoice_cents
    `).get(orderId, orderId, orderId);
    return {
      hasReceipt: Number(row?.has_receipt ?? 0) === 1,
      hasValidInvoice: Number(row?.has_valid_invoice ?? 0) === 1,
      validInvoiceCents: Number(row?.valid_invoice_cents ?? 0),
    };
  }

  getOrderFinanceSummary(orderId: number) {
    return this.database.prepare(`
      SELECT order_id, receivable_cents, received_cents, outstanding_cents,
        payment_status, proof_status, invoice_status, updated_at
      FROM order_finance WHERE order_id = ?
    `).get(orderId);
  }

  updateOrderStatusWithTracking(orderId: number, status: string, trackingNo: string): boolean {
    const result = this.database
      .prepare('UPDATE orders SET status = ?, tracking_no = ?, updated_at = ? WHERE id = ?')
      .run(status, trackingNo.trim(), now(), orderId);
    return Number(result.changes ?? 0) > 0;
  }

  /** 只回填物流单号、不动状态：发货中视图里暂存单号用。 */
  updateOrderTracking(orderId: number, trackingNo: string): boolean {
    const result = this.database
      .prepare('UPDATE orders SET tracking_no = ?, updated_at = ? WHERE id = ?')
      .run(trackingNo.trim(), now(), orderId);
    return Number(result.changes ?? 0) > 0;
  }

  private createAutomaticLabels(
    database: DatabaseSync,
    orderId: number,
    items: OrderItemInput[],
    itemIds: number[],
    timestamp: string,
  ): void {
    const orderDetail = String((database.prepare('SELECT order_detail FROM orders WHERE id = ?').get(orderId) as { order_detail?: unknown } | undefined)?.order_detail ?? '');
    const packed = autoPack(items.map((item, index) => {
      const sizes = normalizePackaging(item.packaging, {
        name: item.packagingName,
        packCount: item.packCount ?? 1,
      }).map((size) => Math.trunc(size.packCount)).filter((size) => size > 0);
      return {
        id: String(itemIds[index] ?? index + 1),
        orderId: String(orderId),
        productName: item.name,
        sku: item.sku ?? '',
        spec: item.specification ?? '',
        quantity: Math.trunc(item.quantity),
        packSizes: sizes.length ? sizes : [Math.max(1, Math.trunc(item.packCount ?? 1))],
        remark: cartonLabelRequirement(item),
        orderRemark: orderDetail,
      };
    }));

    const grouped = new Map<string, PackedBox[]>();
    packed.forEach((box) => {
      const key = `${box.orderId ?? ''}\u0000${box.sku}\u0000${box.spec}`;
      const current = grouped.get(key) ?? [];
      current.push(box);
      grouped.set(key, current);
    });

    const totalBoxes = packed.length;
    const insertLabel = database.prepare(
      `INSERT INTO carton_labels (order_id, box_no, total_boxes, manual_edited, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
    );
    const insertLabelItem = database.prepare(
      `INSERT INTO carton_label_items
        (carton_label_id, order_item_id, name, sku, specification, pack_count, box_count, total_count, remark, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    packed.forEach((box, index) => {
      const labelId = lastInsertId(insertLabel.run(orderId, index + 1, totalBoxes, timestamp, timestamp));
      const lines = box.tailItems?.length ? box.tailItems : [{
        sourceItemId: box.sourceItemIds[0],
        productName: box.productName,
        sku: box.sku,
        spec: box.spec,
        quantity: box.quantity,
        packSize: box.packSize,
        boxCount: box.boxCount ?? 1,
        totalQuantity: box.totalQuantity,
        remark: box.productRemark,
      }];
      lines.forEach((line, lineIndex) => {
        const sourceId = Number(line.sourceItemId);
        const itemId = Number.isSafeInteger(sourceId) ? sourceId : null;
        insertLabelItem.run(
          labelId,
          itemId,
          line.productName,
          line.sku,
          line.spec,
          Math.max(1, Math.trunc(line.packSize)),
          Math.max(1, Math.trunc(line.boxCount ?? 1)),
          Math.max(1, Math.trunc(line.quantity)),
          line.remark ?? '',
          lineIndex,
        );
      });
    });
  }

  listOrders(filters: OrderListFilters = {}) {
    const page = Math.max(1, Math.trunc(filters.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Math.trunc(filters.pageSize ?? 50)));
    const query = (filters.query ?? filters.q)?.trim();
    const values: SqlValue[] = [];
    const conditions: string[] = [];
    if (filters.status) {
      conditions.push('o.status = ?');
      values.push(filters.status);
    }
    if (filters.channel) {
      conditions.push('o.channel = ?');
      values.push(filters.channel);
    }
    if (query) {
      conditions.push(`(
        o.order_no LIKE ? OR o.customer_name LIKE ? OR o.recipient_name LIKE ? OR
        o.recipient_info LIKE ? OR EXISTS (
          SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND
            (oi.name LIKE ? OR oi.sku LIKE ? OR oi.specification LIKE ?)
        )
      )`);
      values.push(...Array(7).fill(`%${query}%`));
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const count = Number(this.database.prepare(`SELECT COUNT(*) AS count FROM orders o ${where}`).get(...values)?.count ?? 0);
    const rows = this.database
      .prepare(
        `SELECT o.*, COALESCE(NULLIF(c.full_name, ''), c.short_name) AS company_name,
          COALESCE(o.label_printed_at, (SELECT MAX(ph.printed_at) FROM print_histories ph JOIN print_history_labels phl ON phl.print_history_id = ph.id WHERE phl.order_id = o.id)) AS label_printed_at,
          COALESCE((SELECT SUM(cli.total_count) FROM carton_labels cl JOIN carton_label_items cli ON cli.carton_label_id = cl.id WHERE cl.order_id = o.id), 0) AS total_quantity,
          COALESCE((SELECT MAX(cl.total_boxes) FROM carton_labels cl WHERE cl.order_id = o.id), 0) AS total_boxes
         FROM orders o LEFT JOIN companies c ON c.id = o.company_id ${where}
         ORDER BY o.ordered_at DESC, o.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...values, pageSize, (page - 1) * pageSize);
    return { rows, total: count, page, pageSize };
  }

  getOrderDetail(orderId: number) {
    const order = this.database.prepare(`
      SELECT o.*, COALESCE(NULLIF(c.full_name, ''), c.short_name) AS company_name
      FROM orders o LEFT JOIN companies c ON c.id = o.company_id
      WHERE o.id = ?
    `).get(orderId);
    if (!order) return undefined;
    const items = this.database
      .prepare(
        `SELECT oi.*, COALESCE((SELECT json_group_array(json_object(
          'id', s.id, 'name', s.packaging_name, 'outerLength', s.outer_length,
          'outerWidth', s.outer_width, 'outerHeight', s.outer_height,
          'outerWeight', s.outer_weight, 'packCount', s.pack_count, 'sortOrder', s.sort_order
        )) FROM order_item_box_sizes s WHERE s.order_item_id = oi.id ORDER BY s.sort_order), '[]') AS packaging_json
         FROM order_items oi WHERE oi.order_id = ? ORDER BY oi.sort_order, oi.id`,
      )
      .all(orderId)
      .map((row) => ({
        ...row,
        packaging: JSON.parse(String(row.packaging_json)),
      }));
    const labels = this.database
      .prepare(
        `SELECT cl.*, COALESCE((SELECT json_group_array(json_object(
          'id', cli.id, 'orderItemId', cli.order_item_id, 'name', cli.name, 'sku', cli.sku,
          'specification', cli.specification, 'packCount', cli.pack_count,
          'boxCount', cli.box_count, 'totalCount', cli.total_count, 'remark', cli.remark, 'sortOrder', cli.sort_order
        )) FROM carton_label_items cli WHERE cli.carton_label_id = cl.id ORDER BY cli.sort_order, cli.id), '[]') AS items_json
         FROM carton_labels cl WHERE cl.order_id = ? ORDER BY cl.box_no`,
      )
      .all(orderId)
      .map((row) => ({ ...row, manualEdited: Boolean(row.manual_edited), items: JSON.parse(String(row.items_json)) }));
    const proofs = this.database.prepare('SELECT * FROM payment_proofs WHERE order_id = ? ORDER BY created_at, id').all(orderId);
    const contracts = this.listOrderContracts(orderId);
    const orderDetailImages = this.listOrderDetailImages(orderId);
    return { ...order, items, labels, paymentProofs: proofs, contracts, orderDetailImages };
  }

  getOrderItemImages(orderId: number): Record<number, Array<{ url: string; name: string; mimeType: string }>> {
    const rows = this.database
      .prepare(
        `SELECT oi.id AS order_item_id,
            cp.id AS cp_id, cp.image_cleared AS cp_image_cleared,
            NULLIF(trim(cp.image_relative_path), '') AS cp_image,
            pi.relative_path AS pi_relative_path, pi.original_name, pi.mime_type
         FROM order_items oi
         LEFT JOIN customer_products cp ON cp.id = oi.customer_product_id
         LEFT JOIN product_images pi ON pi.product_id = CASE WHEN cp.id IS NOT NULL THEN cp.system_product_id ELSE oi.product_id END
         WHERE oi.order_id = ?
         ORDER BY oi.id, pi.sort_order, pi.id`,
      )
      .all(orderId) as Array<{
        order_item_id: number;
        cp_id: number | null;
        cp_image_cleared: number | null;
        cp_image: string | null;
        pi_relative_path: string | null;
        original_name: string | null;
        mime_type: string | null;
      }>;
    const result: Record<number, Array<{ url: string; name: string; mimeType: string }>> = {};
    for (const row of rows) {
      if (!result[row.order_item_id]) result[row.order_item_id] = [];
      if (result[row.order_item_id].length >= 5) continue;
      const linked = row.cp_id != null;
      // 客户产品已主动清除图片：尊重清除，不回退系统图。
      if (linked && Number(row.cp_image_cleared) === 1) continue;
      const own = linked && row.cp_image && row.cp_image.trim() ? row.cp_image.trim() : null;
      // 客户产品自有图优先且只用自有图；无自有图（或未挂客户产品）时用系统产品图。
      if (own) {
        if (!result[row.order_item_id].length) {
          result[row.order_item_id].push({ url: `/files/${own}`, name: '', mimeType: 'image/png' });
        }
        continue;
      }
      if (!row.pi_relative_path) continue;
      result[row.order_item_id].push({
        url: `/files/${row.pi_relative_path}`,
        name: String(row.original_name ?? ''),
        mimeType: String(row.mime_type ?? 'image/png'),
      });
    }
    return result;
  }

  /** 在同一连接上开事务，供跨仓储的原子操作（如临时客户转正）使用。 */
  runInTransaction<T>(callback: () => T): T {
    return withTransaction(this.database, () => callback());
  }

  /** 列出某临时客户名称下尚未挂接正式客户的订单（含草稿，不分创建人），供转正预览与挂接。 */
  listTemporaryOrdersByName(name: string): Array<{ id: number; orderNo: string; customerName: string; status: string }> {
    const rows = this.database.prepare(`
      SELECT id, order_no, customer_name, status FROM orders
      WHERE customer_id IS NULL AND lower(trim(customer_name)) = lower(trim(?))
      ORDER BY ordered_at DESC, id DESC
    `).all(name) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      orderNo: String(row.order_no ?? ''),
      customerName: String(row.customer_name ?? ''),
      status: String(row.status ?? ''),
    }));
  }

  /** 把未挂客户的订单挂接到正式客户；只改 customer_id，不刷新 updated_at，避免打乱列表排序。 */
  linkOrdersToCustomer(orderIds: number[], customerId: number): number {
    if (!orderIds.length) return 0;
    const placeholders = orderIds.map(() => '?').join(',');
    const result = this.database.prepare(`
      UPDATE orders SET customer_id = ? WHERE customer_id IS NULL AND id IN (${placeholders})
    `).run(customerId, ...orderIds);
    return Number(result.changes);
  }

  listPaymentProofs(orderId: number) {
    return this.database
      .prepare('SELECT * FROM payment_proofs WHERE order_id = ? ORDER BY created_at, id')
      .all(orderId);
  }

  addPaymentProof(
    orderId: number,
    input: { relativePath: string; originalName: string; mimeType: string; size: number; note?: string },
  ) {
    const id = lastInsertId(
      this.database
        .prepare(
          `INSERT INTO payment_proofs
            (order_id, relative_path, original_name, mime_type, size_bytes, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(orderId, input.relativePath, input.originalName, input.mimeType, input.size, input.note ?? '', now()),
    );
    return this.database.prepare('SELECT * FROM payment_proofs WHERE id = ?').get(id);
  }

  getPaymentProof(proofId: number) {
    return this.database.prepare('SELECT * FROM payment_proofs WHERE id = ?').get(proofId);
  }

  deletePaymentProof(proofId: number): { relativePath: string; orderId: number } | undefined {
    const proof = this.database
      .prepare('SELECT relative_path, order_id FROM payment_proofs WHERE id = ?')
      .get(proofId) as { relative_path?: unknown; order_id?: unknown } | undefined;
    if (!proof) return undefined;
    this.database.prepare('DELETE FROM payment_proofs WHERE id = ?').run(proofId);
    return { relativePath: String(proof.relative_path ?? ''), orderId: Number(proof.order_id) };
  }

  listOrderDetailImages(orderId: number) {
    return this.database
      .prepare('SELECT * FROM order_detail_images WHERE order_id = ? ORDER BY created_at, id')
      .all(orderId);
  }

  addOrderDetailImage(
    orderId: number,
    input: { relativePath: string; originalName: string; mimeType: string; size: number },
  ) {
    const id = lastInsertId(
      this.database
        .prepare(
          `INSERT INTO order_detail_images
            (order_id, relative_path, original_name, mime_type, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(orderId, input.relativePath, input.originalName, input.mimeType, input.size, now()),
    );
    return this.database.prepare('SELECT * FROM order_detail_images WHERE id = ?').get(id);
  }

  getOrderDetailImage(imageId: number) {
    return this.database.prepare('SELECT * FROM order_detail_images WHERE id = ?').get(imageId);
  }

  deleteOrderDetailImage(imageId: number): { relativePath: string; orderId: number } | undefined {
    const image = this.database
      .prepare('SELECT relative_path, order_id FROM order_detail_images WHERE id = ?')
      .get(imageId) as { relative_path?: unknown; order_id?: unknown } | undefined;
    if (!image) return undefined;
    this.database.prepare('DELETE FROM order_detail_images WHERE id = ?').run(imageId);
    return { relativePath: String(image.relative_path ?? ''), orderId: Number(image.order_id) };
  }

  listOrderContracts(orderId: number) {
    return this.database
      .prepare('SELECT * FROM order_contracts WHERE order_id = ? ORDER BY created_at DESC, id DESC')
      .all(orderId);
  }

  addOrderContract(
    orderId: number,
    input: { relativePath: string; originalName: string; mimeType: string; size: number; category?: string; sourceCustomerProductId?: number | null },
  ) {
    const id = lastInsertId(
      this.database
        .prepare(
          `INSERT INTO order_contracts
            (order_id, category, source_customer_product_id, relative_path, original_name, mime_type, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(orderId, input.category ?? 'other', input.sourceCustomerProductId ?? null, input.relativePath, input.originalName, input.mimeType, input.size, now()),
    );
    return this.database.prepare('SELECT * FROM order_contracts WHERE id = ?').get(id);
  }

  getOrderContract(contractId: number) {
    return this.database.prepare('SELECT * FROM order_contracts WHERE id = ?').get(contractId);
  }

  deleteOrderContract(contractId: number): { relativePath: string; orderId: number } | undefined {
    const contract = this.database
      .prepare('SELECT relative_path, order_id FROM order_contracts WHERE id = ?')
      .get(contractId) as { relative_path?: unknown; order_id?: unknown } | undefined;
    if (!contract) return undefined;
    this.database.prepare('DELETE FROM order_contracts WHERE id = ?').run(contractId);
    return { relativePath: String(contract.relative_path ?? ''), orderId: Number(contract.order_id) };
  }

  getCartonLabel(labelId: number) {
    return this.database
      .prepare(
        `SELECT cl.*, o.order_no, o.recipient_name, o.status
         FROM carton_labels cl JOIN orders o ON o.id = cl.order_id WHERE cl.id = ?`,
      )
      .get(labelId);
  }

  listPrintHistories(orderId?: number) {
    const values: SqlValue[] = [];
    const condition = orderId == null ? '' : 'WHERE phl.order_id = ?';
    if (orderId != null) values.push(orderId);
    return this.database
      .prepare(
        `SELECT ph.id, ph.printed_at, ph.action_type, ph.order_count, ph.label_count,
            phl.order_id, phl.order_no, phl.box_no, phl.total_boxes, phl.snapshot_json
         FROM print_histories ph
         JOIN print_history_labels phl ON phl.print_history_id = ph.id
         ${condition}
         ORDER BY ph.printed_at DESC, ph.id DESC, phl.order_id, phl.box_no`,
      )
      .all(...values)
      .map((row) => ({ ...row, snapshot: JSON.parse(String(row.snapshot_json)) }));
  }

  saveCartonLabels(orderId: number, labels: Array<{ boxNo: number; items: Array<Record<string, unknown>>; manualEdited?: boolean }>): void {
    const timestamp = now();
    withTransaction(this.database, (database) => {
      database.prepare('DELETE FROM carton_labels WHERE order_id = ?').run(orderId);
      const insertLabel = database.prepare(
        `INSERT INTO carton_labels (order_id, box_no, total_boxes, manual_edited, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const insertItem = database.prepare(
        `INSERT INTO carton_label_items (carton_label_id, order_item_id, name, sku, specification, pack_count, box_count, total_count, remark, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      labels.forEach((label, index) => {
        const labelId = lastInsertId(insertLabel.run(orderId, index + 1, labels.length, label.manualEdited ? 1 : 0, timestamp, timestamp));
        label.items.forEach((item, itemIndex) => {
          insertItem.run(
            labelId,
            item.orderItemId == null ? null : Number(item.orderItemId),
            String(item.name ?? ''),
            String(item.sku ?? ''),
            String(item.specification ?? ''),
            Math.trunc(Number(item.packCount ?? 1)),
            Math.trunc(Number(item.boxCount ?? 1)),
            Math.trunc(Number(item.totalCount ?? 0)),
            String(item.remark ?? ''),
            itemIndex,
          );
        });
      });
    });
  }

  recordPrintHistory(input: {
    actionType?: string;
    orderIds: number[];
    labels: Array<{ labelId?: number | null; orderId: number; orderNo: string; boxNo: number; totalBoxes: number; snapshot: unknown }>;
  }): number {
    const printedAt = now();
    return withTransaction(this.database, (database) => {
      const historyId = lastInsertId(
        database
          .prepare('INSERT INTO print_histories (printed_at, action_type, order_count, label_count) VALUES (?, ?, ?, ?)')
          .run(printedAt, input.actionType ?? 'print', input.orderIds.length, input.labels.length),
      );
      const insert = database.prepare(
        `INSERT INTO print_history_labels (print_history_id, label_id, order_id, order_no, box_no, total_boxes, snapshot_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      input.labels.forEach((label) => {
        insert.run(historyId, label.labelId ?? null, label.orderId, label.orderNo, label.boxNo, label.totalBoxes, json(label.snapshot, {}));
      });
      const updatePrintedAt = database.prepare('UPDATE orders SET label_printed_at = ? WHERE id = ?');
      const printedOrderIds = [...new Set(input.labels.map((label) => label.orderId))];
      printedOrderIds.forEach((orderId) => updatePrintedAt.run(printedAt, orderId));
      return historyId;
    });
  }

  createShipmentBatch(orderIds: number[]): number {
    const timestamp = now();
    return withTransaction(this.database, (database) => {
      const batchId = lastInsertId(
        database
          .prepare('INSERT INTO shipment_batches (batch_no, status, created_at) VALUES (?, \'draft\', ?)')
          .run(`BATCH-${timestamp.replace(/[-:TZ.]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`, timestamp),
      );
      const insert = database.prepare(
        'INSERT INTO shipment_batch_orders (batch_id, order_id, sort_order) SELECT ?, id, ? FROM orders WHERE id = ? AND status = \'ship_pending\'',
      );
      orderIds.forEach((orderId, index) => insert.run(batchId, index, orderId));
      return batchId;
    });
  }

  updateShipmentBatchOrder(batchId: number, orderId: number, trackingNo: string): void {
    const result = this.database
      .prepare('UPDATE shipment_batch_orders SET tracking_no = ? WHERE batch_id = ? AND order_id = ?')
      .run(trackingNo.trim(), batchId, orderId);
    if (Number(result.changes ?? 0) === 0) throw new Error('发货批次中不存在该订单');
  }

  getShipmentBatch(batchId: number) {
    const batch = this.database.prepare('SELECT * FROM shipment_batches WHERE id = ?').get(batchId);
    if (!batch) return undefined;
    const orders = this.database
      .prepare(
        `SELECT sbo.id AS batch_order_id, sbo.order_id, sbo.tracking_no, sbo.sort_order,
            o.order_no, o.status, o.recipient_info,
            COALESCE((SELECT MAX(cl.total_boxes) FROM carton_labels cl WHERE cl.order_id = o.id), 0) AS total_boxes
         FROM shipment_batch_orders sbo JOIN orders o ON o.id = sbo.order_id
         WHERE sbo.batch_id = ? ORDER BY sbo.sort_order, sbo.id`,
      )
      .all(batchId);
    return { ...batch, orders };
  }

  /** 旧版整单发货接口：把剩余未发数量全部记入本次发货明细，保持进度与历史一致。 */
  private addFullRemainingShipmentItems(database: DatabaseSync, shipmentId: number, orderId: number, timestamp: string): void {
    const items = database.prepare(
      'SELECT * FROM order_items WHERE order_id = ? AND shipped_quantity < quantity ORDER BY sort_order, id',
    ).all(orderId) as Array<Record<string, unknown>>;
    const insert = database.prepare(`
      INSERT INTO shipment_items
        (shipment_id, order_item_id, name, sku, specification, pack_count, quantity, boxes, remaining_after, remark, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `);
    const update = database.prepare('UPDATE order_items SET shipped_quantity = quantity, updated_at = ? WHERE id = ?');
    items.forEach((item, index) => {
      const quantity = Math.max(0, Number(item.quantity ?? 0) - Number(item.shipped_quantity ?? 0));
      if (quantity <= 0) return;
      const packCount = Math.max(1, Number(item.pack_count ?? 1));
      insert.run(
        shipmentId,
        Number(item.id),
        String(item.name ?? ''),
        String(item.sku ?? ''),
        String(item.specification ?? ''),
        packCount,
        quantity,
        Math.max(1, Math.ceil(quantity / packCount)),
        String(item.remark ?? ''),
        index,
        timestamp,
      );
      update.run(timestamp, Number(item.id));
    });
  }

  private assertShipmentPaymentCleared(order: Record<string, unknown>): void {
    const receivableCents = Number(order.finance_receivable_cents ?? order.amount_cents ?? 0);
    const receivedCents = Number(order.finance_received_cents ?? 0);
    if (!isOrderPaymentCleared(receivableCents, receivedCents)) {
      throw new Error(`订单 ${String(order.order_no ?? '')} 未确认收到货款，不能发货；请先上传并审核水单`);
    }
  }

  confirmShipment(batchId: number): void {
    const timestamp = now();
    withTransaction(this.database, (database) => {
      const batch = database.prepare('SELECT * FROM shipment_batches WHERE id = ?').get(batchId);
      if (!batch) throw new Error('发货批次不存在');
      const orders = database
        .prepare(
          `SELECT sbo.*, o.order_no, o.status, o.recipient_info, o.amount_cents,
            f.receivable_cents AS finance_receivable_cents, f.received_cents AS finance_received_cents,
            COALESCE((SELECT MAX(cl.total_boxes) FROM carton_labels cl WHERE cl.order_id = o.id), 0) AS total_boxes
           FROM shipment_batch_orders sbo JOIN orders o ON o.id = sbo.order_id
           LEFT JOIN order_finance f ON f.order_id = o.id
           WHERE sbo.batch_id = ? ORDER BY sbo.sort_order`,
        )
        .all(batchId);
      if (!orders.length) throw new Error('发货批次没有订单');
      const missing = orders.filter((order) => !String(order.tracking_no ?? '').trim());
      if (missing.length) throw new Error(`以下订单缺少物流单号：${missing.map((order) => order.order_no).join('、')}`);
      const insertShipment = database.prepare(
        `INSERT INTO shipments (order_id, tracking_no, shipped_at, total_boxes, recipient_info, remark) VALUES (?, ?, ?, ?, ?, '')`,
      );
      orders.forEach((order) => {
        if (order.status !== 'ship_pending') throw new Error(`订单 ${order.order_no} 当前不可发货`);
        this.assertShipmentPaymentCleared(order);
        const shipmentId = Number(insertShipment.run(order.order_id, String(order.tracking_no), timestamp, Math.max(1, Number(order.total_boxes)), String(order.recipient_info ?? '')).lastInsertRowid);
        this.addFullRemainingShipmentItems(database, shipmentId, Number(order.order_id), timestamp);
        database.prepare('UPDATE orders SET tracking_no = ?, status = \'shipped\', updated_at = ? WHERE id = ?').run(order.tracking_no, timestamp, order.order_id);
      });
      database.prepare('UPDATE shipment_batches SET status = \'confirmed\', confirmed_at = ? WHERE id = ?').run(timestamp, batchId);
    });
  }

  /** 发货工作区一次提交：建批次、写物流单号、确认发货放在同一个事务里，避免中途失败留下草稿批次。 */
  confirmShipmentDirect(entries: Array<{ orderId: number; trackingNo: string }>): number {
    const timestamp = now();
    const unique = [...new Map(entries.map((entry) => [entry.orderId, entry])).values()];
    if (!unique.length) throw new Error('至少选择一个待发货订单');
    return withTransaction(this.database, (database) => {
      const batchId = lastInsertId(
        database.prepare('INSERT INTO shipment_batches (batch_no, status, created_at) VALUES (?, \'draft\', ?)')
          .run(`BATCH-${timestamp.replace(/[-:TZ.]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`, timestamp),
      );
      const selectOrder = database.prepare(
        `SELECT o.id, o.order_no, o.status, o.recipient_info, o.amount_cents,
          f.receivable_cents AS finance_receivable_cents, f.received_cents AS finance_received_cents,
          COALESCE((SELECT MAX(cl.total_boxes) FROM carton_labels cl WHERE cl.order_id = o.id), 0) AS total_boxes
         FROM orders o LEFT JOIN order_finance f ON f.order_id = o.id WHERE o.id = ?`,
      );
      const insertBatchOrder = database.prepare('INSERT INTO shipment_batch_orders (batch_id, order_id, tracking_no, sort_order) VALUES (?, ?, ?, ?)');
      const insertShipment = database.prepare(
        `INSERT INTO shipments (order_id, tracking_no, shipped_at, total_boxes, recipient_info, remark) VALUES (?, ?, ?, ?, ?, '')`,
      );
      const updateOrder = database.prepare("UPDATE orders SET tracking_no = ?, status = 'shipped', updated_at = ? WHERE id = ?");
      unique.forEach((entry, index) => {
        const order = selectOrder.get(entry.orderId) as Record<string, unknown> | undefined;
        if (!order) throw new Error(`订单不存在：${entry.orderId}`);
        if (order.status !== 'ship_pending') throw new Error(`订单 ${order.order_no} 当前不可发货`);
        const trackingNo = entry.trackingNo.trim();
        if (!trackingNo) throw new Error(`订单 ${order.order_no} 缺少物流单号`);
        this.assertShipmentPaymentCleared(order);
        insertBatchOrder.run(batchId, entry.orderId, trackingNo, index);
        const shipmentId = Number(insertShipment.run(entry.orderId, trackingNo, timestamp, Math.max(1, Number(order.total_boxes)), String(order.recipient_info ?? '')).lastInsertRowid);
        this.addFullRemainingShipmentItems(database, shipmentId, entry.orderId, timestamp);
        updateOrder.run(trackingNo, timestamp, entry.orderId);
      });
      database.prepare("UPDATE shipment_batches SET status = 'confirmed', confirmed_at = ? WHERE id = ?").run(timestamp, batchId);
      return batchId;
    });
  }

  hasOrderShipments(orderId: number): boolean {
    const row = this.database.prepare('SELECT 1 AS found FROM shipments WHERE order_id = ? LIMIT 1').get(orderId);
    return row !== undefined;
  }

  private mapShipmentRow(row: Record<string, unknown>): ShipmentRecord {
    const items = this.database
      .prepare('SELECT * FROM shipment_items WHERE shipment_id = ? ORDER BY sort_order, id')
      .all(Number(row.id)) as Array<Record<string, unknown>>;
    return {
      id: Number(row.id),
      shipmentNo: String(row.shipment_no ?? `FH-${row.id}`),
      orderId: Number(row.order_id),
      orderNo: String(row.order_no ?? ''),
      batchId: row.batch_id == null ? null : Number(row.batch_id),
      batchNo: String(row.batch_no ?? ''),
      trackingNo: String(row.tracking_no ?? ''),
      shippedAt: String(row.shipped_at ?? ''),
      totalBoxes: Math.max(1, Number(row.total_boxes ?? 1)),
      customerName: String(row.customer_name || row.order_customer_name || ''),
      recipientName: String(row.recipient_name || row.order_recipient_name || ''),
      recipientInfo: String(row.recipient_info ?? ''),
      remark: String(row.remark ?? ''),
      companyName: String(row.company_name ?? ''),
      items: items.map((item): ShipmentItemRecord => ({
        id: Number(item.id),
        orderItemId: item.order_item_id == null ? null : Number(item.order_item_id),
        name: String(item.name ?? ''),
        sku: String(item.sku ?? ''),
        specification: String(item.specification ?? ''),
        packCount: Math.max(1, Number(item.pack_count ?? 1)),
        quantity: Math.max(1, Number(item.quantity ?? 1)),
        boxes: Math.max(1, Number(item.boxes ?? 1)),
        remainingAfter: Math.max(0, Number(item.remaining_after ?? 0)),
        remark: String(item.remark ?? ''),
        sortOrder: Number(item.sort_order ?? 0),
      })),
    };
  }

  listOrderShipments(orderId: number): ShipmentRecord[] {
    const rows = this.database
      .prepare(`
        SELECT s.*, o.order_no, o.customer_name AS order_customer_name, o.recipient_name AS order_recipient_name,
          sb.batch_no,
          COALESCE(NULLIF(c.full_name, ''), c.short_name, '') AS company_name
        FROM shipments s
        JOIN orders o ON o.id = s.order_id
        LEFT JOIN shipment_batches sb ON sb.id = s.batch_id
        LEFT JOIN companies c ON c.id = o.company_id
        WHERE s.order_id = ?
        ORDER BY s.shipped_at DESC, s.id DESC
      `)
      .all(orderId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapShipmentRow(row));
  }

  getShipment(shipmentId: number): ShipmentRecord | undefined {
    const row = this.database
      .prepare(`
        SELECT s.*, o.order_no, o.customer_name AS order_customer_name, o.recipient_name AS order_recipient_name,
          sb.batch_no,
          COALESCE(NULLIF(c.full_name, ''), c.short_name, '') AS company_name
        FROM shipments s
        JOIN orders o ON o.id = s.order_id
        LEFT JOIN shipment_batches sb ON sb.id = s.batch_id
        LEFT JOIN companies c ON c.id = o.company_id
        WHERE s.id = ?
      `)
      .get(shipmentId) as Record<string, unknown> | undefined;
    return row ? this.mapShipmentRow(row) : undefined;
  }

  listBatchShipments(batchId: number): ShipmentRecord[] {
    const rows = this.database
      .prepare(`
        SELECT s.*, o.order_no, o.customer_name AS order_customer_name, o.recipient_name AS order_recipient_name,
          sb.batch_no,
          COALESCE(NULLIF(c.full_name, ''), c.short_name, '') AS company_name
        FROM shipments s
        JOIN orders o ON o.id = s.order_id
        LEFT JOIN shipment_batches sb ON sb.id = s.batch_id
        LEFT JOIN companies c ON c.id = o.company_id
        WHERE s.batch_id = ?
        ORDER BY s.id
      `)
      .all(batchId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapShipmentRow(row));
  }

  /** 发货前按当前填写的本次数量生成清单草稿；只读，不写发货记录、不改已发数量。 */
  previewOrderShipment(
    orderId: number,
    entries: Array<{ orderItemId: number; quantity: number }>,
    options: { trackingNo: string; shippedAt: string },
  ): ShipmentRecord | undefined {
    const order = this.database.prepare(`
      SELECT o.order_no, o.status, o.customer_name, o.recipient_name, o.recipient_info,
        COALESCE(NULLIF(c.full_name, ''), c.short_name, '') AS company_name
      FROM orders o LEFT JOIN companies c ON c.id = o.company_id WHERE o.id = ?
    `).get(orderId) as Record<string, unknown> | undefined;
    if (!order) return undefined;
    const orderNo = String(order.order_no ?? '');
    if (order.status !== 'shipping') throw new Error(`订单 ${orderNo} 当前不是发货中状态，不能打印发货清单`);
    const available = new Map((this.database
      .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order, id')
      .all(orderId) as Array<Record<string, unknown>>).map((item) => [Number(item.id), item]));
    const seen = new Set<number>();
    const items: ShipmentItemRecord[] = [];
    for (const entry of entries) {
      if (entry.quantity === 0) continue;
      if (seen.has(entry.orderItemId)) throw new Error(`订单 ${orderNo} 存在重复或无效的产品行`);
      seen.add(entry.orderItemId);
      const item = available.get(entry.orderItemId);
      if (!item) throw new Error(`订单 ${orderNo} 中不存在产品行 ${entry.orderItemId}`);
      const remaining = Math.max(0, Number(item.quantity ?? 0) - Number(item.shipped_quantity ?? 0));
      if (entry.quantity > remaining) throw new Error(`订单 ${orderNo} 的「${String(item.name ?? '')}」最多还能发 ${remaining}`);
      const packCount = Math.max(1, Number(item.pack_count ?? 1));
      items.push({
        id: 0,
        orderItemId: entry.orderItemId,
        name: String(item.name ?? ''),
        sku: String(item.sku ?? ''),
        specification: String(item.specification ?? ''),
        packCount,
        quantity: entry.quantity,
        boxes: Math.max(1, Math.ceil(entry.quantity / packCount)),
        remainingAfter: remaining - entry.quantity,
        remark: String(item.remark ?? ''),
        sortOrder: items.length,
      });
    }
    if (!items.length) throw new Error(`订单 ${orderNo} 没有选择发货产品`);
    return {
      id: 0,
      shipmentNo: '',
      orderId,
      orderNo,
      batchId: null,
      batchNo: '',
      trackingNo: options.trackingNo,
      shippedAt: options.shippedAt,
      totalBoxes: items.reduce((sum, item) => sum + item.boxes, 0),
      customerName: String(order.customer_name ?? ''),
      recipientName: String(order.recipient_name ?? ''),
      recipientInfo: String(order.recipient_info ?? ''),
      remark: '',
      companyName: String(order.company_name ?? ''),
      items,
    };
  }

  /** 一次确认多个订单的部分发货；每单一条物流单号、一条发货记录。 */
  confirmPartialShipments(entries: PartialShipmentEntryInput[]): number {
    const unique = [...new Map(entries.map((entry) => [entry.orderId, entry])).values()];
    if (!unique.length) throw new Error('至少选择一个待发货订单');
    const timestamp = now();
    return withTransaction(this.database, (database) => {
      const batchNo = `BATCH-${timestamp.replace(/[-:TZ.]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
      const batchId = lastInsertId(
        database.prepare("INSERT INTO shipment_batches (batch_no, status, created_at) VALUES (?, 'draft', ?)").run(batchNo, timestamp),
      );
      const selectOrder = database.prepare(`
        SELECT o.id, o.order_no, o.status, o.customer_name, o.recipient_name, o.recipient_info, o.amount_cents,
          f.receivable_cents AS finance_receivable_cents, f.received_cents AS finance_received_cents
        FROM orders o LEFT JOIN order_finance f ON f.order_id = o.id WHERE o.id = ?
      `);
      const selectItems = database.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order, id');
      const insertShipment = database.prepare(`
        INSERT INTO shipments
          (order_id, tracking_no, shipped_at, total_boxes, recipient_info, remark, batch_id, shipment_no, customer_name, recipient_name)
        VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?)
      `);
      const insertShipmentItem = database.prepare(`
        INSERT INTO shipment_items
          (shipment_id, order_item_id, name, sku, specification, pack_count, quantity, boxes, remaining_after, remark, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateItem = database.prepare(
        'UPDATE order_items SET shipped_quantity = shipped_quantity + ?, updated_at = ? WHERE id = ? AND order_id = ? AND shipped_quantity + ? <= quantity',
      );
      const insertBatchOrder = database.prepare(
        'INSERT INTO shipment_batch_orders (batch_id, order_id, tracking_no, sort_order) VALUES (?, ?, ?, ?)',
      );

      unique.forEach((entry, index) => {
        const order = selectOrder.get(entry.orderId) as Record<string, unknown> | undefined;
        if (!order) throw new Error(`订单不存在：${entry.orderId}`);
        // 新流程在发货中确认；旧的待发货直接确认保留兼容，避免缓存页面整批失败。
        if (order.status !== 'shipping' && order.status !== 'ship_pending') throw new Error(`订单 ${order.order_no} 当前不可发货`);
        this.assertShipmentPaymentCleared(order);
        const trackingNo = String(entry.trackingNo ?? '').trim();
        if (!trackingNo) throw new Error(`订单 ${order.order_no} 缺少物流单号`);
        const available = new Map((selectItems.all(entry.orderId) as Array<Record<string, unknown>>).map((item) => [Number(item.id), item]));
        const selected: Array<{ item: Record<string, unknown>; quantity: number; boxes: number; remainingAfter: number }> = [];
        const seen = new Set<number>();
        entry.items.forEach((input) => {
          const orderItemId = Number(input.orderItemId);
          if (!Number.isSafeInteger(orderItemId) || seen.has(orderItemId)) throw new Error(`订单 ${order.order_no} 存在重复或无效的产品行`);
          seen.add(orderItemId);
          const item = available.get(orderItemId);
          if (!item) throw new Error(`订单 ${order.order_no} 中不存在产品行 ${orderItemId}`);
          const ordered = Math.max(0, Number(item.quantity ?? 0));
          const shipped = Math.max(0, Number(item.shipped_quantity ?? 0));
          const remaining = Math.max(0, ordered - shipped);
          const quantity = Math.trunc(Number(input.quantity));
          if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error(`订单 ${order.order_no} 的「${String(item.name ?? '')}」发货数量必须大于 0`);
          if (quantity > remaining) throw new Error(`订单 ${order.order_no} 的「${String(item.name ?? '')}」最多还能发 ${remaining}`);
          const packCount = Math.max(1, Number(item.pack_count ?? 1));
          selected.push({ item, quantity, boxes: Math.max(1, Math.ceil(quantity / packCount)), remainingAfter: remaining - quantity });
        });
        if (!selected.length) throw new Error(`订单 ${order.order_no} 没有选择发货产品`);
        const totalBoxes = selected.reduce((sum, item) => sum + item.boxes, 0);
        const previousShipments = Number((database.prepare('SELECT COUNT(*) AS count FROM shipments WHERE order_id = ?').get(entry.orderId) as { count?: unknown } | undefined)?.count ?? 0);
        const shipmentId = lastInsertId(insertShipment.run(
          entry.orderId,
          trackingNo,
          timestamp,
          totalBoxes,
          String(order.recipient_info ?? ''),
          batchId,
          `${String(order.order_no ?? entry.orderId)}-FH${previousShipments + 1}`,
          String(order.customer_name ?? ''),
          String(order.recipient_name ?? ''),
        ));
        selected.forEach((item, itemIndex) => {
          const update = updateItem.run(item.quantity, timestamp, Number(item.item.id), entry.orderId, item.quantity);
          if (Number(update.changes ?? 0) === 0) throw new Error(`订单 ${order.order_no} 的「${String(item.item.name ?? '')}」发货数量超出剩余`);
          insertShipmentItem.run(
            shipmentId,
            Number(item.item.id),
            String(item.item.name ?? ''),
            String(item.item.sku ?? ''),
            String(item.item.specification ?? ''),
            Math.max(1, Number(item.item.pack_count ?? 1)),
            item.quantity,
            item.boxes,
            item.remainingAfter,
            String(item.item.remark ?? ''),
            itemIndex,
            timestamp,
          );
        });
        const remaining = Number((database.prepare(
          'SELECT COUNT(*) AS count FROM order_items WHERE order_id = ? AND shipped_quantity < quantity',
        ).get(entry.orderId) as { count?: unknown } | undefined)?.count ?? 0);
        database.prepare('UPDATE orders SET tracking_no = ?, status = ?, updated_at = ? WHERE id = ?')
          .run(trackingNo, remaining === 0 ? 'shipped' : 'shipping', timestamp, entry.orderId);
        insertBatchOrder.run(batchId, entry.orderId, trackingNo, index);
      });
      database.prepare("UPDATE shipment_batches SET status = 'confirmed', confirmed_at = ? WHERE id = ?").run(timestamp, batchId);
      return batchId;
    });
  }

  voidShipment(shipmentId: number): { orderId: number } | undefined {
    return withTransaction(this.database, (database) => {
      const shipment = database.prepare('SELECT * FROM shipments WHERE id = ?').get(shipmentId) as Record<string, unknown> | undefined;
      if (!shipment) return undefined;
      const items = database.prepare('SELECT * FROM shipment_items WHERE shipment_id = ?').all(shipmentId) as Array<Record<string, unknown>>;
      for (const item of items) {
        if (item.order_item_id == null) throw new Error('发货明细缺少订单行，不能撤销');
        database.prepare(
          'UPDATE order_items SET shipped_quantity = MAX(0, shipped_quantity - ?), updated_at = ? WHERE id = ? AND order_id = ?',
        ).run(Math.max(0, Number(item.quantity ?? 0)), now(), Number(item.order_item_id), Number(shipment.order_id));
      }
      database.prepare('DELETE FROM shipments WHERE id = ?').run(shipmentId);
      const remaining = Number((database.prepare(
        'SELECT COALESCE(SUM(quantity - shipped_quantity), 0) AS remaining FROM order_items WHERE order_id = ?',
      ).get(Number(shipment.order_id)) as { remaining?: unknown } | undefined)?.remaining ?? 0);
      const latest = database.prepare(
        'SELECT tracking_no FROM shipments WHERE order_id = ? ORDER BY shipped_at DESC, id DESC LIMIT 1',
      ).get(Number(shipment.order_id)) as { tracking_no?: unknown } | undefined;
      // 撤销后只要还有未发数量，就退回发货中继续处理；不再回到待发货。
      const nextStatus = remaining === 0 ? 'shipped' : 'shipping';
      database.prepare('UPDATE orders SET tracking_no = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(String(latest?.tracking_no ?? ''), nextStatus, now(), Number(shipment.order_id));
      return { orderId: Number(shipment.order_id) };
    });
  }

  getShipmentBatchText(batchId: number): string {
    const rows = this.database
      .prepare(
        `SELECT COALESCE((SELECT MAX(cl.total_boxes) FROM carton_labels cl WHERE cl.order_id = o.id), 0) AS total_boxes,
          o.recipient_info FROM shipment_batch_orders sbo JOIN orders o ON o.id = sbo.order_id
         WHERE sbo.batch_id = ? ORDER BY sbo.sort_order`,
      )
      .all(batchId);
    return rows.map((row) => `${Math.max(1, Number(row.total_boxes))}箱 ${String(row.recipient_info ?? '')}`.trimEnd()).join('\n');
  }
}

export { DatabaseRepositories as Repositories };

export function createRepositories(database: DatabaseSync): DatabaseRepositories {
  return new DatabaseRepositories(database);
}
