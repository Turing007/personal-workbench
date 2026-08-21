import { Check, FileText, Plus, RefreshCw, Search, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '../components/Modal';
import {
  approveFinanceProof,
  createFinanceInvoice,
  deleteFinanceInvoiceFile,
  getOrderFinance,
  issueFinanceInvoice,
  listFinanceOrders,
  rejectFinanceProof,
  sendFinanceInvoice,
  submitFinanceInvoice,
  uploadFinanceInvoiceFile,
  uploadFinanceProof,
  voidFinanceInvoice,
  voidFinanceProof,
  type ApiFinanceDetail,
} from '../api';
import {
  FINANCE_PAYMENT_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  PAYMENT_PROOF_STATUS_LABELS,
  type FinanceInvoice,
  type FinanceInvoiceFile,
  type FinanceListResult,
  type FinancePaymentStatus,
  type FinanceProofStatus,
  type InvoiceStatus,
  type PaymentProofRecord,
} from '../../shared/finance';

interface FinancePageProps {
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
  initialOrderId?: number;
}

const money = (cents: number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100);
const errorText = (error: unknown, fallback: string) => error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : fallback;
const badgeClass = (value: string) => value === 'paid' || value === 'approved' || value === 'sent' ? 'badge badge-success' : value === 'partial' || value === 'pending' || value === 'pending_issue' || value === 'issued' ? 'badge badge-warning' : value === 'overpaid' ? 'badge badge-info' : 'badge badge-neutral';
const orderStatusLabels: Record<string, string> = { label_pending: '待打印箱唛', pending_stock: '待备货', stock_reported: '已备货', pending_packing: '待打包', ship_pending: '待发货', shipped: '已发货' };

function formatFileSize(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function ProofPanel({ detail, onRefresh, onNotify }: { detail: ApiFinanceDetail; onRefresh: () => Promise<void>; onNotify: FinancePageProps['onNotify'] }) {
  const [file, setFile] = useState<File>();
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState('银行转账');
  const [transactionNo, setTransactionNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<number>();

  const upload = async () => {
    if (!file || busy) return;
    setBusy(true);
    try {
      await uploadFinanceProof(detail.finance.orderId, file, { paymentDate, amountCents: Math.round(Number(amount) * 100), paymentMethod, transactionNo });
      setFile(undefined); setAmount(''); setTransactionNo(''); await onRefresh(); onNotify?.('水单已上传，等待财务审核', 'success');
    } catch (error) { onNotify?.(errorText(error, '水单上传失败'), 'error'); }
    finally { setBusy(false); }
  };
  const approve = async (proof: PaymentProofRecord) => {
    if (busy) return;
    setBusy(true);
    try { await approveFinanceProof(proof.id); await onRefresh(); onNotify?.('水单审核通过，收款已入账', 'success'); }
    catch (error) { onNotify?.(errorText(error, '审核失败'), 'error'); }
    finally { setBusy(false); }
  };
  const reject = async (proof: PaymentProofRecord) => {
    const note = window.prompt('请输入驳回原因', proof.reviewNote || '');
    if (!note || busy) return;
    setBusy(true); setRejecting(proof.id);
    try { await rejectFinanceProof(proof.id, note); await onRefresh(); onNotify?.('水单已驳回', 'success'); }
    catch (error) { onNotify?.(errorText(error, '驳回失败'), 'error'); }
    finally { setBusy(false); setRejecting(undefined); }
  };
  const voidProof = async (proof: PaymentProofRecord) => {
    if (!window.confirm('作废后会冲销该笔收款，确定继续吗？') || busy) return;
    setBusy(true);
    try { await voidFinanceProof(proof.id, '财务人员手动作废'); await onRefresh(); onNotify?.('水单已作废', 'success'); }
    catch (error) { onNotify?.(errorText(error, '作废失败'), 'error'); }
    finally { setBusy(false); }
  };

  return <section className="finance-section">
    <div className="finance-section-heading"><div><strong>客户水单</strong><span>上传凭证不等于到账，审核通过后才计入已收</span></div><span className="finance-section-count">{detail.proofs.length} 张</span></div>
    <div className="finance-proof-upload">
      <label className="finance-file-picker"><Upload size={15} />{file ? file.name : '选择水单图片'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0])} /></label>
      <input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} aria-label="付款日期" />
      <input type="number" min="0.01" step="0.01" placeholder="付款金额" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} aria-label="付款方式"><option>银行转账</option><option>微信</option><option>支付宝</option><option>其他</option></select>
      <input placeholder="交易流水号（可选）" value={transactionNo} onChange={(event) => setTransactionNo(event.target.value)} />
      <button className="button button-primary" type="button" disabled={!file || !amount || busy} onClick={() => void upload()}><Plus size={14} />上传水单</button>
    </div>
    <div className="finance-proof-list">{detail.proofs.length ? detail.proofs.map((proof) => <div className="finance-proof-row" key={proof.id}>
      <a href={proof.url} target="_blank" rel="noreferrer" className="finance-proof-thumb"><img src={proof.url} alt={proof.originalName} /></a>
      <div className="finance-proof-main"><strong>{proof.originalName}</strong><span>{proof.paymentDate || '未填日期'} · {proof.amountCents == null ? '待补金额' : money(proof.amountCents)} · {proof.paymentMethod || '未填方式'}</span>{proof.transactionNo && <small>流水号：{proof.transactionNo}</small>}{proof.reviewNote && <small className="finance-error-text">审核备注：{proof.reviewNote}</small>}</div>
      <span className={badgeClass(proof.status)}>{proof.status === 'pending' ? '待审核' : proof.status === 'approved' ? '已审核' : proof.status === 'rejected' ? '已驳回' : '已作废'}</span>
      <div className="row-actions">{proof.status === 'pending' || proof.status === 'rejected' ? <><button className="icon-button" type="button" title="审核通过" disabled={busy} onClick={() => void approve(proof)}><Check size={14} /></button><button className="icon-button danger" type="button" title="驳回水单" disabled={busy && rejecting !== proof.id} onClick={() => void reject(proof)}><X size={14} /></button></> : null}{proof.status === 'approved' && <button className="button button-ghost" type="button" disabled={busy} onClick={() => void voidProof(proof)}>作废</button>}</div>
    </div>) : <div className="finance-empty">暂无水单，上传客户付款截图后在这里核验。</div>}</div>
  </section>;
}

function InvoicePanel({ detail, onRefresh, onNotify }: { detail: ApiFinanceDetail; onRefresh: () => Promise<void>; onNotify: FinancePageProps['onNotify'] }) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File>();
  const [draft, setDraft] = useState({ invoiceType: '电子普通发票', title: '', taxNo: '', recipientEmail: '', amount: '', taxRate: '13', tax: '', invoiceNo: '' });
  const invoices = detail.invoices;
  const create = async () => {
    setBusy(true);
    try { await createFinanceInvoice(detail.finance.orderId, { invoiceType: draft.invoiceType, title: draft.title, taxNo: draft.taxNo, recipientEmail: draft.recipientEmail, amountCents: Math.round(Number(draft.amount) * 100), taxRateBps: Math.round(Number(draft.taxRate) * 100), taxCents: Math.round(Number(draft.tax || 0) * 100) }); await onRefresh(); onNotify?.('开票申请已创建', 'success'); }
    catch (error) { onNotify?.(errorText(error, '创建发票申请失败'), 'error'); }
    finally { setBusy(false); }
  };
  const submit = async (invoice: FinanceInvoice) => { setBusy(true); try { await submitFinanceInvoice(invoice.id); await onRefresh(); onNotify?.('发票已提交待开票', 'success'); } catch (error) { onNotify?.(errorText(error, '提交开票失败'), 'error'); } finally { setBusy(false); } };
  const issue = async (invoice: FinanceInvoice) => { const number = window.prompt('请输入发票号码', invoice.invoiceNo || ''); if (!number) return; setBusy(true); try { await issueFinanceInvoice(invoice.id, { invoiceNo: number, issuedAt: new Date().toISOString().slice(0, 10) }); await onRefresh(); onNotify?.('发票已标记为已开票', 'success'); } catch (error) { onNotify?.(errorText(error, '标记开票失败'), 'error'); } finally { setBusy(false); } };
  const upload = async (invoice: FinanceInvoice) => { if (!file) return; setBusy(true); try { await uploadFinanceInvoiceFile(invoice.id, file); setFile(undefined); await onRefresh(); onNotify?.('发票文件已上传', 'success'); } catch (error) { onNotify?.(errorText(error, '发票文件上传失败'), 'error'); } finally { setBusy(false); } };
  const send = async (invoice: FinanceInvoice) => { setBusy(true); try { await sendFinanceInvoice(invoice.id); await onRefresh(); onNotify?.('发票已标记为已发送', 'success'); } catch (error) { onNotify?.(errorText(error, '发送发票失败'), 'error'); } finally { setBusy(false); } };
  const voidInvoice = async (invoice: FinanceInvoice) => { if (!window.confirm('作废发票后会保留历史记录，确定继续吗？')) return; setBusy(true); try { await voidFinanceInvoice(invoice.id, '财务人员手动作废'); await onRefresh(); onNotify?.('发票已作废', 'success'); } catch (error) { onNotify?.(errorText(error, '作废发票失败'), 'error'); } finally { setBusy(false); } };
  return <section className="finance-section">
    <div className="finance-section-heading"><div><strong>发票跟踪</strong><span>按订单保存开票资料和发票文件</span></div><span className={badgeClass(detail.finance.invoiceStatus)}>{INVOICE_STATUS_LABELS[detail.finance.invoiceStatus]}</span></div>
    <div className="finance-invoice-form"><input placeholder="发票抬头" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><input placeholder="税号" value={draft.taxNo} onChange={(event) => setDraft({ ...draft, taxNo: event.target.value })} /><input type="email" placeholder="收票邮箱" value={draft.recipientEmail} onChange={(event) => setDraft({ ...draft, recipientEmail: event.target.value })} /><input type="number" min="0.01" step="0.01" placeholder="开票金额" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /><button className="button button-primary" type="button" disabled={busy || !draft.title || !draft.taxNo || !draft.amount} onClick={() => void create()}><Plus size={14} />新建开票申请</button></div>
    <div className="finance-invoice-list">{invoices.length ? invoices.map((invoice) => <div className="finance-invoice-card" key={invoice.id}><div className="finance-invoice-card-head"><strong>{invoice.invoiceType} · {invoice.title || '未填写抬头'}</strong><span className={badgeClass(invoice.status)}>{INVOICE_STATUS_LABELS[invoice.status]}</span></div><div className="finance-invoice-meta"><span>金额 {money(invoice.amountCents)}</span><span>税号 {invoice.taxNo || '未填写'}</span><span>发票号 {invoice.invoiceNo || '未开具'}</span></div><div className="finance-invoice-files">{invoice.files.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><FileText size={14} />{item.originalName}</a>)}{invoice.status !== 'void' && invoice.status !== 'sent' && <><label className="finance-file-picker compact"><Upload size={13} />{file ? file.name : '上传发票'}<input type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0])} /></label>{file && <button className="button button-ghost" type="button" disabled={busy} onClick={() => void upload(invoice)}>保存文件</button>}</>}</div><div className="finance-invoice-actions">{invoice.status === 'incomplete' && <button className="button button-ghost" type="button" disabled={busy} onClick={() => void submit(invoice)}>提交开票</button>}{invoice.status === 'pending_issue' && <button className="button button-ghost" type="button" disabled={busy} onClick={() => void issue(invoice)}>录入发票号码</button>}{invoice.status === 'issued' && <button className="button button-primary" type="button" disabled={busy} onClick={() => void send(invoice)}>标记已发送</button>}{invoice.status !== 'void' && invoice.status !== 'sent' && <button className="button button-ghost danger-text" type="button" disabled={busy} onClick={() => void voidInvoice(invoice)}>作废</button>}</div></div>) : <div className="finance-empty">暂无发票记录，可在上方创建开票申请。</div>}</div>
  </section>;
}

export default function FinancePage({ onNotify, initialOrderId }: FinancePageProps) {
  const [result, setResult] = useState<FinanceListResult>();
  const [query, setQuery] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [proofStatus, setProofStatus] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<number>();
  const [detail, setDetail] = useState<ApiFinanceDetail>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setResult(await listFinanceOrders({ q: query, paymentStatus: paymentStatus as FinancePaymentStatus || undefined, proofStatus: proofStatus as FinanceProofStatus || undefined, invoiceStatus: invoiceStatus as InvoiceStatus || undefined, page: 1, pageSize: 100 })); }
    catch (error) { onNotify?.(errorText(error, '财务列表加载失败'), 'error'); }
    finally { setLoading(false); }
  }, [invoiceStatus, onNotify, paymentStatus, proofStatus, query]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (initialOrderId) setSelectedOrderId(initialOrderId); }, [initialOrderId]);
  const openDetail = async (orderId: number) => { setSelectedOrderId(orderId); try { setDetail(await getOrderFinance(orderId)); } catch (error) { onNotify?.(errorText(error, '财务详情加载失败'), 'error'); } };
  useEffect(() => { if (selectedOrderId) void openDetail(selectedOrderId); }, [selectedOrderId]);
  const refreshDetail = async () => { if (!selectedOrderId) return; setDetail(await getOrderFinance(selectedOrderId)); await load(); };
  const stats = result?.stats;
  const rows = useMemo(() => result?.rows ?? [], [result]);
  return <div className="page-shell finance-page">
    <div className="page-toolbar finance-toolbar"><div><strong className="page-title">财务管理</strong><span className="page-subtitle">核验客户水单、登记收款并跟踪发票</span></div><div className="search-control"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索订单号或客户" /></div><select className="toolbar-select" aria-label="付款状态" value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}><option value="">全部付款</option>{Object.entries(FINANCE_PAYMENT_STATUS_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><select className="toolbar-select" aria-label="水单状态" value={proofStatus} onChange={(event) => setProofStatus(event.target.value)}><option value="">全部水单</option>{Object.entries(PAYMENT_PROOF_STATUS_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><select className="toolbar-select" aria-label="发票状态" value={invoiceStatus} onChange={(event) => setInvoiceStatus(event.target.value)}><option value="">全部发票</option>{Object.entries(INVOICE_STATUS_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><button className="icon-button" type="button" title="刷新财务列表" disabled={loading} onClick={() => void load()}><RefreshCw size={15} /></button></div>
    <div className="finance-stat-grid"><div><span>本期应收</span><strong>{money(stats?.receivableCents ?? 0)}</strong></div><div><span>已收金额</span><strong className="finance-positive">{money(stats?.receivedCents ?? 0)}</strong></div><div><span>未收金额</span><strong className="finance-warning">{money(stats?.outstandingCents ?? 0)}</strong></div><div><span>待审核水单</span><strong>{stats?.pendingProofCount ?? 0}<small> 张</small></strong></div><div><span>待处理发票</span><strong>{stats?.pendingInvoiceCount ?? 0}<small> 笔</small></strong></div></div>
    <section className="table-panel"><div className="table-scroll"><table className="data-table finance-table"><thead><tr>{['订单号', '客户', '日期', '应收', '已收', '未收', '付款', '水单', '发票', '物流', '操作'].map((title) => <th key={title}>{title}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.orderId}><td className="strong-cell finance-order-number">{row.orderNo}</td><td>{row.customerName || '—'}</td><td>{row.orderDate}</td><td>{money(row.receivableCents)}</td><td>{money(row.receivedCents)}</td><td className={row.outstandingCents > 0 ? 'finance-warning' : 'finance-positive'}>{money(row.outstandingCents)}</td><td><span className={badgeClass(row.paymentStatus)}>{FINANCE_PAYMENT_STATUS_LABELS[row.paymentStatus]}</span></td><td><span className={badgeClass(row.proofStatus)}>{PAYMENT_PROOF_STATUS_LABELS[row.proofStatus]}</span></td><td><span className={badgeClass(row.invoiceStatus)}>{INVOICE_STATUS_LABELS[row.invoiceStatus]}</span></td><td>{orderStatusLabels[row.orderStatus] ?? row.orderStatus}</td><td><button className="button button-ghost" type="button" onClick={() => void openDetail(row.orderId)}>查看财务</button></td></tr>)}</tbody></table></div>{loading && <div className="table-state">正在加载财务数据...</div>}{!loading && !rows.length && <div className="table-state">暂无符合条件的财务记录。订单创建后会自动生成应收记录。</div>}</section>
    <Modal open={Boolean(detail)} title={detail ? `财务详情 · ${String(detail.order.order_no ?? '')}` : '财务详情'} onClose={() => { setDetail(undefined); setSelectedOrderId(undefined); }} width={1120}>{detail && <div className="finance-detail"><div className="finance-detail-summary"><div><span>应收金额</span><strong>{money(detail.finance.receivableCents)}</strong></div><div><span>已收金额</span><strong className="finance-positive">{money(detail.finance.receivedCents)}</strong></div><div><span>未收金额</span><strong className={detail.finance.outstandingCents > 0 ? 'finance-warning' : 'finance-positive'}>{money(detail.finance.outstandingCents)}</strong></div><div><span>付款状态</span><b className={badgeClass(detail.finance.paymentStatus)}>{FINANCE_PAYMENT_STATUS_LABELS[detail.finance.paymentStatus]}</b></div></div><ProofPanel detail={detail} onRefresh={refreshDetail} onNotify={onNotify} /><InvoicePanel detail={detail} onRefresh={refreshDetail} onNotify={onNotify} /></div>}</Modal>
  </div>;
}
