import type { CatalogProduct } from '../documents/product-catalog-template.js';

/**
 * 产品行 → 前端/图册用的产品结构。原先散在 products 路由里，图册模块（在线链接版）
 * 也要用同一套口径，抽到独立模块避免两处漂移。
 */
export function mapVideo(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    relativePath: String(row.relativePath ?? row.relative_path ?? ''),
    originalName: String(row.originalName ?? row.original_name ?? ''),
    mimeType: String(row.mimeType ?? row.mime_type ?? ''),
    size: Number(row.size ?? row.size_bytes ?? 0),
    createdAt: String(row.createdAt ?? row.created_at ?? ''),
  };
}

export function mapAttachment(row: Record<string, unknown>) {
  const relativePath = String(row.relativePath ?? row.relative_path ?? '');
  return {
    id: Number(row.id),
    productId: Number(row.productId ?? row.product_id ?? 0),
    category: String(row.category ?? 'other'),
    relativePath,
    originalName: String(row.originalName ?? row.original_name ?? ''),
    mimeType: String(row.mimeType ?? row.mime_type ?? ''),
    size: Number(row.size ?? row.size_bytes ?? 0),
    createdAt: String(row.createdAt ?? row.created_at ?? ''),
    url: `/files/${relativePath}`,
  };
}

export function mapProduct(row: Record<string, unknown> | undefined) {
  if (!row) return undefined;
  return {
    id: Number(row.id),
    name: String(row.name),
    sku: String(row.sku),
    specification: String(row.specification),
    parameters: String(row.parameters ?? ''),
    category: String(row.category),
    purchasePrice: row.purchase_price === null ? null : Number(row.purchase_price),
    supplier: String(row.supplier),
    colors: Array.isArray(row.colors) ? row.colors : [],
    batteryPlugs: Array.isArray(row.batteryPlugs) ? row.batteryPlugs : [],
    accessories: String(row.accessories),
    /** 产品专有的「配件与价格」（售价计算器用）；客户版口径会剥掉，见 toCatalogProduct。 */
    accessoryPrices: Array.isArray(row.accessoryPrices) ? row.accessoryPrices : [],
    /** 是否已按产品固化过配件清单；没固化时详情/计算器沿用类目默认。 */
    accessoryPricesCustomized: row.accessoryPricesCustomized === true || row.accessoryPricesCustomized === 1,
    remark: String(row.remark),
    status: String(row.status ?? 'active'),
    packaging: Array.isArray(row.packaging) ? row.packaging : [],
    purchaseQuotes: Array.isArray(row.purchaseQuotes) ? row.purchaseQuotes : [],
    images: Array.isArray(row.images) ? row.images : [],
    videos: Array.isArray(row.videos) ? row.videos.map((item) => mapVideo(item as Record<string, unknown>)) : [],
    attachments: Array.isArray(row.attachments) ? row.attachments.map((item) => mapAttachment(item as Record<string, unknown>)) : [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export type MappedProduct = NonNullable<ReturnType<typeof mapProduct>>;

/** 图册口径：供应商与价格一律不进图册（客户版）。 */
export function toCatalogProduct(product: MappedProduct): CatalogProduct {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    category: product.category,
    parameters: product.parameters,
    colors: product.colors as string[],
    batteryPlugs: product.batteryPlugs as string[],
    packaging: product.packaging.map((item) => ({
      name: item.name,
      innerSize: item.innerSize,
      innerWeight: item.innerWeight,
      outerSize: item.outerSize,
      outerWeight: item.outerWeight,
      packCount: item.packCount,
    })),
    images: product.images.map((image) => ({ relativePath: image.relativePath, category: image.category })),
  };
}
