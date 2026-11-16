import { useCallback, useMemo, useRef } from 'react';
import type { CustomerProduct } from '../../../../shared/customers';
import type { QuotationItemConfiguration } from '../../../../shared/quotation-config';
import {
  batteryOptionsForProduct,
  buildQuotationConfiguration,
  recalculateQuotationConfiguration,
  type QuotationConfigSelection,
  type QuotationConfigSettings,
} from '../../../../shared/product-pricing';
import { createDocumentClientKey, type DocumentItemPriceTierDraft } from '../../../documents/document-drafts';
import { rememberedMarkup } from '../../../price-calc-memory';
import type { LibraryProductSelection } from '../../documents/LibraryProductPicker';
import type { ProductRecord } from '../../ProductEditor';
import { emptyLine, type QuotationLineDraft } from '../quotation-lines';

function selectionOf(config: QuotationItemConfiguration | undefined): QuotationConfigSelection {
  return {
    mode: config?.mode ?? 'bare',
    packCount: config?.battery?.packCount,
    capacity: config?.battery?.capacity,
    batteryCount: config?.battery?.batteryCount,
    chargerId: config?.battery?.chargerName,
    packagingId: config?.packaging?.id,
    accessoryNames: config?.accessoryNames ?? [],
    markupPercent: config?.markupPercent ?? (Number(rememberedMarkup()) || 20),
    otherCostCents: config?.otherCostCents ?? 0,
  };
}

/**
 * 明细行全部操作：回调引用稳定（供行组件 memo），行数据统一走 itemsRef。
 * 选品异步回调带竞态保护：行已换产品时丢弃旧回调。
 */
export function useQuotationLineActions(
  items: QuotationLineDraft[],
  onChange: (items: QuotationLineDraft[]) => void,
  settings: QuotationConfigSettings,
  productDetails: Record<number, ProductRecord>,
  fetchProduct: (id: number) => Promise<ProductRecord>,
) {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const detailsRef = useRef(productDetails);
  detailsRef.current = productDetails;

  const commit = useCallback((next: QuotationLineDraft[]) => {
    itemsRef.current = next;
    onChangeRef.current(next);
  }, []);

  const updateLine = useCallback((clientKey: string, patch: Partial<QuotationLineDraft>) => {
    commit(itemsRef.current.map((item) => (item.clientKey === clientKey ? { ...item, ...patch } : item)));
  }, [commit]);

  const addLine = useCallback(() => { commit([...itemsRef.current, emptyLine()]); }, [commit]);

  const removeLine = useCallback((clientKey: string) => {
    commit(itemsRef.current.filter((item) => item.clientKey !== clientKey));
  }, [commit]);

  const moveLine = useCallback((index: number, offset: -1 | 1) => {
    const current = itemsRef.current;
    const target = index + offset;
    if (target < 0 || target >= current.length) return;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  }, [commit]);

  const duplicateLine = useCallback((index: number) => {
    const current = itemsRef.current;
    const source = current[index];
    if (!source) return;
    const duplicate: QuotationLineDraft = {
      ...source,
      id: undefined,
      clientKey: createDocumentClientKey('quotation-line'),
      priceTiers: (source.priceTiers ?? []).map((tier) => ({ ...tier })),
      configuration: source.configuration ? JSON.parse(JSON.stringify(source.configuration)) as QuotationItemConfiguration : undefined,
      image: { ...source.image, file: undefined },
    };
    commit([...current.slice(0, index + 1), duplicate, ...current.slice(index + 1)]);
  }, [commit]);

  const updateTier = useCallback((lineKey: string, tierIndex: number, patch: Partial<DocumentItemPriceTierDraft>) => {
    commit(itemsRef.current.map((item) => (item.clientKey === lineKey
      ? { ...item, priceTiers: (item.priceTiers ?? []).map((tier, index) => (index === tierIndex ? { ...tier, ...patch } : tier)) }
      : item)));
  }, [commit]);

  const addTier = useCallback((lineKey: string) => {
    commit(itemsRef.current.map((item) => (item.clientKey === lineKey
      ? { ...item, priceTiers: [...(item.priceTiers ?? []), { minQuantity: '', maxQuantity: '', unitPrice: '' }] }
      : item)));
  }, [commit]);

  const removeTier = useCallback((lineKey: string, tierIndex: number) => {
    commit(itemsRef.current.map((item) => (item.clientKey === lineKey
      ? { ...item, priceTiers: (item.priceTiers ?? []).filter((_, index) => index !== tierIndex) }
      : item)));
  }, [commit]);

  const applySelection = useCallback((item: QuotationLineDraft, patch: Partial<QuotationConfigSelection>) => {
    const product = item.productId == null ? undefined : detailsRef.current[item.productId];
    if (!product) return;
    const nextSelection = { ...selectionOf(item.configuration), ...patch };
    const config = buildQuotationConfiguration(product, nextSelection, settingsRef.current);
    const overridden = item.configuration?.priceOverridden ?? false;
    updateLine(item.clientKey, {
      configuration: { ...config, priceOverridden: overridden },
      unitPrice: overridden ? item.unitPrice : (config.computedSalePriceCents / 100).toFixed(2),
    });
  }, [updateLine]);

  const setConfigMode = useCallback((item: QuotationLineDraft, value: string) => {
    if (value === 'none') {
      updateLine(item.clientKey, { configuration: undefined });
      return;
    }
    if (value === 'bare') {
      applySelection(item, { mode: 'bare' });
      return;
    }
    const product = item.productId == null ? undefined : detailsRef.current[item.productId];
    const option = product
      ? batteryOptionsForProduct(product, settingsRef.current.batteryMatrix).find((candidate) => candidate.value === value)
      : undefined;
    if (!option) return;
    applySelection(item, { mode: 'battery', packCount: option.packCount, capacity: option.capacity, batteryCount: option.batteryCount });
  }, [applySelection, updateLine]);

  const updateUnitPrice = useCallback((item: QuotationLineDraft, value: string) => {
    updateLine(item.clientKey, {
      unitPrice: value,
      ...(item.configuration ? { configuration: { ...item.configuration, priceOverridden: true } } : {}),
    });
  }, [updateLine]);

  const restoreAutoPrice = useCallback((item: QuotationLineDraft) => {
    if (!item.configuration || item.productId == null) return;
    const product = detailsRef.current[item.productId];
    if (!product) return;
    const config = recalculateQuotationConfiguration({ ...item.configuration, priceOverridden: false }, product, settingsRef.current);
    updateLine(item.clientKey, { configuration: config, unitPrice: (config.computedSalePriceCents / 100).toFixed(2) });
  }, [updateLine]);

  const selectProduct = useCallback((lineKey: string, selection: LibraryProductSelection) => {
    const { product, image } = selection;
    updateLine(lineKey, {
      productId: product.id,
      customerProductId: null,
      isTemporary: false,
      name: product.name,
      sku: product.sku,
      specification: product.specification,
      parameters: product.parameters ?? '',
      image: {
        relativePath: image?.relativePath ?? null,
        originalName: image?.originalName ?? '',
        mimeType: '',
        previewUrl: image?.url,
      },
    });
    const expectedProductId = product.id;
    void fetchProduct(product.id).then((detail) => {
      // 竞态保护：行已换到别的产品时，丢弃这次旧回调。
      const line = itemsRef.current.find((candidate) => candidate.clientKey === lineKey);
      if (!line || line.productId !== expectedProductId) return;
      const config = buildQuotationConfiguration(detail, {
        mode: 'bare',
        markupPercent: Number(rememberedMarkup()) || 20,
        packagingId: String(detail.packaging[0]?.id ?? ''),
      }, settingsRef.current);
      updateLine(lineKey, { configuration: config, unitPrice: (config.computedSalePriceCents / 100).toFixed(2) });
    }).catch(() => undefined);
  }, [fetchProduct, updateLine]);

  const selectCustomerProduct = useCallback((lineKey: string, product: CustomerProduct) => {
    updateLine(lineKey, {
      productId: product.systemProductId,
      customerProductId: product.id,
      isTemporary: product.systemProductId == null,
      productCode: product.sku,
      name: product.name,
      sku: product.sku,
      specification: product.specification,
      packCount: product.packCount == null ? '' : String(product.packCount),
      unitPrice: product.finalPriceCents == null ? '' : (product.finalPriceCents / 100).toFixed(2),
      image: { relativePath: product.imageRelativePath, originalName: '', mimeType: '' },
    });
  }, [updateLine]);

  const setLineImage = useCallback((lineKey: string, file: File) => {
    updateLine(lineKey, {
      image: { relativePath: null, originalName: file.name, mimeType: file.type, file, previewUrl: URL.createObjectURL(file) },
      isTemporary: true,
    });
  }, [updateLine]);

  // 回调全部稳定，返回值 memo 化：行组件 memo 才能跳过未变更的行。
  return useMemo(() => ({
    addLine,
    removeLine,
    moveLine,
    duplicateLine,
    updateLine,
    updateTier,
    addTier,
    removeTier,
    applySelection,
    setConfigMode,
    updateUnitPrice,
    restoreAutoPrice,
    selectProduct,
    selectCustomerProduct,
    setLineImage,
  }), [addLine, removeLine, moveLine, duplicateLine, updateLine, updateTier, addTier, removeTier, applySelection, setConfigMode, updateUnitPrice, restoreAutoPrice, selectProduct, selectCustomerProduct, setLineImage]);
}

export type QuotationLineActions = ReturnType<typeof useQuotationLineActions>;