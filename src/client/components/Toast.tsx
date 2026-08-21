import { X } from 'lucide-react';
import type { ToastKind } from './OrderForm';

export interface ToastMessage {
  id: string;
  message: string;
  kind?: ToastKind;
}

export interface ToastProps {
  messages: ToastMessage[];
  onDismiss: (id: string) => void;
}

export default function Toast({ messages, onDismiss }: ToastProps) {
  return (
    <div aria-live="polite" className="toast-stack">
      {messages.map(({ id, message, kind = 'info' }) => (
        <div key={id} className={`toast toast-${kind}`} role="status">
          <span className="toast-dot" />
          <span>{message}</span>
          <button type="button" title="关闭提示" className="toast-close" onClick={() => onDismiss(id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
