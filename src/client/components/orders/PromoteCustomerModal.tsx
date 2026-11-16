import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import { previewTemporaryCustomer, promoteTemporaryCustomer, type TemporaryCustomerPreview } from '../../api';
import type { Customer } from '../../../shared/customers';
import Modal from '../Modal';

export interface PromoteCustomerModalProps {
  name: string;
  open: boolean;
  onClose: () => void;
  onPromoted: (result: { customer: Customer; linkedCount: number }) => void | Promise<void>;
}

const inputStyle = { width: '100%', minWidth: 0, border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', padding: '7px 9px', font: 'inherit', fontSize: 12, background: 'var(--color-surface)' };
const labelStyle = { display: 'grid', gap: 5, color: 'var(--color-text-secondary)', fontSize: 12 };

/** 临时客户转正：先预览将挂接的同名订单，重名挂已有客户，否则新建档案；确认后一次性挂接。 */
export default function PromoteCustomerModal({ name, open, onClose, onPromoted }: PromoteCustomerModalProps) {
  const [preview, setPreview] = useState<TemporaryCustomerPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [shippingInfo, setShippingInfo] = useState('');
  const [invoiceTitle, setInvoiceTitle] = useState('');
  const [taxNo, setTaxNo] = useState('');

  useEffect(() => {
    if (!open || !name.trim()) { setPreview(null); return undefined; }
    let cancelled = false;
    setLoading(true);
    setError('');
    setContactName(''); setContactPhone(''); setShippingInfo(''); setInvoiceTitle(''); setTaxNo('');
    void previewTemporaryCustomer(name).then((result) => { if (!cancelled) setPreview(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '预览失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, name]);

  const existing = preview?.existingCustomer ?? null;
  const orders = preview?.orders ?? [];

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await promoteTemporaryCustomer({ name, contactName, contactPhone, shippingInfo, invoiceTitle, taxNo });
      await onPromoted({ customer: result.customer, linkedCount: result.linkedCount });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '转正失败');
    } finally {
      setBusy(false);
    }
  };

  return <Modal open={open} title="临时客户转正" onClose={busy ? () => undefined : onClose} width={560} footer={<><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>取消</button><button type="button" className="button button-primary" disabled={busy || loading || !preview} onClick={() => { void confirm(); }}><UserRound size={14} />{busy ? '转正中…' : `确认转正并挂接${preview ? `（${orders.length}）` : ''}`}</button></>}>
    <div style={{ display: 'grid', gap: 11 }}>
      {error && <div role="alert" style={{ padding: '8px 10px', border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-danger-soft)', color: 'var(--color-danger)', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'grid', gap: 4 }}><span style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>临时客户名称</span><strong style={{ fontSize: 14 }}>{name}</strong></div>
      {loading && <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>正在预览将挂接的订单…</div>}
      {preview && <>
        {existing
          ? <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-ui)', background: 'var(--color-accent-soft)', color: 'var(--color-accent)', fontSize: 12 }}>已存在正式客户「{existing.name}」{existing.contactName ? `（${existing.contactName}）` : ''}，将直接挂接，不重复创建。</div>
          : <div style={{ display: 'grid', gap: 9 }}>
            <div style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>将新建正式客户档案，可补充以下信息（均可选）：</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              <label style={labelStyle}>联系人<input style={inputStyle} value={contactName} onChange={(event) => setContactName(event.target.value)} /></label>
              <label style={labelStyle}>联系电话<input style={inputStyle} value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} /></label>
            </div>
            <label style={labelStyle}>常用收件信息<textarea rows={2} style={{ ...inputStyle, resize: 'vertical' }} value={shippingInfo} onChange={(event) => setShippingInfo(event.target.value)} /></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              <label style={labelStyle}>开票抬头<input style={inputStyle} value={invoiceTitle} onChange={(event) => setInvoiceTitle(event.target.value)} /></label>
              <label style={labelStyle}>税号<input style={inputStyle} value={taxNo} onChange={(event) => setTaxNo(event.target.value)} /></label>
            </div>
          </div>}
        <div style={{ display: 'grid', gap: 6, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface-subtle)' }}>
          <strong style={{ fontSize: 12 }}>将挂接 {orders.length} 个同名未挂客户订单</strong>
          {orders.length ? <div style={{ maxHeight: 160, overflowY: 'auto', display: 'grid', gap: 3 }}>{orders.map((order) => <span key={order.id} style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{order.orderNo}{order.status === 'draft' ? '（草稿）' : ''}</span>)}</div> : <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>没有可挂接的订单（可能已挂接或名称不一致）。</span>}
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>挂接后这些订单可用客户产品库；订单上的客户名称快照保留不变。</span>
        </div>
      </>}
    </div>
  </Modal>;
}