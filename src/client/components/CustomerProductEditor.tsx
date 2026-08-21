import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import Modal from './Modal';
import type { CustomerProduct } from './OrderForm';

export interface CustomerProductEditorProps {
  open: boolean;
  product?: CustomerProduct;
  onClose: () => void;
  onSave: (product: CustomerProduct) => Promise<void> | void;
}

const fieldStyle = { width: '100%', minWidth: 0, border: '1px solid #dbe3ea', borderRadius: 5, padding: '8px 9px', color: '#1f2937', background: '#fff', font: 'inherit', fontSize: 12 };

function blankProduct(): CustomerProduct {
  return { id: `customer-new-${Date.now()}`, name: '', sku: '', specification: '', packCount: 1 };
}

export default function CustomerProductEditor({ open, product, onClose, onSave }: CustomerProductEditorProps) {
  const [draft, setDraft] = useState<CustomerProduct>(() => product ?? blankProduct());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(product ?? blankProduct());
    setError('');
    setBusy(false);
  }, [open, product]);

  const update = <K extends keyof CustomerProduct>(key: K, value: CustomerProduct[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const save = async () => {
    const name = draft.name.trim();
    const packCount = Math.trunc(Number(draft.packCount));
    if (!name) return setError('请填写品名');
    if (!Number.isSafeInteger(packCount) || packCount < 1) return setError('装箱数必须是正整数');
    setBusy(true);
    setError('');
    try {
      await onSave({ ...draft, name, sku: draft.sku.trim(), specification: draft.specification.trim(), packCount });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? '保存失败'));
      setBusy(false);
    }
  };

  return <Modal open={open} title={product ? '编辑客户产品' : '添加客户产品'} onClose={busy ? () => undefined : onClose} width={620} footer={<><button type="button" onClick={onClose} disabled={busy} style={{ border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', padding: '8px 14px', cursor: busy ? 'not-allowed' : 'pointer' }}>取消</button><button type="button" onClick={() => { void save(); }} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, borderRadius: 5, background: '#0f766e', color: '#fff', padding: '8px 15px', cursor: busy ? 'wait' : 'pointer' }}><Save size={14} />{busy ? '保存中…' : '保存并加入订单'}</button></>}>
    <div style={{ display: 'grid', gap: 12 }}>
      {error && <div role="alert" style={{ padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 5, color: '#b91c1c', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>品名<input autoFocus value={draft.name} onChange={(event) => update('name', event.target.value)} style={fieldStyle} /></label>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>SKU<input value={draft.sku} onChange={(event) => update('sku', event.target.value)} style={fieldStyle} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10 }}>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>规格<input value={draft.specification} onChange={(event) => update('specification', event.target.value)} style={fieldStyle} /></label>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>装箱数<input type="number" min={1} step={1} value={draft.packCount} onChange={(event) => update('packCount', Math.max(1, Math.trunc(Number(event.target.value) || 1)))} style={fieldStyle} /></label>
      </div>
    </div>
  </Modal>;
}
