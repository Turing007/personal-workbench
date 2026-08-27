/** 批量添加客户产品的单批次上限（与服务端 createMany 的限制一致）。 */
export const CUSTOMER_PRODUCT_BATCH_LIMIT = 50;

export interface CustomerProductBatchLine {
  name: string;
  specification: string;
  sku: string;
}

/**
 * 解析逐行粘贴的批量清单：每行"品名，规格，SKU"，分隔符支持制表符与中英文逗号，
 * 规格和 SKU 可省略；跳过空行，并按"品名+规格"（不区分大小写）去重。
 */
export function parseBatchLines(value: string): CustomerProductBatchLine[] {
  const seen = new Set<string>();
  const lines: CustomerProductBatchLine[] = [];
  for (const rawLine of value.split(/\r\n|\r|\n/)) {
    const segments = rawLine.trim().split(/\t|[，,]/).map((part) => part.trim());
    const name = segments[0] ?? '';
    if (!name) continue;
    const specification = segments[1] ?? '';
    const sku = segments[2] ?? '';
    const key = `${name.toLowerCase()}\u0000${specification.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ name, specification, sku });
  }
  return lines;
}
