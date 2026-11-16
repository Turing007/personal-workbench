import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BatteryPriceMatrix } from '../../../../shared/battery-prices';
import type { AccessoryPrice } from '../../../../shared/accessory-prices';
import type { QuotationPricingBasis } from '../../../../shared/quotation-config';
import type { QuotationConfigSettings } from '../../../../shared/product-pricing';
import type { ProductRecord } from '../../ProductEditor';
import type { QuotationLineDraft } from '../quotation-lines';
import { getBatteryPriceMatrix, getCategoryAccessoryPrices, getChargerPrices, getProductsByIds, getVolumeDivisor } from '../../../api';
import { rememberedShippingUnitPrice } from '../../../price-calc-memory';

export interface QuotationConfigData {
  settings: QuotationConfigSettings;
  batteryMatrix: BatteryPriceMatrix | null;
  productDetails: Record<number, ProductRecord>;
  loadingProducts: Record<number, boolean>;
  /** 取单个产品详情（选品后立即构建配置用）；已有缓存直接返回。 */
  fetchProduct: (id: number) => Promise<ProductRecord>;
}

/**
 * 明细弹窗的数据层：全局计价设置 + 产品详情 + 类目配件。
 * - 矩阵/充电器/体积参数走 api 层缓存（60s TTL + 保存即更新），反复打开不再重复拉取；
 * - 产品详情每次打开弹窗整体刷新一次（产品库改价立即反映），打开期间新增产品批量补拉；
 * - 运费单价记忆值在打开时读一次进 state，避免 localStorage 读取藏在 memo 里不触发更新。
 */
export function useQuotationConfigData(
  open: boolean,
  items: QuotationLineDraft[],
  pricingBasis: QuotationPricingBasis,
  taxRateBps: number,
): QuotationConfigData {
  const [batteryMatrix, setBatteryMatrix] = useState<BatteryPriceMatrix | null>(null);
  const [chargerPrices, setChargerPrices] = useState<AccessoryPrice[]>([]);
  const [volumeDivisor, setVolumeDivisor] = useState(8000);
  const [shippingUnitPrice, setShippingUnitPrice] = useState(1.5);
  const [categoryAccessories, setCategoryAccessories] = useState<Record<string, AccessoryPrice[]>>({});
  const [productDetails, setProductDetails] = useState<Record<number, ProductRecord>>({});
  const [loadingProducts, setLoadingProducts] = useState<Record<number, boolean>>({});
  const inFlightProducts = useRef(new Set<number>());
  const loadedThisOpen = useRef(new Set<number>());
  const loadedCategories = useRef(new Set<string>());
  const productDetailsRef = useRef(productDetails);
  productDetailsRef.current = productDetails;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setShippingUnitPrice(Number(rememberedShippingUnitPrice()) || 1.5);
    void getBatteryPriceMatrix().then((matrix) => { if (!cancelled) setBatteryMatrix(matrix); }).catch(() => undefined);
    void getChargerPrices().then((list) => { if (!cancelled) setChargerPrices(list); }).catch(() => undefined);
    void getVolumeDivisor().then((divisor) => { if (!cancelled) setVolumeDivisor(divisor); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [open]);

  const mergeProducts = useCallback((records: ProductRecord[]) => {
    if (!records.length) return;
    setProductDetails((current) => {
      const next = { ...current };
      for (const record of records) next[Number(record.id)] = record;
      return next;
    });
  }, []);

  const fetchProducts = useCallback(async (ids: number[]) => {
    const missing = [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id > 0 && !inFlightProducts.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => inFlightProducts.current.add(id));
    setLoadingProducts((current) => {
      const next = { ...current };
      missing.forEach((id) => { next[id] = true; });
      return next;
    });
    try {
      mergeProducts(await getProductsByIds(missing));
    } catch {
      // 拉取失败保留已有数据，不阻断编辑
    } finally {
      missing.forEach((id) => inFlightProducts.current.delete(id));
      setLoadingProducts((current) => {
        const next = { ...current };
        missing.forEach((id) => { delete next[id]; });
        return next;
      });
    }
  }, [mergeProducts]);

  // 每次打开刷新全部产品详情；打开期间行上新出现的产品批量补拉（一次请求）。
  useEffect(() => {
    if (!open) {
      loadedThisOpen.current.clear();
      return;
    }
    const ids = items
      .map((item) => item.productId)
      .filter((id): id is number => id != null && Number.isSafeInteger(id) && id > 0);
    const missing = ids.filter((id) => !loadedThisOpen.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => loadedThisOpen.current.add(id));
    void fetchProducts(missing);
  }, [open, items, fetchProducts]);

  useEffect(() => {
    const categories = [...new Set(Object.values(productDetails).map((product) => product.category?.trim()).filter((category): category is string => Boolean(category)))];
    for (const category of categories) {
      if (loadedCategories.current.has(category)) continue;
      loadedCategories.current.add(category);
      void getCategoryAccessoryPrices(category).then((list) => {
        setCategoryAccessories((current) => ({ ...current, [category]: list.filter((item) => item.name.trim()) }));
      }).catch(() => undefined);
    }
  }, [productDetails]);

  const fetchProduct = useCallback(async (id: number): Promise<ProductRecord> => {
    const existing = productDetailsRef.current[id];
    if (existing) return existing;
    const records = await getProductsByIds([id]);
    const record = records[0];
    if (!record) throw new Error('产品不存在');
    loadedThisOpen.current.add(id);
    mergeProducts([record]);
    return record;
  }, [mergeProducts]);

  const settings = useMemo<QuotationConfigSettings>(() => ({
    batteryMatrix,
    chargerPrices,
    volumeDivisor,
    categoryAccessories,
    taxRateBps,
    pricingBasis,
    shippingUnitPrice,
  }), [batteryMatrix, chargerPrices, volumeDivisor, categoryAccessories, taxRateBps, pricingBasis, shippingUnitPrice]);

  return { settings, batteryMatrix, productDetails, loadingProducts, fetchProduct };
}