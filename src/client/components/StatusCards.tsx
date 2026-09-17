import {
  Archive,
  Box,
  CheckCircle2,
  ClipboardCheck,
  PackageOpen,
  PencilLine,
  Truck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { OrderStatus } from './OrderForm';

export interface StatusCardItem {
  key: 'all' | OrderStatus;
  label: string;
  count: number;
  tone: string;
  toneSoft: string;
  icon: LucideIcon;
}

export interface StatusCardsProps {
  activeKey: 'all' | OrderStatus;
  counts: Partial<Record<'all' | OrderStatus, number>>;
  onSelect: (key: 'all' | OrderStatus) => void;
}

const definitions: Array<Omit<StatusCardItem, 'count'>> = [
  { key: 'all', label: '全部订单', tone: 'var(--color-accent)', toneSoft: 'var(--color-accent-soft)', icon: Archive },
  { key: 'draft', label: '草稿', tone: 'var(--status-draft)', toneSoft: 'var(--status-draft-soft)', icon: PencilLine },
  { key: 'pending_stock', label: '待备货', tone: 'var(--status-pending-stock)', toneSoft: 'var(--status-pending-stock-soft)', icon: ClipboardCheck },
  { key: 'stock_reported', label: '已备货', tone: 'var(--status-stock-reported)', toneSoft: 'var(--status-stock-reported-soft)', icon: Box },
  { key: 'pending_packing', label: '待打包', tone: 'var(--status-pending-packing)', toneSoft: 'var(--status-pending-packing-soft)', icon: PackageOpen },
  { key: 'ship_pending', label: '待发货', tone: 'var(--color-danger-strong)', toneSoft: 'var(--color-danger-soft)', icon: Truck },
  { key: 'shipped', label: '已发货', tone: 'var(--color-success)', toneSoft: 'var(--color-success-soft)', icon: CheckCircle2 },
];

export default function StatusCards({ activeKey, counts, onSelect }: StatusCardsProps) {
  return (
    <div className="status-cards">
      {definitions.map(({ key, label, tone, toneSoft, icon: Icon }) => {
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
            <span className="status-card-count">{count}</span>
            <span className="status-card-label"><Icon size={13} strokeWidth={2} color={tone} style={{ verticalAlign: -2, marginRight: 4 }} />{label}</span>
          </button>
        );
      })}
    </div>
  );
}
