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
  { key: 'all', label: '全部订单', tone: 'var(--color-info)', toneSoft: 'var(--color-info-soft)', icon: Archive },
  { key: 'draft', label: '草稿', tone: '#64748b', toneSoft: '#f1f5f9', icon: PencilLine },
  { key: 'pending_stock', label: '待备货', tone: '#7c3aed', toneSoft: '#f5f3ff', icon: ClipboardCheck },
  { key: 'stock_reported', label: '已备货', tone: '#0891b2', toneSoft: '#ecfeff', icon: Box },
  { key: 'pending_packing', label: '待打包', tone: '#ea580c', toneSoft: '#fff7ed', icon: PackageOpen },
  { key: 'ship_pending', label: '待发货', tone: 'var(--color-danger-strong)', toneSoft: 'var(--color-danger-soft)', icon: Truck },
  { key: 'shipped', label: '已发货', tone: 'var(--color-success)', toneSoft: 'var(--color-success-soft)', icon: CheckCircle2 },
];

export default function StatusCards({ activeKey, counts, onSelect }: StatusCardsProps) {
  return (
    <div className="status-cards">
      {definitions.map(({ key, label, tone, toneSoft, icon: Icon }) => {
        const active = key === activeKey;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            aria-pressed={active}
            className={`status-card${active ? ' is-active' : ''}`}
            style={{ '--tone': tone, '--tone-soft': toneSoft } as CSSProperties}
          >
            <span className="status-card-count">{counts[key] ?? 0}</span>
            <span className="status-card-label"><Icon size={13} strokeWidth={2} color={tone} style={{ verticalAlign: -2, marginRight: 4 }} />{label}</span>
          </button>
        );
      })}
    </div>
  );
}
