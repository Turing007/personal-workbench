import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * 贴着锚点弹出的浮层：始终完整显示在视口内，下方空间不够时自动向上翻转。
 * 用 fixed + portal，避免被 .table-panel / .modal-panel 这类 overflow:hidden 容器裁掉。
 */
export interface AnchoredPopoverProps {
  anchor: HTMLElement;
  width: number;
  maxHeight: number;
  onClose: () => void;
  children: ReactNode;
}

export default function AnchoredPopover({ anchor, width, maxHeight, onClose, children }: AnchoredPopoverProps) {
  const [style, setStyle] = useState<CSSProperties>();
  const popoverRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const popoverWidth = Math.min(width, viewportWidth - 16);
    const left = Math.max(8, Math.min(rect.left, viewportWidth - popoverWidth - 8));
    const roomBelow = viewportHeight - rect.bottom - 8;
    const flipUp = roomBelow < Math.min(240, maxHeight);
    const top = flipUp ? Math.max(8, rect.top - 4 - Math.min(maxHeight, rect.top - 12)) : rect.bottom + 4;
    const height = Math.min(maxHeight, flipUp ? Math.max(120, rect.top - 12) : Math.max(120, roomBelow));
    setStyle({ position: 'fixed', left, top, width: popoverWidth, maxHeight: height });
  }, [anchor, width, maxHeight]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || anchor.contains(target)) return;
      onCloseRef.current();
    };
    // 捕获阶段拦截 Escape：菜单开着时只关菜单，不要把外层弹窗一起关掉。
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    // 任何容器滚动都会让锚点错位，直接关闭（浮层自身滚动除外）。
    const handleScroll = (event: Event) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      onCloseRef.current();
    };
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [anchor]);

  return createPortal(
    <div ref={popoverRef} className="anchored-popover" style={style}>{children}</div>,
    document.body,
  );
}
