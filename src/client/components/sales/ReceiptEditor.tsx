import { Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { SalesReceipt } from '../../../shared/documents';
import {
  addSalesReceipt,
  deleteSalesReceipt,
  deleteSalesReceiptFile,
  updateSalesReceipt,
  uploadSalesReceiptFile,
} from '../../api';
import ImagePasteUpload, { type ImageAttachment } from '../ImagePasteUpload';

interface ReceiptDraft {
  receivedAt: string;
  amount: string;
  paymentMethod: string;
  note: string;
}

export interface ReceiptEditorProps {
  documentId?: number;
  receipts: SalesReceipt[];
  disabled?: boolean;
  onRefresh: () => Promise<void> | void;
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

const fieldStyle = {
  width: '100%',
  minWidth: 0,
  border: '1px solid #dbe3ea',
  borderRadius: 'var(--radius-ui)',
  padding: '7px 8px',
  font: 'inherit',
  fontSize: 12,
  background: '#fff',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyReceipt(): ReceiptDraft {
  return { receivedAt: today(), amount: '', paymentMethod: '', note: '' };
}

function receiptToDraft(receipt: SalesReceipt): ReceiptDraft {
  return {
    receivedAt: receipt.receivedAt,
    amount: (receipt.amountCents / 100).toFixed(2),
    paymentMethod: receipt.paymentMethod,
    note: receipt.note,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

function toInput(draft: ReceiptDraft) {
  const amount = Number(draft.amount);
  if (!draft.receivedAt) throw new Error('请选择收款日期');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('收款金额必须大于 0');
  return {
    receivedAt: draft.receivedAt,
    amountCents: Math.round((amount + Number.EPSILON) * 100),
    paymentMethod: draft.paymentMethod.trim(),
    note: draft.note.trim(),
  };
}

function savedAttachments(receipt: SalesReceipt): ImageAttachment[] {
  return receipt.files.slice(0, 1).map((file) => ({
    id: String(file.id),
    name: file.originalName,
    url: `/files/${file.relativePath}`,
  }));
}

export default function ReceiptEditor({ documentId, receipts, disabled, onRefresh, onNotify }: ReceiptEditorProps) {
  const [newReceipt, setNewReceipt] = useState<ReceiptDraft>(emptyReceipt);
  const [drafts, setDrafts] = useState<Record<number, ReceiptDraft>>({});
  const [busyKey, setBusyKey] = useState<string>();
  const [error, setError] = useState('');

  useEffect(() => {
    setDrafts(Object.fromEntries(receipts.map((receipt) => [receipt.id, receiptToDraft(receipt)])));
  }, [receipts]);

  const receivedCents = useMemo(
    () => receipts.reduce((total, receipt) => total + receipt.amountCents, 0),
    [receipts],
  );

  const notify = (message: string, tone: 'success' | 'error' | 'info' = 'info') => {
    onNotify?.(message, tone);
  };

  const refresh = async () => {
    await onRefresh();
  };

  const addReceipt = async () => {
    if (!documentId || disabled || busyKey) return;
    setError('');
    setBusyKey('new');
    try {
      await addSalesReceipt(documentId, toInput(newReceipt));
      setNewReceipt(emptyReceipt());
      await refresh();
      notify('收款记录已添加', 'success');
    } catch (reason) {
      const message = errorMessage(reason, '添加收款失败');
      setError(message);
      notify(message, 'error');
    } finally {
      setBusyKey(undefined);
    }
  };

  const saveReceipt = async (receipt: SalesReceipt) => {
    const draft = drafts[receipt.id];
    if (!draft || disabled || busyKey) return;
    setError('');
    setBusyKey(`save-${receipt.id}`);
    try {
      await updateSalesReceipt(receipt.id, toInput(draft));
      await refresh();
      notify('收款记录已更新', 'success');
    } catch (reason) {
      const message = errorMessage(reason, '更新收款失败');
      setError(message);
      notify(message, 'error');
    } finally {
      setBusyKey(undefined);
    }
  };

  const removeReceipt = async (receipt: SalesReceipt) => {
    if (disabled || busyKey || !window.confirm(`确定删除 ${receipt.receivedAt} 的收款记录及付款凭证吗？`)) return;
    setError('');
    setBusyKey(`delete-${receipt.id}`);
    try {
      await deleteSalesReceipt(receipt.id);
      await refresh();
      notify('收款记录已删除', 'success');
    } catch (reason) {
      const message = errorMessage(reason, '删除收款失败');
      setError(message);
      notify(message, 'error');
    } finally {
      setBusyKey(undefined);
    }
  };

  const changeProof = async (receipt: SalesReceipt, attachments: ImageAttachment[]) => {
    const uploaded = attachments.find((attachment) => attachment.file);
    if (!uploaded?.file || disabled || busyKey) return;
    setError('');
    setBusyKey(`proof-${receipt.id}`);
    try {
      if (receipt.files[0]) await deleteSalesReceiptFile(receipt.files[0].id);
      await uploadSalesReceiptFile(receipt.id, uploaded.file);
      await refresh();
      notify('付款凭证已保存', 'success');
    } catch (reason) {
      const message = errorMessage(reason, '付款凭证上传失败');
      setError(message);
      notify(message, 'error');
    } finally {
      setBusyKey(undefined);
    }
  };

  const removeProof = async (attachment: ImageAttachment) => {
    const fileId = Number(attachment.id);
    if (!Number.isInteger(fileId)) return;
    await deleteSalesReceiptFile(fileId);
    await refresh();
    notify('付款凭证已删除', 'success');
  };

  if (!documentId) {
    return <section style={{ padding: 12, border: '1px dashed #cbd5e1', borderRadius: 'var(--radius-ui)', color: '#64748b', fontSize: 12, background: '#f8fafc' }}>
      请先保存销售单，再添加预付款、尾款和付款凭证。
    </section>;
  }

  return <section style={{ display: 'grid', gap: 10, padding: 12, border: '1px solid #e2e8f0', borderRadius: 'var(--radius-ui)', background: '#fff' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <strong style={{ fontSize: 13 }}>收款记录</strong>
      <span style={{ color: '#64748b', fontSize: 12 }}>共 {receipts.length} 笔，已收 ¥{(receivedCents / 100).toFixed(2)}</span>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '130px 120px 150px minmax(180px, 1fr) 38px', gap: 7, alignItems: 'end', padding: 9, background: '#f8fafc', borderRadius: 'var(--radius-ui)' }}>
      <label style={{ fontSize: 11, color: '#64748b' }}>收款日期<input type="date" value={newReceipt.receivedAt} disabled={disabled} onChange={(event) => setNewReceipt({ ...newReceipt, receivedAt: event.target.value })} style={fieldStyle} /></label>
      <label style={{ fontSize: 11, color: '#64748b' }}>金额<input type="number" min="0.01" step="0.01" value={newReceipt.amount} disabled={disabled} onChange={(event) => setNewReceipt({ ...newReceipt, amount: event.target.value })} style={fieldStyle} placeholder="0.00" /></label>
      <label style={{ fontSize: 11, color: '#64748b' }}>付款方式<input value={newReceipt.paymentMethod} disabled={disabled} onChange={(event) => setNewReceipt({ ...newReceipt, paymentMethod: event.target.value })} style={fieldStyle} placeholder="微信 / 转账" /></label>
      <label style={{ fontSize: 11, color: '#64748b' }}>备注<input value={newReceipt.note} disabled={disabled} onChange={(event) => setNewReceipt({ ...newReceipt, note: event.target.value })} style={fieldStyle} placeholder="预付款 / 尾款" /></label>
      <button type="button" className="icon-button" title="添加收款" disabled={disabled || Boolean(busyKey)} onClick={() => void addReceipt()}><Plus size={15} /></button>
    </div>

    {receipts.map((receipt) => {
      const draft = drafts[receipt.id] ?? receiptToDraft(receipt);
      return <div key={receipt.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 210px', gap: 12, padding: 10, border: '1px solid #edf0f2', borderRadius: 'var(--radius-ui)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '130px 120px 150px minmax(160px, 1fr) 34px 34px', gap: 7, alignItems: 'end' }}>
          <label style={{ fontSize: 11, color: '#64748b' }}>收款日期<input type="date" value={draft.receivedAt} disabled={disabled} onChange={(event) => setDrafts({ ...drafts, [receipt.id]: { ...draft, receivedAt: event.target.value } })} style={fieldStyle} /></label>
          <label style={{ fontSize: 11, color: '#64748b' }}>金额<input type="number" min="0.01" step="0.01" value={draft.amount} disabled={disabled} onChange={(event) => setDrafts({ ...drafts, [receipt.id]: { ...draft, amount: event.target.value } })} style={fieldStyle} /></label>
          <label style={{ fontSize: 11, color: '#64748b' }}>付款方式<input value={draft.paymentMethod} disabled={disabled} onChange={(event) => setDrafts({ ...drafts, [receipt.id]: { ...draft, paymentMethod: event.target.value } })} style={fieldStyle} /></label>
          <label style={{ fontSize: 11, color: '#64748b' }}>备注<input value={draft.note} disabled={disabled} onChange={(event) => setDrafts({ ...drafts, [receipt.id]: { ...draft, note: event.target.value } })} style={fieldStyle} /></label>
          <button type="button" className="icon-button" title="保存收款修改" disabled={disabled || Boolean(busyKey)} onClick={() => void saveReceipt(receipt)}><Save size={14} /></button>
          <button type="button" className="icon-button danger" title="删除收款" disabled={disabled || Boolean(busyKey)} onClick={() => void removeReceipt(receipt)}><Trash2 size={14} /></button>
        </div>
        {disabled ? <div style={{ display: 'grid', gap: 6, fontSize: 11, color: '#64748b' }}>
          <span style={{ fontWeight: 600 }}>付款凭证</span>
          {receipt.files[0]
            ? <a href={`/files/${receipt.files[0].relativePath}`} target="_blank" rel="noreferrer" title="查看付款凭证"><img src={`/files/${receipt.files[0].relativePath}`} alt={receipt.files[0].originalName} style={{ width: 92, height: 70, objectFit: 'cover', border: '1px solid #dbe3ea', borderRadius: 'var(--radius-ui)' }} /></a>
            : <span style={{ color: '#94a3b8' }}>无凭证</span>}
        </div> : <ImagePasteUpload
          label="付款凭证"
          value={savedAttachments(receipt)}
          onChange={(attachments) => { void changeProof(receipt, attachments); }}
          onDeleteSaved={removeProof}
          multiple={false}
          maxFiles={1}
          showNotes={false}
        />}
      </div>;
    })}

    {!receipts.length && <div style={{ padding: 12, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>暂无收款记录，可先添加预付款。</div>}
    {error && <div role="alert" style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-ui)', padding: '7px 9px', fontSize: 12 }}>{error}</div>}
  </section>;
}
