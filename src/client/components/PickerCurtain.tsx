import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export interface PickerCurtainProps {
  open: boolean;
  /** 关闭（点外部空白处 / 滚动 / Esc）：父组件负责把 open 改回 false。 */
  onClose: () => void;
  /** 锚点元素：幕布贴在它下方，点在它之外才算「外部」。 */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** 幕布宽度是否跟随锚点（搜索框是；工具条里的小按钮不是——按钮太窄，用大面板）。 */
  matchAnchorWidth?: boolean;
  /** 宽幅大面板（分类筛选用）：固定宽度、高度受视口限制并内部滚动。 */
  wide?: boolean;
  /**
   * 滚动时是否收起。
   * 搜索历史幕布：true —— 手机端输入框聚焦时滚动，就是要让浮层收掉让位给内容；
   * 分类幕布：false —— 它是主动点开的大面板，用户滚动是为了找分类，突然消失很突兀。
   */
  closeOnScroll?: boolean;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}

/** 位移超过这个值就按「滚动/拖拽」处理，不当作点击。 */
const TAP_SLOP_PX = 10;

/**
 * 下拉幕布：点触发器后从下方拉出一块面板（不是原生 select / 列表式下拉），
 * 内容由调用方决定（搜索历史与分类筛选都用胶囊）。两处共用同一套定位与关闭逻辑，
 * 样式与交互不会各自漂移。
 *
 * 关闭途径：
 *  - 轻点外部（pointerdown 与 pointerup 之间位移很小才算点击，滚动不误判）；
 *  - Esc；
 *  - closeOnScroll 打开时，页面/容器一滚动就收（搜索历史幕布的行为）。
 */
export default function PickerCurtain({ open, onClose, anchorRef, matchAnchorWidth = false, wide = false, closeOnScroll = false, ariaLabel, children, className }: PickerCurtainProps) {
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
      // 滚动/拖拽不关：位移超阈值，或浏览器接管滚动手势发了 pointercancel。
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

  // 滚动收起：监听捕获阶段，容器内滚（.app-content）与文档滚都能收到。
  useEffect(() => {
    if (!open || !closeOnScroll) return;
    const onScroll = () => onClose();
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('scroll', onScroll);
    };
  }, [open, closeOnScroll, onClose]);

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
    className={`picker-curtain${matchAnchorWidth ? ' is-anchor-width' : ''}${wide ? ' is-wide' : ''}${className ? ` ${className}` : ''}`}
    // 不用 role="dialog"：幕布是锚定浮层、不是模态弹窗，标成 dialog 会让
    // 读屏与测试把「页面里有个弹窗」当成真（也会与产品编辑器等真弹窗混淆）。
    role="group"
    aria-label={ariaLabel}
  >{children}</div>;
}
