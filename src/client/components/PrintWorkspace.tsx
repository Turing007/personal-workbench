import { Printer, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import CartonLabelView from './carton-label/CartonLabelView';
import type { CartonLabel } from './LabelEditorModal';

export interface PrintWorkspaceProps {
  open: boolean;
  labels: CartonLabel[];
  onClose: () => void;
  onPrinted?: (labels: CartonLabel[]) => void | Promise<void>;
}

export default function PrintWorkspace({ open, labels, onClose, onPrinted }: PrintWorkspaceProps) {
  if (!open) return null;
  const content = (
    <div className="print-workspace-shell" role="dialog" aria-label="箱唛打印预览">
      <div className="print-workspace-toolbar">
        <strong>箱唛打印预览（{labels.length} 张）</strong>
        <div style={{ display: 'flex', gap: 7 }}>
          <button type="button" className="button button-secondary" onClick={onClose}><X size={14} />返回编辑</button>
          <button type="button" className="button button-primary" onClick={() => { void Promise.resolve(onPrinted?.(labels)).then(() => window.print()); }}><Printer size={14} />调用浏览器打印</button>
        </div>
      </div>
      <div className="print-workspace-list">
        {labels.map((label) => <div className="print-workspace-label" key={label.id}><CartonLabelView label={label} mode="print" /></div>)}
      </div>
    </div>
  );
  return createPortal(content, document.body);
}
