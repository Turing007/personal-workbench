import { Ellipsis } from 'lucide-react';
import { navigationItem, type NavigationKey } from '../navigation';
import { DEFAULT_MOBILE_TABS } from '../mobile-tabs';

export interface MobileTabBarProps {
  activeKey: NavigationKey;
  /** 当前设备自定义的底部栏模块（顺序即显示顺序），缺省回退默认组合。 */
  tabs?: NavigationKey[];
  onNavigate: (key: NavigationKey) => void;
  onOpenMore: () => void;
}

export default function MobileTabBar({ activeKey, tabs = DEFAULT_MOBILE_TABS, onNavigate, onOpenMore }: MobileTabBarProps) {
  const moreActive = !tabs.includes(activeKey);
  return (
    <nav
      className="mobile-tabbar"
      aria-label="移动端主导航"
      style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}
    >
      {tabs.map((key) => {
        const { shortLabel, icon: Icon } = navigationItem(key);
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
            <span>{shortLabel}</span>
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
