import type { CSSProperties } from 'react';
import type { OrderStatus } from './OrderForm';

export interface StatusCardItem {
  key: 'all' | OrderStatus;
  label: string;
  count: number;
  tone: string;
  toneSoft: string;
}

export interface StatusCardsProps {
  activeKey: 'all' | OrderStatus;
  counts: Partial<Record<'all' | OrderStatus, number>>;
  onSelect: (key: 'all' | OrderStatus) => void;
}

/**
 * 订单状态筛选。类名沿用 status-cards / status-card，e2e 依赖这些钩子；
 * 视觉上已经是「标签」而不是卡：桌面单行、手机 4+3 两行，不再浮起。
 */
const definitions: Array<Omit<StatusCardItem, 'count'>> = [
  { key: 'all', label: '全部订单', tone: 'var(--color-accent)', toneSoft: 'var(--color-accent-soft)' },
  { key: 'draft', label: '草稿', tone: 'var(--status-draft)', toneSoft: 'var(--status-draft-soft)' },
  { key: 'pending_stock', label: '待备货', tone: 'var(--status-pending-stock)', toneSoft: 'var(--status-pending-stock-soft)' },
  { key: 'stock_reported', label: '已备货', tone: 'var(--status-stock-reported)', toneSoft: 'var(--status-stock-reported-soft)' },
  { key: 'pending_packing', label: '待打包', tone: 'var(--status-pending-packing)', toneSoft: 'var(--status-pending-packing-soft)' },
  { key: 'ship_pending', label: '待发货', tone: 'var(--color-danger-strong)', toneSoft: 'var(--color-danger-soft)' },
  { key: 'shipped', label: '已发货', tone: 'var(--color-success)', toneSoft: 'var(--color-success-soft)' },
];

export default function StatusCards({ activeKey, counts, onSelect }: StatusCardsProps) {
  return (
    <div className="status-cards" role="group" aria-label="订单状态筛选">
      {definitions.map(({ key, label, tone, toneSoft }) => {
        const active = key === activeKey;
        const count = counts[key] ?? 0;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            aria-pressed={active}
            data-count={count}
            className={`status-card${active ? ' is-active' : ''}${count === 0 ? ' is-empty' : ''}`}
            style={{ '--tone': tone, '--tone-soft': toneSoft } as CSSProperties}
          >
            <span className="status-card-label">{label}</span>
            <span className="status-card-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
