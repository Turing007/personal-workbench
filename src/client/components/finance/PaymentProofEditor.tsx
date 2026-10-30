import { Check, ClipboardPaste, Pencil, Plus, ReceiptText, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  approveFinanceProof,
  deleteFinanceProof,
  rejectFinanceProof,
  updateFinanceProof,
  uploadFinanceProof,
  voidFinanceProof,
  type ApiFinanceDetail,
} from '../../api';
import type { PaymentProofRecord } from '../../../shared/finance';
import { badgeClass, errorText, money } from './finance-format';
import { thumbUrl } from '../../image-urls';

export interface PaymentProofEditorProps {
  detail: ApiFinanceDetail;
  onRefresh: () => Promise<void>;
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

const proofStatusLabel: Record<PaymentProofRecord['status'], string> = {
  pending: '待审核',
  approved: '已审核',
  rejected: '已驳回',
  void: '已作废',
};

type ProofActionMode = 'edit' | 'approve' | 'reject' | 'delete' | 'void';

interface ProofAction {
  id: number;
  mode: ProofActionMode;
}

interface ProofEditForm {
  paymentDate: string;
  amount: string;
  paymentMethod: string;
  payerName: string;
  transactionNo: string;
  note: string;
}

const paymentMethods = ['银行转账', '微信', '支付宝', '其他'];

/** 客户水单面板：每笔水单单独补录、单独审核，审核通过后自动逐笔生成收款记录。 */
export default function PaymentProofEditor({ detail, onRefresh, onNotify }: PaymentProofEditorProps) {
  const [file, setFile] = useState<File>();
  const [fileUrl, setFileUrl] = useState('');
  const [pasteHint, setPasteHint] = useState('');
  const objectUrlRef = useRef('');
  const amountRef = useRef<HTMLInputElement | null>(null);
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState(paymentMethods[0]);
  const [transactionNo, setTransactionNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<ProofAction>();
  const [editForm, setEditForm] = useState<ProofEditForm>({ paymentDate: '', amount: '', paymentMethod: paymentMethods[0], payerName: '', transactionNo: '', note: '' });
  const [rejectNote, setRejectNote] = useState('');
  const [voidNote, setVoidNote] = useState('财务人员手动作废');
  const [payeeName, setPayeeName] = useState('');

  const activeProof = action ? detail.proofs.find((proof) => proof.id === action.id) : undefined;
  const closeAction = () => setAction(undefined);

  const setProofFile = (next: File | undefined) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = '';
    }
    setFile(next);
    const url = next ? URL.createObjectURL(next) : '';
    setFileUrl(url);
    objectUrlRef.current = url;
  };

  // 组件卸载时释放预览用的 ObjectURL
  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  // 全局粘贴：在财务详情页按 Ctrl+V 直接把剪贴板里的截图填为待上传水单。
  // 只有当剪贴板里真的有图片时才拦截；粘贴文本（如在输入框内）不干预。
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const fromFiles = Array.from(clipboard.files ?? []).filter((item) => item.type.startsWith('image/'));
      // 兼容部分浏览器/剪贴板来源：files 为空时从 items 取图片
      const fromItems = Array.from(clipboard.items ?? [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      const images = fromFiles.length ? fromFiles : fromItems;
      if (!images.length) return;
      event.preventDefault();
      setPasteHint('');
      setProofFile(images[0]);
      amountRef.current?.focus();
      onNotify?.('已从剪贴板读取水单截图，请填写金额后上传', 'info');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onNotify]);

  const beginAction = (mode: ProofActionMode, proof: PaymentProofRecord) => {
    if (busy) return;
    if (mode === 'edit') {
      setEditForm({
        paymentDate: proof.paymentDate ?? '',
        amount: proof.amountCents == null ? '' : String(proof.amountCents / 100),
        paymentMethod: proof.paymentMethod || paymentMethods[0],
        payerName: proof.payerName || '',
        transactionNo: proof.transactionNo || '',
        note: proof.note || '',
      });
    }
    if (mode === 'reject') setRejectNote(proof.reviewNote || '');
    if (mode === 'void') setVoidNote('财务人员手动作废');
    setAction({ id: proof.id, mode });
  };

  const run = async (task: () => Promise<unknown>, successMessage: string, resetPanel = true) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
      if (resetPanel) closeAction();
      await onRefresh();
      onNotify?.(successMessage, 'success');
    } catch (error) { onNotify?.(errorText(error, '操作失败'), 'error'); }
    finally { setBusy(false); }
  };

  const upload = async () => {
    if (!file || !amount || busy) return;
    await run(async () => {
      await uploadFinanceProof(detail.finance.orderId, file, { paymentDate, amountCents: Math.round(Number(amount) * 100), paymentMethod, transactionNo });
      setProofFile(undefined); setAmount(''); setTransactionNo('');
    }, '水单已上传，等待财务审核', false);
  };

  const saveEdit = (proof: PaymentProofRecord) => {
    const payload: Record<string, unknown> = {
      paymentDate: editForm.paymentDate,
      paymentMethod: editForm.paymentMethod,
      payerName: editForm.payerName,
      transactionNo: editForm.transactionNo,
      note: editForm.note,
    };
    if (editForm.amount !== '') payload.amountCents = Math.round(Number(editForm.amount) * 100);
    void run(() => updateFinanceProof(proof.id, payload), '水单信息已保存');
  };

  const approve = (proof: PaymentProofRecord) => {
    void run(() => approveFinanceProof(proof.id, payeeName.trim()), `审核通过，${money(proof.amountCents ?? 0)} 已入账为收款`);
  };

  const reject = (proof: PaymentProofRecord) => {
    const note = rejectNote.trim();
    if (!note) return;
    void run(() => rejectFinanceProof(proof.id, note), '水单已驳回，可通知客户修改后重新上传');
  };

  const remove = (proof: PaymentProofRecord) => {
    void run(() => deleteFinanceProof(proof.id), '水单已删除');
  };

  const voidApproved = (proof: PaymentProofRecord) => {
    void run(() => voidFinanceProof(proof.id, voidNote.trim() || '财务人员手动作废'), '水单已作废，对应收款已冲销');
  };

  return <section className="finance-section">
    <div className="finance-section-heading"><div><strong>客户水单</strong><span>上传凭证不等于到账，每笔水单单独审核通过后才计入已收</span></div><span className="finance-section-count">{detail.proofs.length} 张</span></div>
    <div className="finance-proof-upload">
      {file && fileUrl ? <a href={fileUrl} target="_blank" rel="noreferrer" className="finance-proof-thumb" title="查看待上传水单原图"><img src={fileUrl} alt={file.name} /></a> : null}
      <label className="finance-file-picker"><Upload size={15} />{file ? file.name : '选择水单图片'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setProofFile(event.target.files?.[0])} /></label>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}><ClipboardPaste size={14} />支持 Ctrl+V 粘贴截图</span>
      <input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} aria-label="付款日期" />
      <input ref={amountRef} type="number" min="0.01" step="0.01" placeholder="付款金额" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} aria-label="付款方式">{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select>
      <input placeholder="收款人（可选，如：对公户 / 张会计）" value={payeeName} onChange={(event) => setPayeeName(event.target.value)} />
      <input placeholder="交易流水号（可选）" value={transactionNo} onChange={(event) => setTransactionNo(event.target.value)} />
      <button className="button button-primary" type="button" disabled={!file || !amount || busy} onClick={() => void upload()}><Plus size={14} />上传水单</button>
    </div>
    {(pasteHint || (file && !amount)) && <div style={{ color: 'var(--color-warning-text)', fontSize: 12, marginTop: 4 }}>{pasteHint || '已读取待上传水单图片，请填写付款金额后点击「上传水单」'}</div>}
    <div className="finance-proof-list">{detail.proofs.length ? detail.proofs.map((proof) => <div className="finance-proof-row" key={proof.id}>
      <a href={proof.url} target="_blank" rel="noreferrer" className="finance-proof-thumb"><img src={thumbUrl(proof.url, 240)} alt={proof.originalName} loading="lazy" decoding="async" /></a>
      <div className="finance-proof-main"><strong>{proof.originalName}</strong><span>{proof.paymentDate || '未填日期'} · {proof.amountCents == null ? '待补金额' : money(proof.amountCents)} · {proof.paymentMethod || '未填方式'}</span>{proof.payerName && <small>付款人：{proof.payerName}</small>}{proof.transactionNo && <small>流水号：{proof.transactionNo}</small>}{proof.note && <small>备注：{proof.note}</small>}{proof.reviewNote && <small className="finance-error-text">审核备注：{proof.reviewNote}</small>}</div>
      <span className={badgeClass(proof.status)}>{proofStatusLabel[proof.status]}</span>
      <div className="row-actions">
        {(proof.status === 'pending' || proof.status === 'rejected') && <>
          <button className="icon-button" type="button" title="编辑 / 补录付款信息" disabled={busy} onClick={() => beginAction('edit', proof)}><Pencil size={14} /></button>
          <button className="icon-button" type="button" title={proof.amountCents != null && proof.paymentDate ? '审核通过并入账' : '请先补录付款日期与金额'} disabled={busy || proof.amountCents == null || !proof.paymentDate} onClick={() => beginAction('approve', proof)}><Check size={14} /></button>
          <button className="icon-button danger" type="button" title="驳回水单" disabled={busy} onClick={() => beginAction('reject', proof)}><X size={14} /></button>
          <button className="icon-button danger" type="button" title="删除水单" disabled={busy} onClick={() => beginAction('delete', proof)}><Trash2 size={14} /></button>
        </>}
        {proof.status === 'approved' && <button className="button button-ghost" type="button" disabled={busy} onClick={() => beginAction('void', proof)}>作废</button>}
      </div>
      {action && activeProof && activeProof.id === proof.id && <div className={`finance-proof-panel${action.mode === 'delete' || action.mode === 'reject' || action.mode === 'void' ? ' finance-panel-danger' : ''}`}>
        {action.mode === 'edit' && <>
          <p>补录或修正这张水单的付款信息；保存后仍保持待审核状态，需再次确认才会入账。</p>
          <div className="finance-proof-form">
            <input type="date" value={editForm.paymentDate} aria-label="付款日期" onChange={(event) => setEditForm((prev) => ({ ...prev, paymentDate: event.target.value }))} />
            <input type="number" min="0.01" step="0.01" placeholder="付款金额（元）" value={editForm.amount} onChange={(event) => setEditForm((prev) => ({ ...prev, amount: event.target.value }))} />
            <select value={editForm.paymentMethod} aria-label="付款方式" onChange={(event) => setEditForm((prev) => ({ ...prev, paymentMethod: event.target.value }))}>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select>
            <input placeholder="付款人姓名（可选）" value={editForm.payerName} onChange={(event) => setEditForm((prev) => ({ ...prev, payerName: event.target.value }))} />
            <input placeholder="交易流水号（可选）" value={editForm.transactionNo} onChange={(event) => setEditForm((prev) => ({ ...prev, transactionNo: event.target.value }))} />
            <input placeholder="备注（可选）" value={editForm.note} onChange={(event) => setEditForm((prev) => ({ ...prev, note: event.target.value }))} />
          </div>
          <div className="finance-proof-actions"><button className="button button-ghost" type="button" disabled={busy} onClick={closeAction}>取消</button><button className="button button-primary" type="button" disabled={busy} onClick={() => saveEdit(proof)}>保存修改</button></div>
        </>}
        {action.mode === 'approve' && <>
          <p>确认通过这笔水单？将按金额 {money(activeProof.amountCents ?? 0)}、付款日 {activeProof.paymentDate ?? ''} 生成一条收款记录并计入订单已收。</p>
          <input placeholder="收款人（可选，如：对公户 / 张会计）" value={payeeName} aria-label="收款人" onChange={(event) => setPayeeName(event.target.value)} />
          <div className="finance-proof-actions"><button className="button button-ghost" type="button" disabled={busy} onClick={closeAction}>取消</button><button className="button button-primary" type="button" disabled={busy} onClick={() => approve(proof)}>确认入账</button></div>
        </>}
        {action.mode === 'reject' && <>
          <p>驳回后这笔水单不计入收款，客户可按驳回原因修改后重新提交。</p>
          <input placeholder="请填写驳回原因（必填）" value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} />
          <div className="finance-proof-actions"><button className="button button-ghost" type="button" disabled={busy} onClick={closeAction}>取消</button><button className="button button-danger" type="button" disabled={busy || !rejectNote.trim()} onClick={() => reject(proof)}>确认驳回</button></div>
        </>}
        {action.mode === 'delete' && <>
          <p>将删除这张水单及其文件，操作不可恢复。若它已生成收款记录，请改用「作废」以冲销收款。</p>
          <div className="finance-proof-actions"><button className="button button-ghost" type="button" disabled={busy} onClick={closeAction}>取消</button><button className="button button-danger" type="button" disabled={busy} onClick={() => remove(proof)}>确认删除</button></div>
        </>}
        {action.mode === 'void' && <>
          <p>作废会冲销这笔水单生成的收款记录，并重算订单未收金额。</p>
          <input placeholder="作废备注" value={voidNote} onChange={(event) => setVoidNote(event.target.value)} />
          <div className="finance-proof-actions"><button className="button button-ghost" type="button" disabled={busy} onClick={closeAction}>取消</button><button className="button button-danger" type="button" disabled={busy} onClick={() => voidApproved(proof)}>确认作废</button></div>
        </>}
      </div>}
    </div>) : <div className="finance-empty">暂无水单，上传客户付款截图后在这里逐笔核验。</div>}</div>
    <div className="finance-section-heading"><div><strong>收款记录</strong><span>每笔审核通过的水单自动记一笔账，与水单一一对应</span></div><span className="finance-section-count">{detail.receipts.length} 笔</span></div>
    <div className="finance-receipt-list">{detail.receipts.length ? [...detail.receipts].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).map((receipt) => <div className="finance-receipt-row" key={receipt.id}>
      <ReceiptText size={15} />
      <div className="finance-receipt-main"><strong>{money(receipt.amountCents)}</strong><span>{receipt.receivedAt} · {receipt.paymentMethod || '未填方式'}{receipt.payeeName ? ` · 收款人 ${receipt.payeeName}` : ''} · 来自水单 #{receipt.paymentProofId ?? '—'}{receipt.note ? ` · ${receipt.note}` : ''}</span></div>
    </div>) : <div className="finance-empty">暂无收款记录。每笔水单审核通过后会在这里自动记账。</div>}</div>
  </section>;
}
