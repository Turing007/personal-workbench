import { Check, Pencil, RotateCcw, Save, Trash2, Undo2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  createFinanceRefund,
  deleteFinanceRefund,
  updateFinanceRefund,
  type ApiFinanceDetail,
} from '../../api';
import type { FinanceRefund } from '../../../shared/finance';
import { errorText, money } from './finance-format';

export interface RefundEditorProps {
  detail: ApiFinanceDetail;
  onRefresh: () => Promise<void>;
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

const paymentMethods = ['银行转账', '微信', '支付宝', '现金', '其他'];

interface RefundEditForm {
  refundedAt: string;
  amount: string;
  paymentMethod: string;
  reason: string;
  note: string;
}

/** 退款记录：退款冲减订单已收；超收时可一键按超收金额预填退款。 */
export default function RefundEditor({ detail, onRefresh, onNotify }: RefundEditorProps) {
  const [refundedAt, setRefundedAt] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState(paymentMethods[0]);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number>();
  const [editForm, setEditForm] = useState<RefundEditForm>({ refundedAt: '', amount: '', paymentMethod: paymentMethods[0], reason: '', note: '' });
  const [deletingId, setDeletingId] = useState<number>();
  const amountRef = useRef<HTMLInputElement | null>(null);

  const refunds = detail.refunds;
  const overpaidCents = detail.finance.overpaidCents;
  const receivedCents = detail.finance.receivedCents;
  const maxAmount = (receivedCents / 100).toFixed(2);

  const run = async (task: () => Promise<unknown>, message: string, reset?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
      reset?.();
      await onRefresh();
      onNotify?.(message, 'success');
    } catch (error) {
      onNotify?.(errorText(error, '操作失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const parseAmount = (value: string, maxCents: number): number | null => {
    if (!value.trim()) {
      onNotify?.('请填写退款金额', 'error');
      return null;
    }
    const cents = Math.round(Number(value) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      onNotify?.('退款金额必须大于 0', 'error');
      return null;
    }
    if (cents > maxCents) {
      onNotify?.(`退款金额不能超过当前已收 ${money(maxCents)}`, 'error');
      return null;
    }
    return cents;
  };

  const submit = () => {
    const cents = parseAmount(amount, receivedCents);
    if (cents == null) return;
    void run(
      () => createFinanceRefund(detail.finance.orderId, {
        refundedAt,
        amountCents: cents,
        paymentMethod,
        reason: reason.trim(),
        note: note.trim(),
      }),
      `已记录退款 ${money(cents)}，订单已收与付款状态已重算`,
      () => { setAmount(''); setReason(''); setNote(''); },
    );
  };

  const beginEdit = (refund: FinanceRefund) => {
    if (busy) return;
    setDeletingId(undefined);
    setEditingId(refund.id);
    setEditForm({
      refundedAt: refund.refundedAt,
      amount: String(refund.amountCents / 100),
      paymentMethod: refund.paymentMethod || paymentMethods[0],
      reason: refund.reason,
      note: refund.note,
    });
  };

  const saveEdit = (refund: FinanceRefund) => {
    // receivedCents 已是扣除全部退款后的净额；这笔退款允许改到的上限
    // = 收款合计 - 其他退款 = 当前净已收 + 本笔原金额。
    const maxCents = receivedCents + refund.amountCents;
    const cents = parseAmount(editForm.amount, maxCents);
    if (cents == null) return;
    void run(
      () => updateFinanceRefund(refund.id, {
        refundedAt: editForm.refundedAt,
        amountCents: cents,
        paymentMethod: editForm.paymentMethod,
        reason: editForm.reason.trim(),
        note: editForm.note.trim(),
      }),
      '退款记录已更新，订单已收与付款状态已重算',
      () => setEditingId(undefined),
    );
  };

  const remove = (refund: FinanceRefund) => {
    void run(
      () => deleteFinanceRefund(refund.id),
      `已删除退款 ${money(refund.amountCents)}，订单已收与付款状态已重算`,
      () => setDeletingId(undefined),
    );
  };

  const fillOverpaid = () => {
    setAmount((overpaidCents / 100).toFixed(2));
    if (!reason.trim()) setReason('退还超收');
    amountRef.current?.focus();
  };

  return <section className="finance-section">
    <div className="finance-section-heading">
      <div>
        <strong>退款记录</strong>
        <span>退款会冲减订单已收并重算未收、超收与付款状态；可退金额不超过当前已收</span>
      </div>
      <span className="finance-section-count">{refunds.length} 笔</span>
    </div>
    {overpaidCents > 0 && <div className="notice notice-warning" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
      <span>客户当前超收 <strong>{money(overpaidCents)}</strong>，可退还后把付款状态恢复为已付款。</span>
      <button className="button button-secondary" type="button" disabled={busy} onClick={fillOverpaid}><Undo2 size={14} />退还超收</button>
    </div>}
    <div className="finance-proof-upload">
      <input type="date" value={refundedAt} aria-label="退款日期" onChange={(event) => setRefundedAt(event.target.value)} />
      <input ref={amountRef} type="number" min="0.01" max={maxAmount} step="0.01" placeholder="退款金额" value={amount} aria-label="退款金额" onChange={(event) => setAmount(event.target.value)} />
      <select value={paymentMethod} aria-label="退款方式" onChange={(event) => setPaymentMethod(event.target.value)}>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select>
      <input placeholder="退款原因（可选）" value={reason} aria-label="退款原因" onChange={(event) => setReason(event.target.value)} />
      <input placeholder="备注（可选）" value={note} aria-label="退款备注" onChange={(event) => setNote(event.target.value)} />
      <button className="button button-primary" type="button" disabled={busy || !amount.trim()} onClick={submit}><RotateCcw size={14} />记一笔退款</button>
    </div>
    <div className="finance-receipt-list">{refunds.length ? refunds.map((refund) => <div className="finance-receipt-row" key={refund.id} style={{ flexWrap: 'wrap' }}>
      <RotateCcw size={15} />
      <div className="finance-receipt-main">
        <strong style={{ color: 'var(--color-warning-text)' }}>-{money(refund.amountCents)}</strong>
        <span>{refund.refundedAt} · {refund.paymentMethod || '未填方式'}{refund.reason ? ` · ${refund.reason}` : ''}{refund.note ? ` · ${refund.note}` : ''}{refund.createdBy ? ` · 操作人 ${refund.createdBy}` : ''}</span>
      </div>
      <div className="row-actions">
        <button className="icon-button" type="button" title="编辑退款" disabled={busy} onClick={() => beginEdit(refund)}><Pencil size={14} /></button>
        <button className="icon-button danger" type="button" title="删除退款" disabled={busy} onClick={() => { setEditingId(undefined); setDeletingId(refund.id); }}><Trash2 size={14} /></button>
      </div>
      {editingId === refund.id && <div className="finance-proof-panel" style={{ flexBasis: '100%' }}>
        <p>调整这笔退款后，订单已收、未收、超收和付款状态会立即重算。</p>
        <div className="finance-proof-form">
          <input type="date" value={editForm.refundedAt} aria-label="退款日期" onChange={(event) => setEditForm((prev) => ({ ...prev, refundedAt: event.target.value }))} />
          <input type="number" min="0.01" step="0.01" placeholder="退款金额（元）" value={editForm.amount} aria-label="退款金额" onChange={(event) => setEditForm((prev) => ({ ...prev, amount: event.target.value }))} />
          <select value={editForm.paymentMethod} aria-label="退款方式" onChange={(event) => setEditForm((prev) => ({ ...prev, paymentMethod: event.target.value }))}>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select>
          <input placeholder="退款原因（可选）" value={editForm.reason} onChange={(event) => setEditForm((prev) => ({ ...prev, reason: event.target.value }))} />
          <input placeholder="备注（可选）" value={editForm.note} onChange={(event) => setEditForm((prev) => ({ ...prev, note: event.target.value }))} />
        </div>
        <div className="finance-proof-actions">
          <button className="button button-ghost" type="button" disabled={busy} onClick={() => setEditingId(undefined)}><X size={14} />取消</button>
          <button className="button button-primary" type="button" disabled={busy} onClick={() => saveEdit(refund)}><Save size={14} />保存修改</button>
        </div>
      </div>}
      {deletingId === refund.id && <div className="finance-proof-panel finance-panel-danger" style={{ flexBasis: '100%' }}>
        <p>删除这笔退款后，订单已收会加回 {money(refund.amountCents)}。确定删除？</p>
        <div className="finance-proof-actions">
          <button className="button button-ghost" type="button" disabled={busy} onClick={() => setDeletingId(undefined)}><X size={14} />取消</button>
          <button className="button button-danger" type="button" disabled={busy} onClick={() => remove(refund)}><Check size={14} />确认删除</button>
        </div>
      </div>}
    </div>) : <div className="finance-empty">暂无退款记录。客户多付或取消订单时，在这里登记退款。</div>}</div>
  </section>;
}
