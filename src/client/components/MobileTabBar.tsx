import { ClipboardList, Ellipsis, PackageCheck, ReceiptText, WalletCards } from 'lucide-react';
import type { ComponentType } from 'react';
import type { NavigationKey } from './Sidebar';

export interface MobileTabBarProps {
  activeKey: NavigationKey;
  onNavigate: (key: NavigationKey) => void;
  onOpenMore: () => void;
}

interface TabDefinition {
  key: NavigationKey;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

/* 手机端只放高频模块，其余入口集中在“更多”抽屉里。 */
const tabs: TabDefinition[] = [
  { key: 'orders', label: '订单', icon: ClipboardList },
  { key: 'quotations', label: '报价', icon: ReceiptText },
  { key: 'shipping', label: '发货', icon: PackageCheck },
  { key: 'finance', label: '财务', icon: WalletCards },
];

export default function MobileTabBar({ activeKey, onNavigate, onOpenMore }: MobileTabBarProps) {
  const moreActive = !tabs.some((tab) => tab.key === activeKey);
  return (
    <nav className="mobile-tabbar" aria-label="移动端主导航">
      {tabs.map(({ key, label, icon: Icon }) => {
        const active = key === activeKey;
        return (
          <button
            key={key}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate(key)}
            className={`mobile-tab-item${active ? ' is-active' : ''}`}
          >
            <Icon size={20} strokeWidth={active ? 2 : 1.7} />
            <span>{label}</span>
          </button>
        );
      })}
      <button
        type="button"
        aria-label="更多模块"
        aria-expanded={moreActive ? undefined : false}
        onClick={onOpenMore}
        className={`mobile-tab-item${moreActive ? ' is-active' : ''}`}
      >
        <Ellipsis size={20} strokeWidth={moreActive ? 2 : 1.7} />
        <span>更多</span>
      </button>
    </nav>
  );
}
