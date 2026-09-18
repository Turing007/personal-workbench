import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Customer, CustomerSaveInput } from '../../../shared/customers';
import Modal from '../Modal';
import { useIsNarrow } from '../../use-is-narrow';

export interface CustomerEditorModalProps {
  open: boolean;
  customer?: Customer | null;
  busy?: boolean;
  onClose: () => void;
  onSave: (input: CustomerSaveInput) => Promise<void> | void;
}

const blank: CustomerSaveInput = {
  name: '',
  contactName: '',
  contactPhone: '',
  shippingInfo: '',
  invoiceTitle: '',
  taxNo: '',
};

export default function CustomerEditorModal({ open, customer, busy, onClose, onSave }: CustomerEditorModalProps) {
  const narrow = useIsNarrow();
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
    /* 桌面端保持原有居中弹窗；只有手机端才改成右侧抽屉。 */
    variant={narrow ? 'drawer' : 'dialog'}
    title={customer ? '编辑客户' : '新增客户'}
    onClose={busy ? () => undefined : onClose}
    width={narrow ? 440 : 560}
    footer={<>
      <button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>取消</button>
      <button type="button" className="button button-primary" disabled={busy} onClick={() => { void save(); }}><Save size={14} />{busy ? '保存中…' : '保存客户'}</button>
    </>}
  >
    <div className="customer-editor-form">
      {error && <div className="customer-editor-error" role="alert">{error}</div>}
      <label className="customer-editor-field">客户名称<input className="customer-editor-input" autoFocus value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="例如：张三" /></label>
      <div className="customer-editor-row">
        <label className="customer-editor-field">联系人<input className="customer-editor-input" value={draft.contactName} onChange={(event) => update('contactName', event.target.value)} /></label>
        <label className="customer-editor-field">联系电话<input className="customer-editor-input" value={draft.contactPhone} onChange={(event) => update('contactPhone', event.target.value)} /></label>
      </div>
      <label className="customer-editor-field">收件信息<textarea className="customer-editor-input customer-editor-textarea" rows={4} value={draft.shippingInfo} onChange={(event) => update('shippingInfo', event.target.value)} placeholder="收件人、地址、电话等统一记录" /></label>
      <div className="customer-editor-row">
        <label className="customer-editor-field">开票抬头<input className="customer-editor-input" value={draft.invoiceTitle} onChange={(event) => update('invoiceTitle', event.target.value)} placeholder="开票时使用的单位抬头" /></label>
        <label className="customer-editor-field">税号<input className="customer-editor-input" value={draft.taxNo} onChange={(event) => update('taxNo', event.target.value)} placeholder="纳税人识别号" /></label>
      </div>
    </div>
  </Modal>;
}
