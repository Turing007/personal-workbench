/**
 * 配件与价格：全店共用一份（设置里维护）+ 产品专有（产品里补充）。
 * 售价计算器「按选择带价」的取数来源；只做名称与单价，不做库存与分类。
 */

export interface AccessoryPrice {
  id: string;
  name: string;
  /** 单价（元），≥ 0，保留两位。 */
  price: number;
}

export const ACCESSORY_PRICE_LIST_LIMIT = 80;
export const ACCESSORY_PRICE_NAME_LIMIT = 40;

export function accessoryPriceValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
}

/** 清洗一行：名称为空视为无效（返回 null，由调用方丢弃）。 */
export function normalizeAccessoryPrice(value: unknown, fallbackId = ''): AccessoryPrice | null {
  const record = (value ?? {}) as Partial<AccessoryPrice>;
  const name = typeof record.name === 'string' ? record.name.trim().slice(0, ACCESSORY_PRICE_NAME_LIMIT) : '';
  if (!name) return null;
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : fallbackId;
  return { id, name, price: accessoryPriceValue(record.price) };
}

/** 整表清洗：丢弃无效行、按上限截断、补齐缺失 id。 */
export function normalizeAccessoryPrices(value: unknown): AccessoryPrice[] {
  const list = Array.isArray(value) ? value : [];
  const result: AccessoryPrice[] = [];
  list.forEach((entry, index) => {
    if (result.length >= ACCESSORY_PRICE_LIST_LIMIT) return;
    const item = normalizeAccessoryPrice(entry, `acc-${index}`);
    if (item) result.push(item);
  });
  return result;
}
