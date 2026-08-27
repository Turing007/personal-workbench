/** 财务模块共享的金额、错误文案和状态徽章工具。 */

export const money = (cents: number): string =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100);

export const errorText = (error: unknown, fallback: string): string =>
  error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : fallback;

export const badgeClass = (value: string): string =>
  value === 'paid' || value === 'approved' || value === 'sent'
    ? 'badge badge-success'
    : value === 'partial' || value === 'pending' || value === 'pending_issue' || value === 'issued'
      ? 'badge badge-warning'
      : value === 'overpaid'
        ? 'badge badge-info'
        : 'badge badge-neutral';

export function formatFileSize(size = 0): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
