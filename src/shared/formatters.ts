import type { OrderStatus, ShippingRow } from './domain.js';
import { ORDER_STATUS_LABELS } from './domain.js';

export function formatOrderStatus(status: OrderStatus): string {
  return ORDER_STATUS_LABELS[status];
}

export function formatMoney(amount: number): string {
  if (!Number.isFinite(amount)) return '-';
  return `¥${amount.toFixed(2)}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date).replaceAll('/', '-');
}

export function formatCartonCount(totalCartons: number): string {
  return `${totalCartons}箱`;
}

export function formatShippingText(rows: readonly ShippingRow[]): string {
  return rows
    .map((row) => {
      const shippingInfo = row.shippingInfo.trim();
      return shippingInfo ? `${formatCartonCount(row.totalCartons)} ${shippingInfo}` : formatCartonCount(row.totalCartons);
    })
    .join('\n');
}
