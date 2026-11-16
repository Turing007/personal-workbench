import { useEffect, useRef } from 'react';
import type { QuotationConfigSettings } from '../../../../shared/product-pricing';
import { recalculateQuotationConfiguration } from '../../../../shared/product-pricing';
import type { ProductRecord } from '../../ProductEditor';
import type { QuotationLineDraft } from '../quotation-lines';

/**
 * 价格口径/税率/矩阵/产品详情变化后，重算已有配置行的成本、重量和单价。
 * 行数据统一走 itemsRef（与操作 hook 同一来源），避免闭包旧数组覆盖新输入。
 */
export function useQuotationConfigRecalc(
  open: boolean,
  items: QuotationLineDraft[],
  settings: QuotationConfigSettings,
  productDetails: Record<number, ProductRecord>,
  onChange: (items: QuotationLineDraft[]) => void,
): void {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!open) return;
    let changed = false;
    const next = itemsRef.current.map((item) => {
      const product = item.productId == null ? undefined : productDetails[item.productId];
      if (!item.configuration || !product) return item;
      const recalculated = recalculateQuotationConfiguration(item.configuration, product, settings);
      const price = item.configuration.priceOverridden ? item.unitPrice : (recalculated.computedSalePriceCents / 100).toFixed(2);
      if (JSON.stringify(recalculated) === JSON.stringify(item.configuration) && price === item.unitPrice) return item;
      changed = true;
      return { ...item, configuration: recalculated, unitPrice: price };
    });
    if (changed) onChangeRef.current(next);
  }, [settings, productDetails, open]);
}