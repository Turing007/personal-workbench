import {
  Boxes,
  ChevronRight,
  ClipboardList,
  FileSpreadsheet,
  PackageOpen,
  ReceiptText,
  WalletCards,
  PackageCheck,
  Settings,
  ShoppingBag,
  Menu,
  X,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useState } from 'react';

export type NavigationKey = 'orders' | 'stock' | 'finance' | 'quotations' | 'sales-documents' | 'products' | 'customer-products' | 'shipping' | 'settings';

export interface SidebarItem {
  key: NavigationKey;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

export interface SidebarProps {
  activeKey: NavigationKey;
  onNavigate: (key: NavigationKey) => void;
  collapsed?: boolean;
  companyName?: string;
  logoUrl?: string;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

/* 按业务流程排序：报价 → 开单 → 订单 → 备货 → 发货 → 收款，其后是资料库与设置 */
const items: SidebarItem[] = [
  { key: 'quotations', label: '报价单', icon: ReceiptText },
  { key: 'sales-documents', label: '销售开单', icon: FileSpreadsheet },
  { key: 'orders', label: '订单管理', icon: ClipboardList },
  { key: 'stock', label: '备货', icon: PackageOpen },
  { key: 'shipping', label: '发货管理', icon: PackageCheck },
  { key: 'finance', label: '财务管理', icon: WalletCards },
  { key: 'products', label: '产品库', icon: Boxes },
  { key: 'customer-products', label: '客户产品库', icon: ShoppingBag },
  { key: 'settings', label: '设置', icon: Settings },
];

export const navigationKeys: NavigationKey[] = items.map((item) => item.key);

export default function Sidebar({ activeKey, onNavigate, collapsed = false, companyName = '个人工作台', logoUrl, mobileOpen: mobileOpenProp, onMobileOpenChange }: SidebarProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  const [internalMobileOpen, setInternalMobileOpen] = useState(false);
  const mobileOpen = mobileOpenProp ?? internalMobileOpen;
  const setMobileOpen = (open: boolean) => {
    setInternalMobileOpen(open);
    onMobileOpenChange?.(open);
  };
  const showLogo = Boolean(logoUrl && !logoFailed);
  const navigate = (key: NavigationKey) => {
    onNavigate(key);
    setMobileOpen(false);
  };
  return (
    <>
      <button className="sidebar-mobile-toggle" type="button" aria-label="打开主导航" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>
        <Menu size={19} />
      </button>
      {mobileOpen && <button className="sidebar-backdrop" type="button" aria-label="关闭主导航" onClick={() => setMobileOpen(false)} />}
      <aside aria-label="主导航" className={`sidebar${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' is-mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-logo" title={companyName || '个人工作台'}>
            {showLogo ? <img src={logoUrl} alt={companyName || '公司 Logo'} onError={() => setLogoFailed(true)} /> : '工'}
          </div>
          {!collapsed && <strong className="sidebar-name" title={companyName || '个人工作台'}>{companyName || '个人工作台'}</strong>}
          <button className="sidebar-mobile-close" type="button" aria-label="关闭主导航" onClick={() => setMobileOpen(false)}><X size={18} /></button>
        </div>
        <nav className="sidebar-nav">
          {items.map(({ key, label, icon: Icon }) => {
            const active = key === activeKey;
            return (
              <button
                key={key}
                type="button"
                title={collapsed ? label : undefined}
                aria-current={active ? 'page' : undefined}
                onClick={() => navigate(key)}
                className={`sidebar-item${active ? ' is-active' : ''}${collapsed ? ' is-collapsed' : ''}`}
              >
                <Icon size={17} strokeWidth={1.8} />
                {!collapsed && <span>{label}</span>}
                {!collapsed && active && <ChevronRight size={14} strokeWidth={1.8} className="sidebar-chevron" />}
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
