/**
 * 产品多档采购报价：一个产品可以挂多条「供应商 + 名目/款式 + 采购价」。
 * 其中一条是默认档 —— 产品库列表显示它，客户产品的成本价也从它取。
 * 报价数组是唯一事实，products.supplier / products.purchase_price 只是默认档的镜像列。
 */

export interface ProductPurchaseQuote {
  id: string;
  supplier: string;
  /** 名目/款式：含配件、不含配件、有刷款、无刷款、裸机…可留空。 */
  variant: string;
  /** 元，字符串保存以便输入框直接回显；空串表示这一档还没定价。 */
  price: string;
  isDefault: boolean;
}

export const PURCHASE_QUOTE_LIMIT = 10;
export const PURCHASE_QUOTE_TEXT_LIMIT = 40;

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function priceValue(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? String(value) : '';
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? trimmed : '';
}

/** 行 id 只在前端草稿期存在（入库后由自增主键接管），但要保证同一毫秒内新增的两行也不会撞 key。 */
let quoteSequence = 0;

export function blankPurchaseQuote(): ProductPurchaseQuote {
  quoteSequence += 1;
  return { id: `quote-${Date.now()}-${quoteSequence}`, supplier: '', variant: '', price: '', isDefault: false };
}

/** 报价行的可读标题：名目优先，其次供应商，都没有就是「默认报价」。 */
export function purchaseQuoteLabel(quote: ProductPurchaseQuote): string {
  return quote.variant.trim() || quote.supplier.trim() || '默认报价';
}

function toQuote(entry: unknown, index: number): ProductPurchaseQuote {
  // 宽松读取：服务端与客户端传来的可能是 0/1、"1" 或布尔。
  const record = (entry ?? {}) as Record<string, unknown>;
  // 读库时 id 是整数主键，客户端草稿里是字符串，都要原样带上（React 靠它定位行）。
  const id = typeof record.id === 'number' && Number.isFinite(record.id) ? String(record.id) : text(record.id, 40);
  return {
    id: id || `quote-${index + 1}`,
    supplier: text(record.supplier, PURCHASE_QUOTE_TEXT_LIMIT),
    variant: text(record.variant, PURCHASE_QUOTE_TEXT_LIMIT),
    price: priceValue(record.price),
    isDefault: record.isDefault === true || record.isDefault === 1 || record.isDefault === '1',
  };
}

function anchorDefault(quotes: ProductPurchaseQuote[]): ProductPurchaseQuote[] {
  if (quotes.length) {
    const anchor = quotes.findIndex((quote) => quote.isDefault);
    const target = anchor >= 0 ? anchor : 0;
    quotes.forEach((quote, index) => {
      quote.isDefault = index === target;
    });
  }
  return quotes;
}

/**
 * 清洗整表：丢弃供应商与名目都为空的行、按上限截断、保证有且只有一个默认档。
 * 一条都没标默认时，第一行自动成为默认档 —— 不允许出现「没有默认价」的产品。
 */
export function normalizePurchaseQuotes(value: unknown): ProductPurchaseQuote[] {
  const list = Array.isArray(value) ? value : [];
  const quotes = list
    .map((entry, index) => toQuote(entry, index))
    // 三个格子全空的行没有意义（编辑器里点了「添加报价」又没填），直接丢。
    .filter((quote) => quote.supplier || quote.variant || quote.price)
    .slice(0, PURCHASE_QUOTE_LIMIT);
  return anchorDefault(quotes);
}

/** 读库用：库里已存的行一律保留（哪怕是价格为 0 的占位档），只补默认档标记。 */
export function mapStoredPurchaseQuotes(value: unknown): ProductPurchaseQuote[] {
  const list = Array.isArray(value) ? value : [];
  return anchorDefault(list.map((entry, index) => toQuote(entry, index)));
}

export function defaultPurchaseQuote(quotes: ProductPurchaseQuote[]): ProductPurchaseQuote | undefined {
  return quotes.find((quote) => quote.isDefault) ?? quotes[0];
}

/** 默认档的供应商与价格要写回 products 表的镜像列。 */
export function purchaseQuoteMirror(quotes: ProductPurchaseQuote[]): { supplier: string; purchasePrice: string } {
  const primary = defaultPurchaseQuote(quotes);
  return { supplier: primary?.supplier ?? '', purchasePrice: primary?.price ?? '' };
}

/** 按供应商分组，供详情弹窗展示；组内保持原有顺序。 */
export function groupPurchaseQuotesBySupplier(quotes: ProductPurchaseQuote[]): Array<{ supplier: string; quotes: ProductPurchaseQuote[] }> {
  const groups: Array<{ supplier: string; quotes: ProductPurchaseQuote[] }> = [];
  for (const quote of quotes) {
    const key = quote.supplier || '未填供应商';
    const found = groups.find((group) => group.supplier === key);
    if (found) found.quotes.push(quote);
    else groups.push({ supplier: key, quotes: [quote] });
  }
  return groups;
}
