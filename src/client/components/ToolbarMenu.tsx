import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import AnchoredPopover from './AnchoredPopover';

export interface ToolbarMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** 菜单项之间的分隔线：在该项之前画一条。 */
  separated?: boolean;
  onSelect: () => void;
}

export interface ToolbarMenuProps {
  label: string;
  title?: string;
  items: ToolbarMenuItem[];
  /** 追加在触发按钮上的类名，例如手机端隐藏。 */
  className?: string;
  width?: number;
}

/** 工具条上的二级菜单：把低频的成组操作收进一个按钮。 */
export default function ToolbarMenu({ label, title, items, className, width = 176 }: ToolbarMenuProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement>();

  return <>
    <button
      ref={buttonRef}
      className={className ? `button button-secondary toolbar-menu-button ${className}` : 'button button-secondary toolbar-menu-button'}
      type="button"
      title={title ?? label}
      aria-haspopup="menu"
      aria-expanded={Boolean(anchor)}
      onClick={() => setAnchor(anchor ? undefined : buttonRef.current ?? undefined)}
    >
      <span>{label}</span><ChevronDown size={14} />
    </button>
    {anchor && <AnchoredPopover anchor={anchor} width={width} maxHeight={320} onClose={() => setAnchor(undefined)}>
      <div className="toolbar-menu-list" role="menu">
        {items.map((item) => <button
          key={item.key}
          className={item.separated ? 'toolbar-menu-item is-separated' : 'toolbar-menu-item'}
          type="button"
          role="menuitem"
          onClick={() => { setAnchor(undefined); item.onSelect(); }}
        >{item.icon}<span>{item.label}</span></button>)}
      </div>
    </AnchoredPopover>}
  </>;
}
