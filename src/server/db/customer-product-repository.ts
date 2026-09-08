import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from './connection.js';
import {
  getCustomerProductCompletionStatus,
  type CustomerProduct,
  type CustomerProductAttachment,
  type CustomerProductPackaging,
  type CustomerProductListFilters,
  type CustomerProductSaveInput,
} from '../../shared/customers.js';

interface CustomerProductRow extends Record<string, unknown> {
  id: number;
  customer_id: number;
  system_product_id: number | null;
  name: string;
  supplier_product_name: string;
  specification: string;
  sku: string;
  pack_count: number | null;
  latest_quote_cents: number | null;
  final_price_cents: number | null;
  cost_price_cents: number | null;
  freight_per_box_cents: number | null;
  packaging_json: string | null;
  remark: string;
  attachments_json: string | null;
  source_quotation_id: number | null;
  image_relative_path: string | null;
  resolved_image_relative_path: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SystemProductImportRow extends Record<string, unknown> {
  id: number;
  name: string;
  specification: string;
  sku: string;
  pack_count: number | null;
  image_relative_path: string | null;
  purchase_price: number | null;
  packaging_json: string;
}

const customerProductSelect = `
  SELECT
    cp.id,
    cp.customer_id,
    cp.system_product_id,
    cp.name,
    cp.supplier_product_name,
    cp.specification,
    cp.sku,
    cp.pack_count,
    cp.latest_quote_cents,
    cp.final_price_cents,
    cp.cost_price_cents,
    cp.freight_per_box_cents,
    cp.packaging_json,
    cp.remark,
    cp.source_quotation_id,
    cp.image_relative_path,
    COALESCE(
      NULLIF(trim(cp.image_relative_path), ''),
      (
        SELECT pi.relative_path
        FROM product_images pi
        WHERE pi.product_id = cp.system_product_id
        ORDER BY pi.id
        LIMIT 1
      )
    ) AS resolved_image_relative_path,
    COALESCE((SELECT json_group_array(json_object(
      'id', cpa.id,
      'customerProductId', cpa.customer_product_id,
      'relativePath', cpa.relative_path,
      'originalName', cpa.original_name,
      'mimeType', cpa.mime_type,
      'size', cpa.size_bytes,
      'createdAt', cpa.created_at
      ,'category', cpa.category
    )) FROM customer_product_attachments cpa WHERE cpa.customer_product_id = cp.id ORDER BY cpa.created_at, cpa.id), '[]') AS attachments_json,
    cp.last_synced_at,
    cp.created_at,
    cp.updated_at
  FROM customer_products cp
`;

function mapCustomerProduct(row: CustomerProductRow | undefined): CustomerProduct | undefined {
  if (!row) return undefined;
  const product: CustomerProduct = {
    id: Number(row.id),
    customerId: Number(row.customer_id),
    systemProductId: row.system_product_id === null ? null : Number(row.system_product_id),
    name: String(row.name ?? ''),
    supplierProductName: String(row.supplier_product_name ?? ''),
    specification: String(row.specification ?? ''),
    sku: String(row.sku ?? ''),
    packCount: row.pack_count === null ? null : Number(row.pack_count),
    latestQuoteCents: row.latest_quote_cents === null ? null : Number(row.latest_quote_cents),
    finalPriceCents: row.final_price_cents === null ? null : Number(row.final_price_cents),
    costPriceCents: row.cost_price_cents == null ? null : Number(row.cost_price_cents),
    freightPerBoxCents: row.freight_per_box_cents == null ? null : Number(row.freight_per_box_cents),
    remark: String(row.remark ?? ''),
    packaging: parsePackaging(row.packaging_json),
    attachments: parseAttachments(row.attachments_json, Number(row.id)),
    completionStatus: 'incomplete',
    sourceQuotationId: row.source_quotation_id === null ? null : Number(row.source_quotation_id),
    imageRelativePath: row.resolved_image_relative_path === null
      ? null
      : String(row.resolved_image_relative_path),
    lastSyncedAt: row.last_synced_at === null ? null : String(row.last_synced_at),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
  product.completionStatus = getCustomerProductCompletionStatus(product);
  return product;
}

export class CustomerProductRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(customerId: number, filters: CustomerProductListFilters = {}): CustomerProduct[] {
    const clauses = ['cp.customer_id = ?'];
    const parameters: Array<string | number> = [customerId];
    const search = filters.search?.trim();
    if (search) {
      clauses.push(`(
        cp.name LIKE ? ESCAPE '\\'
        OR cp.sku LIKE ? ESCAPE '\\'
        OR cp.specification LIKE ? ESCAPE '\\'
      )`);
      const pattern = `%${escapeLike(search)}%`;
      parameters.push(pattern, pattern, pattern);
    }
    const rows = this.database.prepare(`
      ${customerProductSelect}
      WHERE ${clauses.join(' AND ')}
      ORDER BY cp.updated_at DESC, cp.id DESC
    `).all(...parameters) as CustomerProductRow[];
    const products = rows.map((row) => mapCustomerProduct(row)!);
    return filters.status && filters.status !== 'all'
      ? products.filter((product) => product.completionStatus === filters.status)
      : products;
  }

  getById(id: number): CustomerProduct | undefined {
    const row = this.database.prepare(`
      ${customerProductSelect}
      WHERE cp.id = ?
    `).get(id) as CustomerProductRow | undefined;
    return mapCustomerProduct(row);
  }

  findBySystemProduct(customerId: number, systemProductId: number): CustomerProduct | undefined {
    const row = this.database.prepare(`
      ${customerProductSelect}
      WHERE cp.customer_id = ? AND cp.system_product_id = ?
    `).get(customerId, systemProductId) as CustomerProductRow | undefined;
    return mapCustomerProduct(row);
  }

  findTemporary(customerId: number, name: string, specification: string): CustomerProduct | undefined {
    const row = this.database.prepare(`
      ${customerProductSelect}
      WHERE cp.customer_id = ?
        AND cp.system_product_id IS NULL
        AND lower(trim(cp.name)) = lower(trim(?))
        AND lower(trim(cp.specification)) = lower(trim(?))
      LIMIT 1
    `).get(customerId, name, specification) as CustomerProductRow | undefined;
    return mapCustomerProduct(row);
  }

  create(customerId: number, input: CustomerProductSaveInput): CustomerProduct {
    const timestamp = new Date().toISOString();
    const result = this.database.prepare(`
      INSERT INTO customer_products
        (customer_id, system_product_id, name, supplier_product_name, specification, sku, pack_count,
         final_price_cents, cost_price_cents, freight_per_box_cents, packaging_json, image_relative_path, remark, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customerId,
      input.systemProductId ?? null,
      input.name,
      input.supplierProductName ?? '',
      input.specification,
      input.sku,
      input.packCount,
      input.finalPriceCents,
      input.costPriceCents ?? null,
      input.freightPerBoxCents ?? null,
      JSON.stringify(input.packaging ?? []),
      input.imageRelativePath ?? null,
      input.remark ?? '',
      timestamp,
      timestamp,
    );
    return this.getById(Number(result.lastInsertRowid))!;
  }

  /** 在单个事务里创建多条客户产品，任一条失败则整体回滚。 */
  createMany(customerId: number, inputs: CustomerProductSaveInput[]): CustomerProduct[] {
    return withTransaction(this.database, (database) => {
      const insert = database.prepare(`
        INSERT INTO customer_products
          (customer_id, system_product_id, name, supplier_product_name, specification, sku, pack_count,
           final_price_cents, cost_price_cents, freight_per_box_cents, packaging_json, image_relative_path, remark, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const created: CustomerProduct[] = [];
      for (const input of inputs) {
        const timestamp = new Date().toISOString();
        const result = insert.run(
          customerId,
          input.systemProductId ?? null,
          input.name,
          input.supplierProductName ?? '',
          input.specification,
          input.sku,
          input.packCount,
          input.finalPriceCents,
          input.costPriceCents ?? null,
          input.freightPerBoxCents ?? null,
          JSON.stringify(input.packaging ?? []),
          input.imageRelativePath ?? null,
          input.remark ?? '',
          timestamp,
          timestamp,
        );
        created.push(this.getById(Number(result.lastInsertRowid))!);
      }
      return created;
    });
  }

  update(id: number, input: CustomerProductSaveInput): CustomerProduct | undefined {
    const existing = this.getById(id);
    const result = this.database.prepare(`
      UPDATE customer_products
      SET name = ?, supplier_product_name = ?, specification = ?, sku = ?, pack_count = ?, final_price_cents = ?,
          cost_price_cents = ?, freight_per_box_cents = ?, packaging_json = ?, image_relative_path = ?, remark = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.name,
      input.supplierProductName ?? existing?.supplierProductName ?? '',
      input.specification,
      input.sku,
      input.packCount,
      input.finalPriceCents,
      input.costPriceCents ?? null,
      input.freightPerBoxCents ?? existing?.freightPerBoxCents ?? null,
      JSON.stringify(input.packaging ?? existing?.packaging ?? []),
      input.imageRelativePath === undefined ? existing?.imageRelativePath ?? null : input.imageRelativePath,
      input.remark ?? existing?.remark ?? '',
      new Date().toISOString(),
      id,
    );
    return result.changes ? this.getById(id) : undefined;
  }

  /** 建立或清除与系统产品的映射，并同步写入报供名称（备货模块补关联用）。 */
  setSystemProduct(
    id: number,
    systemProductId: number | null,
    supplierProductName: string,
  ): CustomerProduct | undefined {
    const result = this.database.prepare(`
      UPDATE customer_products
      SET system_product_id = ?, supplier_product_name = ?, updated_at = ?
      WHERE id = ?
    `).run(systemProductId, supplierProductName, new Date().toISOString(), id);
    return result.changes ? this.getById(id) : undefined;
  }

  createFromSystemProduct(customerId: number, systemProductId: number, overrides?: CustomerProductSaveInput): CustomerProduct {
    const product = this.getSystemProductImport(systemProductId);
    if (!product) throw new SystemProductNotFoundError();
    const timestamp = new Date().toISOString();
    const result = this.database.prepare(`
      INSERT INTO customer_products
        (customer_id, system_product_id, name, supplier_product_name, specification, sku, pack_count,
         final_price_cents, cost_price_cents, freight_per_box_cents, packaging_json, image_relative_path, remark, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customerId,
      product.id,
      overrides?.name ?? product.name,
      overrides?.supplierProductName ?? '',
      overrides?.specification ?? product.specification,
      overrides?.sku ?? product.sku,
      overrides?.packCount ?? product.pack_count,
      overrides?.finalPriceCents ?? null,
      overrides?.costPriceCents ?? (product.purchase_price == null ? null : Math.round(product.purchase_price * 100)),
      overrides?.freightPerBoxCents ?? null,
      JSON.stringify(overrides?.packaging ?? parsePackaging(product.packaging_json)),
      overrides?.imageRelativePath ?? product.image_relative_path,
      overrides?.remark ?? '',
      timestamp,
      timestamp,
    );
    return this.getById(Number(result.lastInsertRowid))!;
  }

  createFromQuotation(
    customerId: number,
    input: CustomerProductSaveInput & {
      latestQuoteCents: number;
      sourceQuotationId: number;
      lastSyncedAt: string;
    },
  ): CustomerProduct {
    const timestamp = input.lastSyncedAt;
    const result = this.database.prepare(`
      INSERT INTO customer_products
        (customer_id, system_product_id, name, specification, sku, pack_count,
         latest_quote_cents, final_price_cents, cost_price_cents, freight_per_box_cents, packaging_json, source_quotation_id, image_relative_path, remark,
         last_synced_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customerId,
      input.systemProductId ?? null,
      input.name,
      input.specification,
      input.sku,
      input.packCount,
      input.latestQuoteCents,
      input.costPriceCents ?? null,
      input.freightPerBoxCents ?? null,
      JSON.stringify(input.packaging ?? []),
      input.sourceQuotationId,
      input.imageRelativePath ?? null,
      input.remark ?? '',
      input.lastSyncedAt,
      timestamp,
      timestamp,
    );
    return this.getById(Number(result.lastInsertRowid))!;
  }

  syncLatestQuote(
    id: number,
    latestQuoteCents: number,
    sourceQuotationId: number,
    lastSyncedAt: string,
  ): CustomerProduct | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;
    if (
      existing.latestQuoteCents === latestQuoteCents
      && existing.sourceQuotationId === sourceQuotationId
    ) return existing;
    const result = this.database.prepare(`
      UPDATE customer_products
      SET latest_quote_cents = ?, source_quotation_id = ?, last_synced_at = ?, updated_at = ?
      WHERE id = ?
    `).run(latestQuoteCents, sourceQuotationId, lastSyncedAt, lastSyncedAt, id);
    return result.changes ? this.getById(id) : undefined;
  }

  delete(id: number): boolean {
    return this.database.prepare('DELETE FROM customer_products WHERE id = ?').run(id).changes > 0;
  }

  deleteMany(customerId: number, ids: number[]): number {
    if (!ids.length) return 0;
    const placeholders = ids.map(() => '?').join(', ');
    const result = this.database.prepare(
      `DELETE FROM customer_products WHERE customer_id = ? AND id IN (${placeholders})`,
    ).run(customerId, ...ids);
    return Number(result.changes);
  }

  setImagePath(id: number, imageRelativePath: string | null): CustomerProduct | undefined {
    const result = this.database.prepare(
      'UPDATE customer_products SET image_relative_path = ?, updated_at = ? WHERE id = ?',
    ).run(imageRelativePath, new Date().toISOString(), id);
    return result.changes ? this.getById(id) : undefined;
  }

  addAttachment(
    customerProductId: number,
    file: { relativePath: string; originalName: string; mimeType: string; size: number; category: CustomerProductAttachment['category'] },
  ) {
    const result = this.database.prepare(`
      INSERT INTO customer_product_attachments
        (customer_product_id, relative_path, original_name, mime_type, size_bytes, category, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      customerProductId,
      file.relativePath,
      file.originalName,
      file.mimeType,
      file.size,
      file.category,
      new Date().toISOString(),
    );
    return this.database.prepare('SELECT * FROM customer_product_attachments WHERE id = ?').get(Number(result.lastInsertRowid));
  }

  deleteAttachment(customerProductId: number, attachmentId: number): string | undefined {
    const attachment = this.database.prepare(
      'SELECT relative_path FROM customer_product_attachments WHERE id = ? AND customer_product_id = ?',
    ).get(attachmentId, customerProductId) as { relative_path?: unknown } | undefined;
    if (!attachment) return undefined;
    this.database.prepare(
      'DELETE FROM customer_product_attachments WHERE id = ? AND customer_product_id = ?',
    ).run(attachmentId, customerProductId);
    return String(attachment.relative_path ?? '');
  }

  updateAttachmentCategory(customerProductId: number, attachmentId: number, category: CustomerProductAttachment['category']): boolean {
    const result = this.database.prepare(
      'UPDATE customer_product_attachments SET category = ? WHERE id = ? AND customer_product_id = ?',
    ).run(category, attachmentId, customerProductId);
    return Number(result.changes ?? 0) > 0;
  }

  private getSystemProductImport(systemProductId: number): SystemProductImportRow | undefined {
    return this.database.prepare(`
      SELECT
        p.id,
        p.name,
        p.specification,
        p.sku,
        (
          SELECT pp.pack_count
          FROM product_packaging pp
          WHERE pp.product_id = p.id AND pp.pack_count > 0
          ORDER BY pp.sort_order, pp.id
          LIMIT 1
        ) AS pack_count,
        (
          SELECT pi.relative_path
          FROM product_images pi
          WHERE pi.product_id = p.id
          ORDER BY pi.id
          LIMIT 1
        ) AS image_relative_path
        , p.purchase_price
        , COALESCE((SELECT json_group_array(json_object(
          'id', pp.id,
          'name', pp.name,
          'innerSize', pp.inner_size,
          'innerWeight', pp.inner_weight,
          'outerSize', pp.outer_size,
          'outerWeight', pp.outer_weight,
          'packCount', pp.pack_count
        )) FROM product_packaging pp WHERE pp.product_id = p.id ORDER BY pp.sort_order, pp.id), '[]') AS packaging_json
      FROM products p
      WHERE p.id = ? AND p.status != 'draft'
    `).get(systemProductId) as SystemProductImportRow | undefined;
  }
}

export class SystemProductNotFoundError extends Error {
  constructor() {
    super('系统产品不存在');
    this.name = 'SystemProductNotFoundError';
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function parsePackaging(value: unknown): CustomerProductPackaging[] {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item, index) => {
      const row = item as Record<string, unknown>;
      return {
        id: row.id == null ? `pack-${index}` : String(row.id),
        name: String(row.name ?? ''),
        innerSize: String(row.innerSize ?? row.inner_size ?? ''),
        innerWeight: Number(row.innerWeight ?? row.inner_weight ?? 0) || 0,
        outerSize: String(row.outerSize ?? row.outer_size ?? ''),
        outerWeight: Number(row.outerWeight ?? row.outer_weight ?? 0) || 0,
        packCount: Math.max(1, Math.trunc(Number(row.packCount ?? row.pack_count ?? 1) || 1)),
      };
    });
  } catch {
    return [];
  }
}

function parseAttachments(value: unknown, customerProductId: number): CustomerProduct['attachments'] {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      const row = item as Record<string, unknown>;
      const relativePath = String(row.relativePath ?? row.relative_path ?? '');
      return {
        id: Number(row.id),
        customerProductId,
        relativePath,
        originalName: String(row.originalName ?? row.original_name ?? '客户产品附件'),
        mimeType: String(row.mimeType ?? row.mime_type ?? ''),
        size: Number(row.size ?? row.size_bytes ?? 0),
        createdAt: String(row.createdAt ?? row.created_at ?? ''),
        url: relativePath ? `/files/${relativePath}` : '',
        category: ['label', 'instruction', 'packaging', 'other'].includes(String(row.category))
          ? String(row.category) as CustomerProductAttachment['category']
          : 'other',
      };
    });
  } catch {
    return [];
  }
}
