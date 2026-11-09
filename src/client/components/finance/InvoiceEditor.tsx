import { FileText, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  createFinanceInvoice,
  deleteFinanceInvoiceFile,
  getCustomer,
  issueFinanceInvoice,
  sendFinanceInvoice,
  submitFinanceInvoice,
  uploadFinanceInvoiceFile,
  voidFinanceInvoice,
  type ApiFinanceDetail,
} from '../../api';
import type { Customer } from '../../../shared/customers';
import { INVOICE_NOT_REQUIRED_LABEL, isPersonalSettlement } from '../../../shared/settlement';
import { INVOICE_STATUS_LABELS, type FinanceInvoice, type InvoiceStatus } from '../../../shared/finance';
import { badgeClass, errorText, money } from './finance-format';

export interface InvoiceEditorProps {
  detail: ApiFinanceDetail;
  /** 当前订单关联的客户主档，用于自动带入/调用开票抬头与税号 */
  customer?: Customer;
  onRefresh: () => Promise<void>;
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

/** 从财务详情订单行里解析客户 ID，兼容 snake_case 与 camelCase 两种形态 */
function orderCustomerId(detail: ApiFinanceDetail): number | null {
  const order = detail.order;
  const raw = (order.customer_id as unknown) ?? (order.customerId as unknown);
  const numeric = Number(raw);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

/** 订单发票跟踪面板：开票资料 → 待开票 → 已开票 → 已发送，作废保留历史记录。 */
export default function InvoiceEditor({ detail, customer, onRefresh, onNotify }: InvoiceEditorProps) {
  const [busy, setBusy] = useState(false);
  const [fileByInvoice, setFileByInvoice] = useState<Record<number, File>>({});
  const [draft, setDraft] = useState({ invoiceType: '电子普通发票', title: '', taxNo: '', recipientEmail: '', amount: '', taxRate: '13', tax: '' });
  /** 记录已初始化开票资料的订单，避免客户列表刷新或用户手工修改后再次被覆盖 */
  const initializedOrder = useRef<number | null>(null);
  const invoices = detail.invoices;
  const personal = isPersonalSettlement(detail.order.settlement_type ?? detail.order.settlementType);
  const companyName = String(detail.order.company_name ?? '') || '未分配公司';
  const validInvoiceTotal = invoices.filter((invoice) => invoice.status !== 'void').reduce((sum, invoice) => sum + invoice.amountCents, 0);

  useEffect(() => {
    const orderId = Number(detail.order.id ?? detail.order.order_id ?? 0);
    const customerId = orderCustomerId(detail);
    if (initializedOrder.current === orderId) return;
    if (!customerId) {
      initializedOrder.current = orderId;
      return undefined;
    }
    if (customer?.id === customerId) {
      setDraft((current) => ({ ...current, title: customer.invoiceTitle ?? '', taxNo: customer.taxNo ?? '' }));
      initializedOrder.current = orderId;
      return undefined;
    }
    // 客户列表还没加载完或仍是旧快照时，直接按订单上的客户 ID 补拉一次，
    // 避免用户刚打开页面就查财务时开票抬头/税号被留空。
    let cancelled = false;
    void getCustomer(customerId).then((fresh) => {
      if (cancelled || initializedOrder.current === orderId) return;
      setDraft((current) => ({ ...current, title: fresh.invoiceTitle ?? '', taxNo: fresh.taxNo ?? '' }));
      initializedOrder.current = orderId;
    }).catch(() => { /* 客户资料拉取失败不阻断财务详情查看 */ });
    return () => { cancelled = true; };
  }, [detail, customer]);

  const create = async () => {
    setBusy(true);
    try { await createFinanceInvoice(detail.finance.orderId, { invoiceType: draft.invoiceType, title: draft.title, taxNo: draft.taxNo, recipientEmail: draft.recipientEmail, amountCents: Math.round(Number(draft.amount) * 100), taxRateBps: Math.round(Number(draft.taxRate) * 100), taxCents: Math.round(Number(draft.tax || 0) * 100) }); await onRefresh(); onNotify?.('开票申请已创建', 'success'); }
    catch (error) { onNotify?.(errorText(error, '创建发票申请失败'), 'error'); }
    finally { setBusy(false); }
  };
  const applyCustomer = async () => {
    const customerId = orderCustomerId(detail);
    if (!customerId) { onNotify?.('当前订单未关联客户资料，无法调用开票信息', 'error'); return; }
    if (busy) return;
    setBusy(true);
    try {
      const fresh = await getCustomer(customerId);
      if (!fresh.invoiceTitle && !fresh.taxNo) { onNotify?.('客户未填写开票抬头或税号', 'info'); return; }
      setDraft((current) => ({ ...current, title: fresh.invoiceTitle ?? '', taxNo: fresh.taxNo ?? '' }));
      onNotify?.('已调用客户开票信息', 'info');
    } catch (error) {
      onNotify?.(errorText(error, '调用客户开票信息失败'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const submit = async (invoice: FinanceInvoice) => { setBusy(true); try { await submitFinanceInvoice(invoice.id); await onRefresh(); onNotify?.('发票已提交待开票', 'success'); } catch (error) { onNotify?.(errorText(error, '提交开票失败'), 'error'); } finally { setBusy(false); } };
  const issue = async (invoice: FinanceInvoice) => { const number = window.prompt('请输入发票号码', invoice.invoiceNo || ''); if (!number) return; setBusy(true); try { await issueFinanceInvoice(invoice.id, { invoiceNo: number, issuedAt: new Date().toISOString().slice(0, 10) }); await onRefresh(); onNotify?.('发票已标记为已开票', 'success'); } catch (error) { onNotify?.(errorText(error, '标记开票失败'), 'error'); } finally { setBusy(false); } };
  const upload = async (invoice: FinanceInvoice) => {
    const file = fileByInvoice[invoice.id];
    if (!file) return;
    setBusy(true);
    try { await uploadFinanceInvoiceFile(invoice.id, file); setFileByInvoice((current) => { const next = { ...current }; delete next[invoice.id]; return next; }); await onRefresh(); onNotify?.('发票文件已上传', 'success'); }
    catch (error) { onNotify?.(errorText(error, '发票文件上传失败'), 'error'); }
    finally { setBusy(false); }
  };
  const removeFile = async (fileId: number) => {
    if (!window.confirm('确定删除这份发票文件吗？') || busy) return;
    setBusy(true);
    try { await deleteFinanceInvoiceFile(fileId); await onRefresh(); onNotify?.('发票文件已删除', 'success'); }
    catch (error) { onNotify?.(errorText(error, '发票文件删除失败'), 'error'); }
    finally { setBusy(false); }
  };
  const send = async (invoice: FinanceInvoice) => { setBusy(true); try { await sendFinanceInvoice(invoice.id); await onRefresh(); onNotify?.('发票已标记为已发送', 'success'); } catch (error) { onNotify?.(errorText(error, '发送发票失败'), 'error'); } finally { setBusy(false); } };
  const voidInvoice = async (invoice: FinanceInvoice) => { if (!window.confirm('作废发票后会保留历史记录，确定继续吗？')) return; setBusy(true); try { await voidFinanceInvoice(invoice.id, '财务人员手动作废'); await onRefresh(); onNotify?.('发票已作废', 'success'); } catch (error) { onNotify?.(errorText(error, '作废发票失败'), 'error'); } finally { setBusy(false); } };

  return <section className="finance-section">
    <div className="finance-section-heading"><div><strong>发票跟踪</strong><span>{personal ? '对私结算订单无需开票' : `开票公司：${companyName} · 按订单保存开票资料和发票文件`}</span></div><span className={personal ? 'badge badge-neutral' : badgeClass(detail.finance.invoiceStatus)}>{personal ? INVOICE_NOT_REQUIRED_LABEL : INVOICE_STATUS_LABELS[detail.finance.invoiceStatus as InvoiceStatus]}</span></div>
    {personal ? <div className="finance-empty">该订单为对私结算，无需开票；如确需开票请先把订单结算方式改为对公。</div> : <div className="finance-invoice-form">
      {!String(detail.order.company_name ?? '') && <div className="finance-invoice-company-warning">该订单还没有分配收款/开票公司，请先在订单编辑里选择公司后再创建开票申请。</div>}<input placeholder="发票抬头" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><input placeholder="税号" value={draft.taxNo} onChange={(event) => setDraft({ ...draft, taxNo: event.target.value })} /><input type="email" placeholder="收票邮箱" value={draft.recipientEmail} onChange={(event) => setDraft({ ...draft, recipientEmail: event.target.value })} /><input type="number" min="0.01" step="0.01" placeholder="开票金额" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /><button className="button button-ghost" type="button" title="从客户资料带入开票抬头与税号" disabled={!orderCustomerId(detail)} onClick={() => void applyCustomer()}><RefreshCw size={14} />调用客户开票信息</button><button className="button button-primary" type="button" disabled={busy || !String(detail.order.company_name ?? '') || !draft.title || !draft.taxNo || !draft.amount} onClick={() => void create()}><Plus size={14} />新建开票申请</button></div>}
    {invoices.length > 0 && <small style={{ color: 'var(--color-text-muted)' }}>有效开票金额合计 {money(validInvoiceTotal)} / 应收 {money(detail.finance.receivableCents)}</small>}
    <div className="finance-invoice-list">{invoices.length ? invoices.map((invoice) => {
      const pendingFile = fileByInvoice[invoice.id];
      const editable = invoice.status !== 'void' && invoice.status !== 'sent';
      return <div className="finance-invoice-card" key={invoice.id}>
        <div className="finance-invoice-card-head"><strong>{invoice.invoiceType || '未选类型'} · {invoice.title || '未填写抬头'}</strong><span className={badgeClass(invoice.status)}>{INVOICE_STATUS_LABELS[invoice.status]}</span></div>
        <div className="finance-invoice-meta"><span>开票公司 {companyName}</span><span>金额 {money(invoice.amountCents)}</span><span>税号 {invoice.taxNo || '未填写'}</span><span>发票号 {invoice.invoiceNo || '未开具'}</span></div>
        <div className="finance-invoice-files">{invoice.files.map((item) => <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><a href={item.url} target="_blank" rel="noreferrer"><FileText size={14} />{item.originalName}</a>{editable && <button className="icon-button danger" type="button" title="删除发票文件" disabled={busy} onClick={() => void removeFile(item.id)}><Trash2 size={12} /></button>}</span>)}
          {editable && <><label className="finance-file-picker compact"><Upload size={13} />{pendingFile ? pendingFile.name : '上传发票'}<input type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={(event) => setFileByInvoice((current) => ({ ...current, [invoice.id]: event.target.files?.[0] ?? current[invoice.id] }))} /></label>{pendingFile && <button className="button button-ghost" type="button" disabled={busy} onClick={() => void upload(invoice)}>保存文件</button>}</>}
        </div>
        <div className="finance-invoice-actions">
          {invoice.status === 'incomplete' && <button className="button button-ghost" type="button" disabled={busy} onClick={() => void submit(invoice)}>提交开票</button>}
          {invoice.status === 'pending_issue' && <button className="button button-ghost" type="button" disabled={busy} onClick={() => void issue(invoice)}>录入发票号码</button>}
          {invoice.status === 'issued' && <button className="button button-primary" type="button" disabled={busy} onClick={() => void send(invoice)}>标记已发送</button>}
          {editable && <button className="button button-ghost danger-text" type="button" disabled={busy} onClick={() => void voidInvoice(invoice)}>作废</button>}
        </div>
      </div>;
    }) : <div className="finance-empty">暂无发票记录，可在上方创建开票申请。</div>}</div>
  </section>;
}
