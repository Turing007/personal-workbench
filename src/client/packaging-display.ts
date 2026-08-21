import type { PackagingOption } from './components/OrderForm';

export function formatPackagingSize(value: string, legacyValues: Array<string | undefined> = []): string {
  const text = value.trim() || (legacyValues.every(Boolean) ? legacyValues.join('×') : '');
  if (!text) return '—';
  return /(?:cm|毫米|mm|米|m)$/i.test(text) || !/^\s*[\d.]+\s*[×x*]\s*[\d.]+\s*[×x*]\s*[\d.]+\s*$/i.test(text)
    ? text
    : `${text}cm`;
}

export function formatPackagingWeight(value: string): string {
  return value.trim() ? `${value.trim()}kg` : '—';
}

export function packagingDisplay(item: PackagingOption) {
  return {
    name: item.name.trim() || '包装',
    price: item.purchasePrice.trim() ? `￥${item.purchasePrice.trim()}` : '',
    innerSize: formatPackagingSize(item.innerSize),
    innerWeight: formatPackagingWeight(item.innerWeight),
    outerSize: formatPackagingSize(item.outerSize, [item.length, item.width, item.height]),
    outerWeight: formatPackagingWeight(item.outerWeight),
    count: `${item.packSize}个/箱`,
  };
}
