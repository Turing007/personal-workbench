import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { holdOverlayOpen } from '../app-bridge';
import { registerCloseLayer, unregisterCloseLayer } from '../navigation-history';

export interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number | string;
  footer?: ReactNode;
  layer?: number;
  /** 抽屉形态：面板贴边并撑满高度，用于「档案 / 资料 / 列表」这类侧栏内容。行为（Esc、焦点陷阱、锁滚动）与弹窗完全一致。 */
  variant?: 'dialog' | 'drawer';
  /** 抽屉贴哪一边，默认右侧。「档案 / 资料」表单走右侧，客户列表这类「主列表」走左侧。 */
  drawerSide?: 'right' | 'left';
  /** 追加在 .modal-panel 上的额外类名，用于按弹窗微调内部留白。 */
  className?: string;
}

/** 打开着的弹窗数量：只有第一个负责锁页面滚动，最后一个关掉时才还原。 */
const openModalIds = new Set<symbol>();
let previousBodyOverflow: string | null = null;
/** 释放「App 暂停下拉刷新」的句柄；计数在 app-bridge 里，多个覆盖层互不干扰。 */
let releaseSwipeRefreshHold: (() => void) | null = null;

function registerModal(id: symbol) {
  if (!openModalIds.size) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // 弹窗打开期间让 App 暂停下拉刷新，否则弹窗内的下滑会被当成刷新页面。
    releaseSwipeRefreshHold = holdOverlayOpen();
  }
  openModalIds.add(id);
}

function unregisterModal(id: symbol) {
  openModalIds.delete(id);
  if (openModalIds.size) return;
  document.body.style.overflow = previousBodyOverflow ?? '';
  previousBodyOverflow = null;
  releaseSwipeRefreshHold?.();
  releaseSwipeRefreshHold = null;
}

export default function Modal({ open, title, children, onClose, width = 760, footer, layer = 20, variant = 'dialog', drawerSide = 'right', className }: ModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const modalId = useRef(Symbol('modal'));
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`);
  // 返回键关弹窗时调用的是登记那一刻的闭包，用 ref 保证永远是最新的 onClose。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    previousActiveElement.current = document.activeElement as HTMLElement | null;
    registerModal(modalId.current);
    // 弹窗算「一级」：安卓返回键先关它，而不是直接退出当前页。
    registerCloseLayer(modalId.current, () => onCloseRef.current());
    closeButtonRef.current?.focus();

    const panel = panelRef.current;
    const onPanelKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    panel?.addEventListener('keydown', onPanelKeyDown);
    return () => {
      panel?.removeEventListener('keydown', onPanelKeyDown);
      unregisterModal(modalId.current);
      unregisterCloseLayer(modalId.current);
      previousActiveElement.current?.focus?.();
    };
  }, [layer, open]);

  if (!open) return null;

  const isDrawer = variant === 'drawer';
  const isLeftDrawer = isDrawer && drawerSide === 'left';

  const modal = (
    // 弹窗只能靠自己的按钮关：点遮罩和按 Esc 都不关。填了一半的表单被一次误点清空，
    // 代价远大于少按一次 ×。每个弹窗头部都有可见的关闭按钮，不存在关不掉的死角。
    <div
      className={`modal-overlay${isDrawer ? ' is-drawer' : ''}${isLeftDrawer ? ' is-drawer-left' : ''}`}
      role="presentation"
      style={{ zIndex: layer }}
    >
      <section ref={panelRef} className={`modal-panel${isDrawer ? ' drawer-panel' : ''}${isLeftDrawer ? ' drawer-panel-left' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId.current} style={{ '--modal-width': typeof width === 'number' ? `${width}px` : width } as CSSProperties}>
        <header className="modal-header">
          <strong id={titleId.current} className="modal-title">{title}</strong>
          <button ref={closeButtonRef} className="modal-close" type="button" title="关闭" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>
  );

  return createPortal(modal, document.body);
}
