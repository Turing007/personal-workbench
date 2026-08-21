import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number | string;
  footer?: ReactNode;
  layer?: number;
}

type ModalStackEntry = {
  id: symbol;
  layer: number;
  sequence: number;
  onClose: () => void;
};

const modalStack = new Map<symbol, ModalStackEntry>();
let modalSequence = 0;
let previousBodyOverflow: string | null = null;

function getTopModal() {
  let top: ModalStackEntry | undefined;
  for (const entry of modalStack.values()) {
    if (!top || entry.layer > top.layer || (entry.layer === top.layer && entry.sequence > top.sequence)) {
      top = entry;
    }
  }
  return top;
}

function handleModalKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  const top = getTopModal();
  if (!top) return;
  event.preventDefault();
  top.onClose();
}

function registerModal(entry: ModalStackEntry) {
  if (!modalStack.size) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleModalKeyDown);
  }
  modalStack.set(entry.id, entry);
}

function unregisterModal(id: symbol) {
  modalStack.delete(id);
  if (modalStack.size) return;
  document.removeEventListener('keydown', handleModalKeyDown);
  document.body.style.overflow = previousBodyOverflow ?? '';
  previousBodyOverflow = null;
}

export default function Modal({ open, title, children, onClose, width = 760, footer, layer = 20 }: ModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const modalId = useRef(Symbol('modal'));
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    previousActiveElement.current = document.activeElement as HTMLElement | null;
    registerModal({ id: modalId.current, layer, sequence: ++modalSequence, onClose: () => onCloseRef.current() });
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
      previousActiveElement.current?.focus?.();
    };
  }, [layer, open]);

  if (!open) return null;

  const modal = (
    <div
      className="modal-overlay"
      role="presentation"
      style={{ zIndex: layer }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={titleId.current} style={{ '--modal-width': typeof width === 'number' ? `${width}px` : width } as CSSProperties}>
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
