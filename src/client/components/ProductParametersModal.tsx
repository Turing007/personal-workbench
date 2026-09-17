import { Check, Copy, FileText } from 'lucide-react';
import { useState } from 'react';
import Modal from './Modal';
import { copyText } from '../copy-text';

interface ProductParametersModalProps {
  open: boolean;
  productName?: string;
  parameters?: string;
  onClose: () => void;
}

export default function ProductParametersModal({ open, productName, parameters, onClose }: ProductParametersModalProps) {
  const [copied, setCopied] = useState(false);
  const value = parameters?.trim() ?? '';
  const copy = async () => {
    if (!value) return;
    if (!await copyText(value)) {
      setCopied(false);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return <Modal open={open} title={`参数详情 · ${productName || '未命名产品'}`} onClose={onClose} width={640}>
    <div className="product-parameters-modal-content">
      <div className="product-parameters-modal-toolbar"><span><FileText size={14} />完整参数</span><button className="button button-secondary" type="button" onClick={() => void copy()} disabled={!value}><>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制参数'}</></button></div>
      <div className={value ? 'product-parameters-modal-value' : 'product-detail-muted'}>{value || '暂无参数'}</div>
    </div>
  </Modal>;
}
