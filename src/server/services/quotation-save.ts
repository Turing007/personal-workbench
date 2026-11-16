import type { CompanySnapshot, QuotationDisplayConfig, QuotationPriceTier } from '../../shared/documents.js';
import { yuanToCents } from '../../shared/money.js';
import {
  calculateQuotationConfigPrice,
  pricingBasisIncludesTax,
  type QuotationItemConfiguration,
  type QuotationPricingBasis,
} from '../../shared/quotation-config.js';
import { quotationConfigPriceInputs } from '../../shared/product-pricing.js';
import { DocumentValidationError } from '../../shared/document-validation.js';
import type { PreparedDocumentAssetBatch } from '../documents/document-assets.js';
import type { QuotationPersistenceInput } from '../db/quotation-repository.js';
import type {
  QuotationAssetManager,
  QuotationCustomFieldSaveInput,
  QuotationInput,
  QuotationItemInput,
  QuotationPriceTierInput,
} from './quotation-service.js';

/**
 * 报价单保存管线的本地辅助模块（重构方案第 4 步）：
 * 校验清洗 / 配置重算 / 资产提交回滚。纯移动代码，不改行为；
 * 快照解析（resolve*）仍留在服务内，因为它们直接依赖各仓储。
 * 不建跨服务通用框架——销售单服务保持原样。
 */

/* ===== 校验与清洗 ===== */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeParameters(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function normalizeDate(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(normalized) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new DocumentValidationError(`${field}无效`, field);
  }
  return normalized;
}

export function normalizeCompanySnapshot(value: Partial<CompanySnapshot> | undefined, fallback: CompanySnapshot): CompanySnapshot {
  return {
    name: normalizeText(value?.name ?? fallback.name),
    logoRelativePath: value?.logoRelativePath === undefined
      ? (fallback.logoRelativePath ?? null)
      : (value.logoRelativePath ? normalizeText(value.logoRelativePath) : null),
    phone: normalizeText(value?.phone ?? fallback.phone),
    address: normalizeText(value?.address ?? fallback.address),
    defaultIssuer: normalizeText(value?.defaultIssuer ?? fallback.defaultIssuer),
    wechatQrRelativePath: value?.wechatQrRelativePath === undefined
      ? (fallback.wechatQrRelativePath ?? null)
      : (value.wechatQrRelativePath ? normalizeText(value.wechatQrRelativePath) : null),
  };
}

const DEFAULT_COLUMNS: QuotationDisplayConfig['columns'] = {
  image: true,
  name: true,
  specification: true,
  unitPrice: true,
  tierPrice: true,
  remark: true,
};

export function normalizeDisplayConfig(input: QuotationInput['displayConfig']): QuotationDisplayConfig {
  return {
    showLogo: input?.showLogo ?? false,
    showCompanyPhone: input?.showCompanyPhone ?? false,
    showCompanyAddress: input?.showCompanyAddress ?? false,
    showContactPhone: input?.showContactPhone ?? true,
    showTax: input?.showTax ?? true,
    showTaxIncludedTotal: input?.showTaxIncludedTotal ?? true,
    columns: { ...DEFAULT_COLUMNS, ...(input?.columns ?? {}) },
  };
}

export function normalizePriceCents(item: QuotationItemInput, index: number): number {
  if (Object.prototype.hasOwnProperty.call(item, 'unitPriceCents')) {
    const value = item.unitPriceCents;
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new DocumentValidationError('单价必须是整数分', `items.${index}.unitPriceCents`);
    }
    if ((value as number) < 0) throw new DocumentValidationError('单价不能小于 0', `items.${index}.unitPriceCents`);
    return value as number;
  }
  const value = item.unitPrice;
  if (!Number.isFinite(value)) throw new DocumentValidationError('单价必须是有效数字', `items.${index}.unitPriceCents`);
  try {
    return yuanToCents(value as number);
  } catch (error) {
    throw new DocumentValidationError((error as Error).message, `items.${index}.unitPriceCents`);
  }
}

const MAX_PRICE_TIERS = 8;

export function normalizePriceTiers(item: QuotationItemInput, index: number): QuotationPriceTier[] {
  const tiers = item.priceTiers;
  if (tiers === undefined || tiers === null) return [];
  if (!Array.isArray(tiers)) {
    throw new DocumentValidationError('数量区间价必须是数组', `items.${index}.priceTiers`);
  }
  if (tiers.length > MAX_PRICE_TIERS) {
    throw new DocumentValidationError(`每行产品最多 ${MAX_PRICE_TIERS} 个数量区间`, `items.${index}.priceTiers`);
  }

  const normalized = tiers.map((tier, tierIndex): QuotationPriceTier => {
    const field = `items.${index}.priceTiers.${tierIndex}`;
    if (tier == null || typeof tier !== 'object') {
      throw new DocumentValidationError('数量区间必须是对象', field);
    }
    const record = tier as Partial<QuotationPriceTierInput>;
    const minQuantity = Number(record.minQuantity);
    if (!Number.isFinite(minQuantity) || minQuantity < 0) {
      throw new DocumentValidationError('区间起始数量必须是大于等于 0 的数字', `${field}.minQuantity`);
    }
    let maxQuantity: number | null = null;
    if (record.maxQuantity !== undefined && record.maxQuantity !== null) {
      maxQuantity = Number(record.maxQuantity);
      if (!Number.isFinite(maxQuantity) || maxQuantity < minQuantity) {
        throw new DocumentValidationError('区间截止数量必须大于等于起始数量', `${field}.maxQuantity`);
      }
    }
    let unitPriceCents: number;
    if (record.unitPriceCents !== undefined) {
      unitPriceCents = Number(record.unitPriceCents);
      if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
        throw new DocumentValidationError('区间单价必须是大于等于 0 的整数分', `${field}.unitPriceCents`);
      }
    } else if (record.unitPrice !== undefined) {
      const yuan = Number(record.unitPrice);
      if (!Number.isFinite(yuan) || yuan < 0) {
        throw new DocumentValidationError('区间单价必须是有效数字', `${field}.unitPrice`);
      }
      unitPriceCents = yuanToCents(yuan);
    } else {
      throw new DocumentValidationError('区间单价不能为空', `${field}.unitPriceCents`);
    }
    return { minQuantity, maxQuantity, unitPriceCents };
  });

  const sorted = [...normalized].sort((a, b) => a.minQuantity - b.minQuantity);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].minQuantity <= sorted[i - 1].minQuantity) {
      throw new DocumentValidationError('数量区间的起始数量必须从小到大递增', `items.${index}.priceTiers`);
    }
  }
  return sorted;
}

export function normalizeCustomFields(fields: readonly QuotationCustomFieldSaveInput[]): QuotationPersistenceInput['customFields'] {
  return fields.map((field, index) => {
    if (field.placement !== 'header' && field.placement !== 'footer') {
      throw new DocumentValidationError('自定义字段位置无效', `customFields.${index}.placement`);
    }
    const label = normalizeText(field.label);
    if (!label) throw new DocumentValidationError('自定义字段名称不能为空', `customFields.${index}.label`);
    return {
      placement: field.placement,
      label,
      value: normalizeText(field.value),
      sortOrder: Number.isInteger(field.sortOrder) && (field.sortOrder as number) >= 0 ? field.sortOrder as number : index,
    };
  });
}

/* ===== 配置重算 ===== */

/**
 * 服务端保存时按配置快照重算成本/售价（不信任客户端合计）。
 * 口径→计价参数映射与客户端构建配置共用 shared/product-pricing。
 */
export function recomputeQuotationConfiguration(
  configuration: QuotationItemConfiguration,
  pricingBasis: QuotationPricingBasis,
  taxRateBps: number,
): QuotationItemConfiguration {
  const taxPercent = pricingBasisIncludesTax(pricingBasis) ? taxRateBps / 100 : 0;
  const recomputed = calculateQuotationConfigPrice(quotationConfigPriceInputs({
    baseCostCents: configuration.baseCostCents,
    packagingCents: configuration.packaging?.costCents ?? 0,
    otherCostCents: configuration.otherCostCents,
    accessoryCents: configuration.accessoryPriceCents,
    batteryUnitPriceCents: configuration.battery?.batteryUnitPriceCents ?? 0,
    batteryCount: configuration.battery?.batteryCount ?? 0,
    chargerPriceCents: configuration.battery?.chargerPriceCents ?? 0,
    shippingCostCents: configuration.shippingCostCents,
    taxRateBps,
    markupPercent: configuration.markupPercent,
    pricingBasis,
  }));
  return {
    ...configuration,
    priceBasis: pricingBasis,
    taxPercent,
    totalCostCents: recomputed.totalCostCents,
    computedSalePriceCents: recomputed.salePriceCents,
  };
}

/* ===== 资产提交 / 回滚 / 清理 ===== */

export async function commitAssetBatches(assetManager: QuotationAssetManager | undefined, batches: readonly PreparedDocumentAssetBatch[]): Promise<void> {
  if (!assetManager) return;
  for (const batch of batches) await assetManager.commit(batch);
}

export async function rollbackAssetBatches(assetManager: QuotationAssetManager | undefined, batches: readonly PreparedDocumentAssetBatch[]): Promise<void> {
  if (!assetManager) return;
  await Promise.all(batches.map((batch) => assetManager.rollback(batch)));
}

export async function deleteAssetFiles(assetManager: QuotationAssetManager | undefined, paths: readonly string[]): Promise<void> {
  if (!assetManager?.deleteFile) return;
  await Promise.all(paths.map((path) => assetManager.deleteFile!(path)));
}

export async function deleteReplacedAssetFiles(assetManager: QuotationAssetManager | undefined, previousPaths: readonly string[], currentPaths: Set<string>): Promise<void> {
  await deleteAssetFiles(assetManager, previousPaths.filter((path) => !currentPaths.has(path)));
}