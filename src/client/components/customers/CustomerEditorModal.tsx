import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Customer, CustomerSaveInput } from '../../../shared/customers';
import Modal from '../Modal';

export interface CustomerEditorModalProps {
  open: boolean;
  customer?: Customer | null;
  busy?: boolean;
  onClose: () => void;
  onSave: (input: CustomerSaveInput) => Promise<void> | void;
}

const inputStyle = {
  width: '100%',
  minWidth: 0,
  border: '1px solid #dbe3ea',
  borderRadius: 5,
  padding: '8px 9px',
  font: 'inherit',
  fontSize: 12,
  background: '#fff',
};

const blank: CustomerSaveInput = {
  name: '',
  contactName: '',
  contactPhone: '',
  shippingInfo: '',
  invoiceTitle: '',
  taxNo: '',
};

export default function CustomerEditorModal({ open, customer, busy, onClose, onSave }: CustomerEditorModalProps) {
  const [draft, setDraft] = useState<CustomerSaveInput>(blank);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(customer ? {
      name: customer.name,
      contactName: customer.contactName,
      contactPhone: customer.contactPhone,
      shippingInfo: customer.shippingInfo,
      invoiceTitle: customer.invoiceTitle,
      taxNo: customer.taxNo,
    } : blank);
    setError('');
  }, [customer, open]);

  const update = <K extends keyof CustomerSaveInput>(key: K, value: CustomerSaveInput[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (!draft.name.trim()) {
      setError('请填写客户名称');
      return;
    }
    setError('');
    try {
      await onSave({
        name: draft.name.trim(),
        contactName: draft.contactName.trim(),
        contactPhone: draft.contactPhone.trim(),
        shippingInfo: draft.shippingInfo.trim(),
        invoiceTitle: draft.invoiceTitle.trim(),
        taxNo: draft.taxNo.trim(),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? '保存客户失败'));
    }
  };

  return <Modal
    open={open}
    title={customer ? '编辑客户' : '新增客户'}
    onClose={busy ? () => undefined : onClose}
    width={560}
    footer={<>
      <button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>取消</button>
      <button type="button" className="button button-primary" disabled={busy} onClick={() => { void save(); }}><Save size={14} />{busy ? '保存中…' : '保存客户'}</button>
    </>}
  >
    <div style={{ display: 'grid', gap: 11 }}>
      {error && <div role="alert" style={{ padding: '8px 10px', border: '1px solid #fecaca', borderRadius: 5, background: '#fef2f2', color: '#b91c1c', fontSize: 12 }}>{error}</div>}
      <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>客户名称<input autoFocus value={draft.name} onChange={(event) => update('name', event.target.value)} style={inputStyle} placeholder="例如：张三" /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>联系人<input value={draft.contactName} onChange={(event) => update('contactName', event.target.value)} style={inputStyle} /></label>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>联系电话<input value={draft.contactPhone} onChange={(event) => update('contactPhone', event.target.value)} style={inputStyle} /></label>
      </div>
      <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>收件信息<textarea rows={4} value={draft.shippingInfo} onChange={(event) => update('shippingInfo', event.target.value)} style={{ ...inputStyle, resize: 'vertical' }} placeholder="收件人、地址、电话等统一记录" /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>开票抬头<input value={draft.invoiceTitle} onChange={(event) => update('invoiceTitle', event.target.value)} style={inputStyle} placeholder="开票时使用的单位抬头" /></label>
        <label style={{ display: 'grid', gap: 5, color: '#64748b', fontSize: 12 }}>税号<input value={draft.taxNo} onChange={(event) => update('taxNo', event.target.value)} style={inputStyle} placeholder="纳税人识别号" /></label>
      </div>
    </div>
  </Modal>;
}
