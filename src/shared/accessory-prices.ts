/**
 * 配件与价格：全店共用一份（设置里维护）+ 产品专有（产品里补充）。
 * 售价计算器「按选择带价」的取数来源；只做名称与单价，不做库存与分类。
 */

export interface AccessoryPrice {
  id: string;
  name: string;
  /** 单价（元），≥ 0，保留两位。 */
  price: number;
  /** 单件重量（kg），≥ 0，保留两位；缺省/0 = 未填。运费预估用。 */
  weight?: number;
}

export const ACCESSORY_PRICE_LIST_LIMIT = 80;
export const ACCESSORY_PRICE_NAME_LIMIT = 60;
export const ACCESSORY_WEIGHT_LIMIT = 1000;

export function accessoryPriceValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
}

/** 配件重量：≥ 0、两位小数、上限 1000kg（防手误输入把运费算飞）。 */
export function accessoryWeightValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.round(parsed * 100) / 100, ACCESSORY_WEIGHT_LIMIT);
}

/** 清洗一行：名称为空视为无效（返回 null，由调用方丢弃）。 */
export function normalizeAccessoryPrice(value: unknown, fallbackId = ''): AccessoryPrice | null {
  const record = (value ?? {}) as Partial<AccessoryPrice>;
  const name = typeof record.name === 'string' ? record.name.trim().slice(0, ACCESSORY_PRICE_NAME_LIMIT) : '';
  if (!name) return null;
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : fallbackId;
  const weight = accessoryWeightValue(record.weight);
  return { id, name, price: accessoryPriceValue(record.price), ...(weight > 0 ? { weight } : {}) };
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

/**
 * 旧「配件」文本框的按行拆分（一次性迁移用，不参与日常读写）：
 * 行尾的「6元」或「0.03/根」当作价格，其余作名称；没有行尾价格的按 0 保留名称。
 */
export function parseLegacyAccessoriesText(text: string): AccessoryPrice[] {
  const result: AccessoryPrice[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const matched = line.match(/^(.*?)[\s:：]*([0-9]+(?:\.[0-9]+)?)\s*元\s*$/)
      ?? line.match(/^(.*?)[\s:：]*([0-9]+(?:\.[0-9]+)?)\s*\/\s*\S+\s*$/);
    const name = (matched ? matched[1] : line).trim();
    if (!name) continue;
    result.push({ id: '', name: name.slice(0, ACCESSORY_PRICE_NAME_LIMIT), price: matched ? accessoryPriceValue(matched[2]) : 0 });
  }
  return result;
}

/** 同名合并（迁移跨产品去重）：保留先出现的条目，价格/重量为空且新值有值时补上。 */
export function mergeAccessoryPrices(base: AccessoryPrice[], incoming: AccessoryPrice[]): AccessoryPrice[] {
  const result = base.map((item) => ({ ...item }));
  const byName = new Map(result.map((item) => [item.name, item]));
  for (const item of incoming) {
    const existing = byName.get(item.name);
    if (!existing) {
      const copy = { ...item };
      result.push(copy);
      byName.set(copy.name, copy);
      continue;
    }
    if (existing.price <= 0 && item.price > 0) existing.price = item.price;
    if (!existing.weight && item.weight) existing.weight = item.weight;
  }
  return result;
}

/** 配件总价与总重（按产品当前的配件清单累加）。 */
export function accessoryTotals(items: AccessoryPrice[]): { price: number; weight: number } {
  const price = items.reduce((sum, item) => sum + accessoryPriceValue(item.price), 0);
  const weight = items.reduce((sum, item) => sum + accessoryWeightValue(item.weight), 0);
  return { price: Math.round(price * 100) / 100, weight: Math.round(weight * 100) / 100 };
}
