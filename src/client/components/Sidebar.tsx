import { ChevronRight, Menu, X, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { holdOverlayOpen } from '../app-bridge';
import { navigationItems, type NavigationItem, type NavigationKey } from '../navigation';

export type { NavigationKey };

export type SidebarItem = NavigationItem;

export interface SidebarUser {
  username: string;
  displayName: string;
  role: 'admin' | 'member';
}

export interface SidebarProps {
  activeKey: NavigationKey;
  onNavigate: (key: NavigationKey) => void;
  collapsed?: boolean;
  companyName?: string;
  logoUrl?: string;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
  user?: SidebarUser | null;
  onLogout?: () => void;
}

/* 按业务流程排序：报价 → 开单 → 订单 → 备货 → 发货 → 收款，其后是资料库与设置 */
const items: SidebarItem[] = navigationItems;

export default function Sidebar({ activeKey, onNavigate, collapsed = false, companyName = '个人工作台', logoUrl, mobileOpen: mobileOpenProp, onMobileOpenChange, user, onLogout }: SidebarProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  const [internalMobileOpen, setInternalMobileOpen] = useState(false);
  const mobileOpen = mobileOpenProp ?? internalMobileOpen;
  const setMobileOpen = (open: boolean) => {
    setInternalMobileOpen(open);
    onMobileOpenChange?.(open);
  };
  const showLogo = Boolean(logoUrl && !logoFailed);
  // 抽屉打开时锁住背景滚动：抽屉本身是 position: fixed，若不同时锁 body，
  // 手指在抽屉或遮罩上滑动会连带滚动底下的页面，关掉抽屉后位置已经跑偏。
  // 同时通知 App 暂停下拉刷新，否则抽屉里的下滑会被当成「刷新页面」抢走。
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const release = holdOverlayOpen();
    return () => {
      document.body.style.overflow = previousOverflow ?? '';
      release();
    };
  }, [mobileOpen]);
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
            {showLogo ? <img src={logoUrl} alt={companyName || '公司 Logo'} onError={() => setLogoFailed(true)} /> : 'V'}
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
        {user && (
          <div className={`sidebar-user${collapsed ? ' is-collapsed' : ''}`}>
            <span className="sidebar-user-avatar" title={user.displayName || user.username}>
              {(user.displayName || user.username).slice(0, 1).toUpperCase()}
            </span>
            {!collapsed && (
              <span className="sidebar-user-meta">
                <strong className="sidebar-user-name">{user.displayName || user.username}</strong>
                <small className="sidebar-user-role">{user.role === 'admin' ? '管理员' : '成员'}</small>
              </span>
            )}
            <button
              type="button"
              className="sidebar-user-logout"
              title="退出登录"
              aria-label="退出登录"
              onClick={() => onLogout?.()}
            >
              <LogOut size={16} strokeWidth={1.8} />
              {!collapsed && <span>退出</span>}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
