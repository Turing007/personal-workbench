import { randomBytes } from 'node:crypto';
import type { CompanySnapshot } from '../../shared/documents.js';
import type { CatalogProduct } from '../documents/product-catalog-template.js';
import { pickCatalogImage } from '../documents/product-catalog-template.js';
import type { CatalogRepository, CatalogSummaryRecord } from '../db/catalog-repository.js';
import type { SettingsRepository } from '../db/settings-repository.js';
import { mapProduct, toCatalogProduct, type MappedProduct } from './product-record-mapper.js';

const MAX_NAME_LENGTH = 40;
/** 公开链接的 token：URL 安全字符，长度足够长不可猜。 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export class CatalogServiceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** 公开页数据：只有客户版字段，供应商与价格在服务端就被剥离。 */
export interface PublicCatalog {
  catalog: { id: number; name: string; token: string };
  company: CompanySnapshot;
  groups: Array<{ category: string; products: CatalogProduct[] }>;
  /** 从起算日（2026-10-10 北京时间）之后加入图册的新品（新加的排前）；空数组时页面不排「新品」分区。 */
  newArrivals: CatalogProduct[];
}

/** 新品起算：2026-10-10 起「新加入图册」的才算新品；建册时的批量存量不算，之后不设到期。 */
const NEW_ARRIVAL_START_AT = Date.parse('2026-10-10T00:00:00+08:00');

interface CatalogServiceOptions {
  /** 产品全量行（仓储原样），在服务内统一走 mapProduct 口径。 */
  listProductRows: () => Array<Record<string, unknown>>;
  settingsRepository: SettingsRepository;
}

function groupByCategory(products: CatalogProduct[]): PublicCatalog['groups'] {
  const groups = new Map<string, CatalogProduct[]>();
  for (const product of products) {
    const key = product.category?.trim() || '未分类';
    const list = groups.get(key);
    if (list) list.push(product);
    else groups.set(key, [product]);
  }
  return [...groups.entries()].map(([category, list]) => ({ category, products: list }));
}

export class CatalogService {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly options: CatalogServiceOptions,
  ) {}

  list(): CatalogSummaryRecord[] {
    return this.repository.list();
  }

  /** 编辑用明细：摘要 + 有序产品 id，供选品编辑器回填勾选状态。 */
  detail(id: number): CatalogSummaryRecord & { productIds: number[] } {
    return { ...this.require(id), productIds: this.repository.listItemProductIds(id) };
  }

  create(input: { name: unknown; productIds: unknown }): CatalogSummaryRecord {
    const name = this.requireName(input.name);
    const productIds = this.requireProductIds(input.productIds);
    const token = randomBytes(16).toString('base64url');
    const id = this.repository.create({ token, name, productIds });
    return this.require(id);
  }

  update(id: number, input: { name?: unknown; enabled?: unknown; productIds?: unknown }): CatalogSummaryRecord {
    if (!this.repository.get(id)) throw new CatalogServiceError('CATALOG_NOT_FOUND', '图册不存在');
    const changes: { name?: string; enabled?: boolean; productIds?: number[] } = {};
    if (input.name !== undefined) changes.name = this.requireName(input.name);
    if (input.enabled !== undefined) changes.enabled = Boolean(input.enabled);
    if (input.productIds !== undefined) changes.productIds = this.requireProductIds(input.productIds);
    this.repository.update(id, changes);
    return this.require(id);
  }

  delete(id: number): void {
    if (!this.repository.get(id)) throw new CatalogServiceError('CATALOG_NOT_FOUND', '图册不存在');
    this.repository.delete(id);
  }

  /**
   * 公开页数据；停用/不存在/非法 token 一律当作不可见。
   * 命中时记一次打开（列表里能看到「打开次数 + 最近打开时间」）。
   */
  getPublic(token: string): PublicCatalog | undefined {
    if (!TOKEN_PATTERN.test(token)) return undefined;
    const catalog = this.repository.getByToken(token);
    if (!catalog || !catalog.enabled) return undefined;
    this.repository.recordView(catalog.id);
    const byId = new Map(this.mappedProducts().map((product) => [product.id, product] as const));
    const resolved = this.repository.listItems(catalog.id).flatMap((item) => {
      const product = byId.get(item.productId);
      return product ? [{ product: toCatalogProduct(product), addedAt: item.addedAt }] : [];
    });
    const newArrivals = resolved
      .filter((entry) => entry.addedAt != null && Date.parse(entry.addedAt) >= NEW_ARRIVAL_START_AT)
      .sort((a, b) => Date.parse(b.addedAt ?? '') - Date.parse(a.addedAt ?? ''))
      .map((entry) => entry.product);
    return {
      catalog: { id: catalog.id, name: catalog.name, token },
      company: this.options.settingsRepository.getCompanyProfile(),
      groups: groupByCategory(resolved.map((entry) => entry.product)),
      newArrivals,
    };
  }

  /** 公开页图片：按 token 校验，返回该产品在哪张主图（仍要再经缩略图服务出图）。 */
  getPublicImagePath(token: string, productId: number): string | undefined {
    if (!TOKEN_PATTERN.test(token)) return undefined;
    const catalog = this.repository.getByToken(token);
    if (!catalog || !catalog.enabled) return undefined;
    if (!this.repository.listItemProductIds(catalog.id).includes(productId)) return undefined;
    const product = this.mappedProducts().find((item) => item.id === productId);
    if (!product) return undefined;
    return pickCatalogImage(toCatalogProduct(product));
  }

  /** 公开页的公司图片（Logo / 微信二维码）：校验 token 后给出文件路径，不记打开次数。 */
  resolveAsset(token: string, kind: 'logo' | 'qr'): string | undefined {
    if (!TOKEN_PATTERN.test(token)) return undefined;
    const catalog = this.repository.getByToken(token);
    if (!catalog || !catalog.enabled) return undefined;
    const profile = this.options.settingsRepository.getCompanyProfile();
    const relativePath = kind === 'logo' ? profile.logoRelativePath : profile.wechatQrRelativePath;
    return relativePath ?? undefined;
  }

  private require(id: number): CatalogSummaryRecord {
    const catalog = this.repository.list().find((item) => item.id === id);
    if (!catalog) throw new CatalogServiceError('CATALOG_NOT_FOUND', '图册不存在');
    return catalog;
  }

  private mappedProducts(): MappedProduct[] {
    return this.options.listProductRows().flatMap((row) => {
      const product = mapProduct(row);
      return product ? [product] : [];
    });
  }

  private requireName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name) throw new CatalogServiceError('CATALOG_NAME_REQUIRED', '请填写图册名称');
    if (name.length > MAX_NAME_LENGTH) {
      throw new CatalogServiceError('CATALOG_NAME_TOO_LONG', `图册名称不能超过 ${MAX_NAME_LENGTH} 个字`);
    }
    return name;
  }

  private requireProductIds(value: unknown): number[] {
    if (!Array.isArray(value) || !value.length) {
      throw new CatalogServiceError('CATALOG_EMPTY', '请至少选择一个产品');
    }
    // 在线图册不设数量上限：整库四百多款也能一本全放；PDF 导出另有单次容量保护。
    const ids = value.map((item) => Number(item));
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new CatalogServiceError('CATALOG_PRODUCT_INVALID', '产品编号不正确');
    }
    const existing = new Set(this.mappedProducts().map((product) => product.id));
    const missing = ids.find((id) => !existing.has(id));
    if (missing !== undefined) {
      throw new CatalogServiceError('CATALOG_PRODUCT_NOT_FOUND', `产品不存在：${missing}`);
    }
    return ids;
  }
}
