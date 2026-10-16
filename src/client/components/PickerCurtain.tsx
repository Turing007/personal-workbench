import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export interface PickerCurtainProps {
  open: boolean;
  /** 关闭（点外部空白处 / Esc）：父组件负责把 open 改回 false。 */
  onClose: () => void;
  /** 锚点元素：幕布贴在它下方，点在它之外才算「外部」。 */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** 幕布宽度是否跟随锚点（搜索框是；工具条里的小按钮不是——按钮太窄）。 */
  matchAnchorWidth?: boolean;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}

/** 位移超过这个值就按「滚动」处理，不关幕布。 */
const TAP_SLOP_PX = 10;

/**
 * 下拉幕布：点触发器后从下方拉出一块面板（不是原生 select / 列表式下拉），
 * 内容由调用方决定（搜索历史与分类筛选都用胶囊）。两处共用同一套定位与关闭逻辑，
 * 样式与交互不会各自漂移。
 *
 * 关闭只认「轻点外部」：pointerdown 与 pointerup 之间位移很小才算点击；
 * 滚动（位移大，或浏览器接管手势发了 pointercancel）不关 —— 用户在滚动浏览
 * 列表时幕布跟着消失会被当成故障（第一版就是这么挂的）。
 */
export default function PickerCurtain({ open, onClose, anchorRef, matchAnchorWidth = false, ariaLabel, children, className }: PickerCurtainProps) {
  const curtainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let pressPoint: { x: number; y: number } | null = null;
    const isInside = (target: Node) => Boolean(anchorRef.current?.contains(target) || curtainRef.current?.contains(target));

    const onPointerDown = (event: PointerEvent) => {
      // 落在锚点或幕布内部：这是操作，不是「点外部」，后续不再判定。
      if (isInside(event.target as Node)) {
        pressPoint = null;
        return;
      }
      pressPoint = { x: event.clientX, y: event.clientY };
    };
    const settle = (event: PointerEvent, cancelled: boolean) => {
      if (!pressPoint) return;
      const moved = Math.hypot(event.clientX - pressPoint.x, event.clientY - pressPoint.y);
      pressPoint = null;
      // 滚动不关：位移超阈值，或浏览器接管滚动手势发了 pointercancel。
      if (!cancelled && moved < TAP_SLOP_PX) onClose();
    };
    const onPointerUp = (event: PointerEvent) => settle(event, false);
    const onPointerCancel = (event: PointerEvent) => settle(event, true);

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
    };
  }, [open, onClose, anchorRef]);

  // Esc 关闭：与原生下拉的行为一致，键盘用户不必去点别处。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return <div
    ref={curtainRef}
    className={`picker-curtain${matchAnchorWidth ? ' is-anchor-width' : ''}${className ? ` ${className}` : ''}`}
    role="dialog"
    aria-label={ariaLabel}
  >{children}</div>;
}
