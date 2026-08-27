import { FileText, Plus, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import {
  createFinanceInvoice,
  deleteFinanceInvoiceFile,
  issueFinanceInvoice,
  sendFinanceInvoice,
  submitFinanceInvoice,
  uploadFinanceInvoiceFile,
  voidFinanceInvoice,
  type ApiFinanceDetail,
} from '../../api';
import { INVOICE_STATUS_LABELS, type FinanceInvoice, type InvoiceStatus } from '../../../shared/finance';
import { badgeClass, errorText, money } from './finance-format';

export interface InvoiceEditorProps {
  detail: ApiFinanceDetail;
  onRefresh: () => Promise<void>;
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

/** 订单发票跟踪面板：开票资料 → 待开票 → 已开票 → 已发送，作废保留历史记录。 */
export default function InvoiceEditor({ detail, onRefresh, onNotify }: InvoiceEditorProps) {
  const [busy, setBusy] = useState(false);
  const [fileByInvoice, setFileByInvoice] = useState<Record<number, File>>({});
  const [draft, setDraft] = useState({ invoiceType: '电子普通发票', title: '', taxNo: '', recipientEmail: '', amount: '', taxRate: '13', tax: '' });
  const invoices = detail.invoices;
  const validInvoiceTotal = invoices.filter((invoice) => invoice.status !== 'void').reduce((sum, invoice) => sum + invoice.amountCents, 0);

  const create = async () => {
    setBusy(true);
    try { await createFinanceInvoice(detail.finance.orderId, { invoiceType: draft.invoiceType, title: draft.title, taxNo: draft.taxNo, recipientEmail: draft.recipientEmail, amountCents: Math.round(Number(draft.amount) * 100), taxRateBps: Math.round(Number(draft.taxRate) * 100), taxCents: Math.round(Number(draft.tax || 0) * 100) }); await onRefresh(); onNotify?.('开票申请已创建', 'success'); }
    catch (error) { onNotify?.(errorText(error, '创建发票申请失败'), 'error'); }
    finally { setBusy(false); }
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
    <div className="finance-section-heading"><div><strong>发票跟踪</strong><span>按订单保存开票资料和发票文件</span></div><span className={badgeClass(detail.finance.invoiceStatus)}>{INVOICE_STATUS_LABELS[detail.finance.invoiceStatus as InvoiceStatus]}</span></div>
    <div className="finance-invoice-form"><input placeholder="发票抬头" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><input placeholder="税号" value={draft.taxNo} onChange={(event) => setDraft({ ...draft, taxNo: event.target.value })} /><input type="email" placeholder="收票邮箱" value={draft.recipientEmail} onChange={(event) => setDraft({ ...draft, recipientEmail: event.target.value })} /><input type="number" min="0.01" step="0.01" placeholder="开票金额" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /><button className="button button-primary" type="button" disabled={busy || !draft.title || !draft.taxNo || !draft.amount} onClick={() => void create()}><Plus size={14} />新建开票申请</button></div>
    {invoices.length > 0 && <small style={{ color: '#94a3b8' }}>有效开票金额合计 {money(validInvoiceTotal)} / 应收 {money(detail.finance.receivableCents)}</small>}
    <div className="finance-invoice-list">{invoices.length ? invoices.map((invoice) => {
      const pendingFile = fileByInvoice[invoice.id];
      const editable = invoice.status !== 'void' && invoice.status !== 'sent';
      return <div className="finance-invoice-card" key={invoice.id}>
        <div className="finance-invoice-card-head"><strong>{invoice.invoiceType || '未选类型'} · {invoice.title || '未填写抬头'}</strong><span className={badgeClass(invoice.status)}>{INVOICE_STATUS_LABELS[invoice.status]}</span></div>
        <div className="finance-invoice-meta"><span>金额 {money(invoice.amountCents)}</span><span>税号 {invoice.taxNo || '未填写'}</span><span>发票号 {invoice.invoiceNo || '未开具'}</span></div>
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
