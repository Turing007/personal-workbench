import { Download, ExternalLink, FileText, Image as ImageIcon, Package, Printer, Trash2, Truck, UserRound, Wallet } from 'lucide-react';
import { useState } from 'react';
import { FINANCE_PAYMENT_STATUS_LABELS, INVOICE_STATUS_LABELS, PAYMENT_PROOF_STATUS_LABELS } from '../../shared/finance';
import { ORDER_SETTLEMENT_LABELS, invoiceDisplayLabel } from '../../shared/settlement';
import { formatDateTime } from '../../shared/formatters';
import { thumbUrl } from '../image-urls';
import Modal from './Modal';
import OrderItemsTable from './OrderItemsTable';
import type { OrderContractDraft, OrderDraft, OrderStatus } from './OrderForm';
import { getOrderNextAction } from '../order-workflow';

export interface OrderDetailModalProps {
  open: boolean;
  order?: OrderDraft;
  onClose: () => void;
  onEditOrder?: (order: OrderDraft) => void;
  onEditLabels?: (order: OrderDraft) => void;
  onPrintLabels?: (order: OrderDraft) => void;
  onDeleteContract?: (contractId: string) => Promise<void>;
  onGenerateContract?: (order: OrderDraft) => Promise<void>;
  onDeleteOrder?: (order: OrderDraft) => void;
  onAdvanceStatus?: (order: OrderDraft, status: OrderStatus) => void;
  onPublishOrder?: (order: OrderDraft) => void;
  onOpenShipping?: (order: OrderDraft) => void;
  onOpenFinance?: (order: OrderDraft) => void;
}

const statusLabels: Record<OrderStatus, string> = {
  draft: '草稿',
  label_pending: '待打印箱唛',
  pending_stock: '待备货',
  stock_reported: '已备货',
  pending_packing: '待打包',
  ship_pending: '待发货',
  shipped: '已发货',
};

const detailStyle = { display: 'grid', gap: 4, minWidth: 0 };
const labelStyle = { color: 'var(--tone-text-faint)', fontSize: 11 };
const valueStyle = { color: 'var(--tone-text-strong)', fontSize: 12, overflowWrap: 'anywhere' as const };

function formatFileSize(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string) {
  return value ? value.replace('T', ' ').slice(0, 16) : '未填写';
}

function isImageContract(contract: OrderContractDraft) {
  return contract.mimeType?.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(contract.name);
}

const requirementAttachmentLabels: Record<string, string> = {
  label: '标贴文件',
  instruction: '说明书文件',
  packaging: '打包文件',
  other: '其他文件',
};

export default function OrderDetailModal({
  open,
  order,
  onClose,
  onEditOrder,
  onEditLabels,
  onPrintLabels,
  onDeleteContract,
  onGenerateContract,
  onDeleteOrder,
  onAdvanceStatus,
  onPublishOrder,
  onOpenShipping,
  onOpenFinance,
}: OrderDetailModalProps) {
  const [deletingContractId, setDeletingContractId] = useState<string>();
  const [generatingContract, setGeneratingContract] = useState(false);

  if (!order) return null;

  const nextAction = getOrderNextAction(order.status);
  const contracts = order.contracts ?? [];
  const paymentProofs = order.paymentProofs ?? [];
  const labels = order.labels ?? [];
  const financePaymentStatus = (order.financeSummary?.paymentStatus ?? 'unpaid') as keyof typeof FINANCE_PAYMENT_STATUS_LABELS;
  const financeProofStatus = (order.financeSummary?.proofStatus ?? 'none') as keyof typeof PAYMENT_PROOF_STATUS_LABELS;
  const financeInvoiceStatus = (order.financeSummary?.invoiceStatus ?? 'not_requested') as keyof typeof INVOICE_STATUS_LABELS;

  const deleteContract = async (contract: OrderContractDraft) => {
    if (!onDeleteContract || deletingContractId || !window.confirm(`确定删除合同“${contract.name}”吗？`)) return;
    setDeletingContractId(contract.id);
    try {
      await onDeleteContract(contract.id);
    } finally {
      setDeletingContractId(undefined);
    }
  };

  const generateContract = async () => {
    if (!onGenerateContract || generatingContract) return;
    setGeneratingContract(true);
    try {
      await onGenerateContract(order);
    } finally {
      setGeneratingContract(false);
    }
  };

  return (
    <Modal open={open} title={`订单详情 · ${order.orderNo}`} onClose={onClose} width={900}>
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 12 }}>
          <div style={detailStyle}><span style={labelStyle}>订单状态</span><strong style={{ color: order.status === 'draft' ? 'var(--tone-text-soft)' : 'var(--tone-accent-text)', fontSize: 13 }}>{order.status ? statusLabels[order.status] : '未设置'}</strong><span style={{ color: order.status === 'draft' ? 'var(--tone-text-soft)' : order.labelPrintedAt ? 'var(--tone-accent-text)' : '#b45309', fontSize: 11 }}>{order.status === 'draft' ? '草稿订单，发布后进入正式流程' : order.labelPrintedAt ? `箱唛已打印 · ${formatDateTime(order.labelPrintedAt)}` : '箱唛待打印（不影响流程）'}</span></div>
          <div style={detailStyle}><span style={labelStyle}>下单时间</span><strong style={{ fontSize: 13 }}>{formatDate(order.orderedAt)}</strong>{order.createdBy && <span style={{ color: 'var(--tone-text-soft)', fontSize: 11 }}>创建人 · {order.createdBy}</span>}</div>
          <div style={detailStyle}><span style={labelStyle}>订单金额</span><strong style={{ fontSize: 13 }}>¥ {order.amount || '0.00'}</strong></div>
          <div style={detailStyle}><span style={labelStyle}>运费</span><strong style={{ fontSize: 13 }}>¥ {((order.shippingCents ?? 0) / 100).toFixed(2)}</strong></div>
          <div style={detailStyle}><span style={labelStyle}>总箱数</span><strong style={{ fontSize: 13 }}>{order.totalBoxes ?? order.items.reduce((sum, item) => sum + item.boxes, 0)}</strong></div>
          <div style={detailStyle}><span style={labelStyle}>物流单号</span><strong style={{ fontSize: 13 }}>{order.trackingNo || '未填写'}</strong></div>
        </div>

        {order.financeSummary && <section style={{ display: 'grid', gap: 8, padding: 12, background: 'linear-gradient(135deg, #e6f7f4, #fff 62%)', border: '1px solid #b7e4df', borderRadius: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Wallet size={15} /><strong style={{ fontSize: 13 }}>财务摘要</strong><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>（水单审核通过后才计入已收）</span></div>
            {onOpenFinance && <button type="button" onClick={() => onOpenFinance(order)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #b7e4df', borderRadius: 5, padding: '5px 10px', background: '#f0fdfa', color: 'var(--tone-accent-text)', cursor: 'pointer', fontSize: 12 }}>打开财务详情</button>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            <div style={detailStyle}><span style={labelStyle}>应收金额</span><strong style={{ fontSize: 13 }}>{`¥ ${(order.financeSummary.receivableCents / 100).toFixed(2)}`}</strong></div>
            <div style={detailStyle}><span style={labelStyle}>已收金额</span><strong style={{ fontSize: 13, color: '#15803d' }}>{`¥ ${(order.financeSummary.receivedCents / 100).toFixed(2)}`}</strong></div>
            <div style={detailStyle}><span style={labelStyle}>未收金额</span><strong style={{ fontSize: 13, color: order.financeSummary.outstandingCents > 0 ? '#92400e' : '#15803d' }}>{`¥ ${(order.financeSummary.outstandingCents / 100).toFixed(2)}`}</strong></div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span style={{ padding: '3px 8px', borderRadius: 999, background: '#f1f5f9', color: '#475569', fontSize: 11 }}>结算：{ORDER_SETTLEMENT_LABELS[order.settlementType ?? 'corporate']}</span>
            <span style={{ padding: '3px 8px', borderRadius: 999, background: '#f1f5f9', color: '#475569', fontSize: 11 }}>付款：{FINANCE_PAYMENT_STATUS_LABELS[financePaymentStatus]}</span>
            <span style={{ padding: '3px 8px', borderRadius: 999, background: '#f1f5f9', color: '#475569', fontSize: 11 }}>水单:{' '}{PAYMENT_PROOF_STATUS_LABELS[financeProofStatus]}</span>
            <span style={{ padding: '3px 8px', borderRadius: 999, background: '#f1f5f9', color: '#475569', fontSize: 11 }}>发票：{invoiceDisplayLabel(order.settlementType, financeInvoiceStatus)}</span>
          </div>
        </section>}

        <section style={{ display: 'grid', gap: 9, padding: 12, background: 'var(--tone-surface-frost)', borderRadius: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><UserRound size={15} /><strong style={{ fontSize: 13 }}>客户与收件信息</strong></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            <div style={detailStyle}><span style={labelStyle}>客户名称</span><span style={valueStyle}>{order.customerName || '未填写'}</span></div>
            <div style={detailStyle}><span style={labelStyle}>联系人</span><span style={valueStyle}>{order.customerContactName || '未填写'}</span></div>
            <div style={detailStyle}><span style={labelStyle}>联系电话</span><span style={valueStyle}>{order.customerContactPhone || '未填写'}</span></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr)', gap: 13 }}>
            <div style={detailStyle}><span style={labelStyle}>收件人</span><strong style={{ fontSize: 13 }}>{order.recipientName || '未填写'}</strong></div>
            <div style={detailStyle}><span style={labelStyle}>收件信息</span><span style={{ ...valueStyle, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{order.recipientInfo || '未填写'}</span></div>
          </div>
          <div style={detailStyle}><span style={labelStyle}>客户常用收件信息</span><span style={{ ...valueStyle, whiteSpace: 'pre-wrap' }}>{order.customerShippingInfo || '未填写'}</span></div>
        </section>

        <section style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={15} /><strong style={{ fontSize: 13 }}>订单详情</strong></div>
          <div style={{ whiteSpace: 'pre-wrap', color: 'var(--tone-text-strong)', fontSize: 12, lineHeight: 1.7 }}>{order.orderDetail || '未填写文字详情'}</div>
          {order.orderDetailImages?.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {order.orderDetailImages.map((image) => <a key={image.id} href={image.url} target="_blank" rel="noreferrer" title={image.name}><img src={thumbUrl(image.url, 240)} alt={image.name} loading="lazy" decoding="async" style={{ width: 92, height: 70, objectFit: 'cover', border: '1px solid #dbe3ea', borderRadius: 5 }} /></a>)}
            </div>
          ) : <span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}><ImageIcon size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />暂无详情图片</span>}
        </section>

        <section style={{ display: 'grid', gap: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Package size={15} /><strong style={{ fontSize: 13 }}>产品明细</strong><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>（金额按数量 × 单价自动计算）</span></div>
          <OrderItemsTable order={order} />
        </section>

        {order.items.some((item) => item.customerProductAttachments?.length) && <section style={{ display: 'none' }} />}
        {contracts.length > 0 && <section style={{ display: 'grid', gap: 7 }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={15} /><strong style={{ fontSize: 13 }}>订单附件</strong><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>（{contracts.length}）</span></div><div style={{ display: 'grid', gap: 6 }}>{contracts.map((contract) => <div key={`contract-${contract.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '7px 9px', border: '1px solid var(--tone-border-soft)', borderRadius: 6, background: 'var(--tone-surface-tint)' }}><FileText size={18} color="var(--tone-accent-text)" /><div style={{ minWidth: 0, flex: 1 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--tone-text-strong)', fontSize: 12 }}>{contract.name}</div><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>{formatFileSize(contract.size)} · {contract.category && contract.category !== 'other' ? requirementAttachmentLabels[contract.category] ?? '订单附件' : '订单附件'}</span></div>{contract.url && <><a href={contract.url} target="_blank" rel="noreferrer" title="打开订单附件" style={{ color: 'var(--tone-accent-text)' }}><ExternalLink size={14} /></a><a href={contract.url} download={contract.name} title="下载订单附件" style={{ color: '#475569' }}><Download size={14} /></a></>}{onDeleteContract && <button type="button" onClick={() => { void deleteContract(contract); }} title="删除订单附件" style={{ border: 0, background: 'transparent', color: 'var(--tone-danger-text)', cursor: 'pointer' }}><Trash2 size={14} /></button>}</div>)}</div></section>}

        <section style={{ display: 'grid', gap: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={15} /><strong style={{ fontSize: 13 }}>付款信息</strong><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>（{paymentProofs.length} 张凭证）</span></div>
          <div style={detailStyle}><span style={labelStyle}>付款备注</span><span style={{ ...valueStyle, whiteSpace: 'pre-wrap' }}>{order.paymentNote || '未填写'}</span></div>
          {paymentProofs.length ? <div style={{ display: 'grid', gap: 6 }}>{paymentProofs.map((proof) => <div key={proof.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', border: '1px solid var(--tone-border-soft)', borderRadius: 6, background: 'var(--tone-surface-tint)' }}>{proof.url ? <img src={thumbUrl(proof.url, 240)} alt={proof.name} loading="lazy" decoding="async" style={{ width: 42, height: 34, objectFit: 'cover', borderRadius: 4 }} /> : <FileText size={20} color="var(--tone-text-soft)" />}<div style={{ minWidth: 0, flex: 1 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--tone-text-strong)', fontSize: 12 }}>{proof.name}</div><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>{formatFileSize(proof.size)}{proof.createdAt ? ` · ${formatDate(proof.createdAt)}` : ''}{proof.note ? ` · ${proof.note}` : ''}</span></div>{proof.url && <a href={proof.url} target="_blank" rel="noreferrer" title="打开付款凭证" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--tone-accent-text)', fontSize: 12, textDecoration: 'none' }}><ExternalLink size={14} />打开</a>}</div>)}</div> : <div style={{ padding: '10px 12px', border: '1px dashed var(--tone-border-cool)', borderRadius: 6, color: 'var(--tone-text-faint)', fontSize: 12 }}>暂无付款凭证</div>}
        </section>

        <section style={{ display: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={15} /><strong style={{ fontSize: 13 }}>合同附件</strong><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>（{contracts.length}）</span></div>
          {contracts.length ? <div style={{ display: 'grid', gap: 6 }}>{contracts.map((contract) => <div key={contract.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '7px 9px', border: '1px solid var(--tone-border-soft)', borderRadius: 6, background: 'var(--tone-surface-tint)' }}>{isImageContract(contract) && contract.url ? <img src={thumbUrl(contract.url, 240)} alt="" loading="lazy" decoding="async" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 4 }} /> : <FileText size={22} color="var(--tone-text-soft)" />}<div style={{ minWidth: 0, flex: 1 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--tone-text-strong)', fontSize: 12 }}>{contract.name}</div><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>{formatFileSize(contract.size)}{contract.createdAt ? ` · ${formatDate(contract.createdAt)}` : ''}</span></div>{contract.url && <><a href={contract.url} target="_blank" rel="noreferrer" title="打开合同" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--tone-accent-text)', fontSize: 12, textDecoration: 'none' }}><ExternalLink size={14} />打开</a><a href={contract.url} download={contract.name} title="下载合同" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#475569', fontSize: 12, textDecoration: 'none' }}><Download size={14} />下载</a></>}{onDeleteContract && <button type="button" onClick={() => { void deleteContract(contract); }} disabled={Boolean(deletingContractId)} title="删除合同" style={{ display: 'inline-flex', alignItems: 'center', border: 0, background: 'transparent', color: 'var(--tone-danger-text)', cursor: deletingContractId ? 'wait' : 'pointer', opacity: deletingContractId && deletingContractId !== contract.id ? .45 : 1 }}><Trash2 size={14} /></button>}</div>)}</div> : <div style={{ padding: '10px 12px', border: '1px dashed var(--tone-border-cool)', borderRadius: 6, color: 'var(--tone-text-faint)', fontSize: 12 }}>暂无合同附件</div>}
        </section>

        {labels.length > 0 && <section style={{ display: 'grid', gap: 7 }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Package size={15} /><strong style={{ fontSize: 13 }}>箱唛摘要</strong><span style={{ color: 'var(--tone-text-faint)', fontSize: 11 }}>（{labels.length} 箱）</span></div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{labels.map((label, index) => <span key={String(label.id ?? index)} style={{ padding: '5px 8px', border: '1px solid #dbe3ea', borderRadius: 5, color: '#475569', fontSize: 11 }}>第 {String(label.box_no ?? label.boxNo ?? index + 1)} 箱 / 共 {String(label.total_boxes ?? label.totalBoxes ?? labels.length)} 箱</span>)}</div></section>}
        {order.remark && <div style={{ display: 'grid', gap: 4 }}><span style={labelStyle}>订单备注</span><span style={{ ...valueStyle, whiteSpace: 'pre-wrap' }}>{order.remark}</span></div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 7, borderTop: '1px solid #edf0f2', paddingTop: 13 }}>
          {onEditOrder && <button type="button" onClick={() => onEditOrder(order)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--tone-border-cool)', borderRadius: 5, padding: '7px 11px', background: '#fff', cursor: 'pointer', fontSize: 12 }}>编辑订单</button>}
          {order.status === 'draft'
            ? onPublishOrder && <button type="button" title="校验并发布草稿订单，进入正式流程" onClick={() => { if (window.confirm(`确定发布草稿订单“${order.orderNo}”吗？发布后将进入待备货流程。`)) onPublishOrder(order); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, borderRadius: 5, padding: '7px 11px', background: '#17212b', color: '#fff', cursor: 'pointer', fontSize: 12 }}><Truck size={14} />发布订单</button>
            : <>{onEditLabels && <button type="button" onClick={() => onEditLabels(order)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--tone-border-cool)', borderRadius: 5, padding: '7px 11px', background: '#fff', cursor: 'pointer', fontSize: 12 }}><ExternalLink size={14} />编辑箱唛</button>}
          {onPrintLabels && <button type="button" onClick={() => onPrintLabels(order)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--tone-accent-text)', borderRadius: 5, padding: '7px 11px', background: '#f0fdfa', color: 'var(--tone-accent-text)', cursor: 'pointer', fontSize: 12 }}><Printer size={14} />打印箱唛</button>}</>}
          {onGenerateContract && <button type="button" onClick={() => { void generateContract(); }} disabled={generatingContract} title="按设置中的合同模板生成购销合同 PDF，并归档到订单附件" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--tone-accent-text)', borderRadius: 5, padding: '7px 11px', background: '#f0fdfa', color: 'var(--tone-accent-text)', cursor: generatingContract ? 'wait' : 'pointer', opacity: generatingContract ? 0.6 : 1, fontSize: 12 }}><FileText size={14} />{generatingContract ? '正在生成…' : '生成购销合同'}</button>}
          {onOpenFinance && <button type="button" onClick={() => onOpenFinance(order)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #b7e4df', borderRadius: 5, padding: '7px 11px', background: '#e6f7f4', color: 'var(--tone-accent-text)', cursor: 'pointer', fontSize: 12 }}>财务详情</button>}
          {onDeleteOrder && <button type="button" onClick={() => onDeleteOrder(order)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #fecaca', borderRadius: 5, padding: '7px 11px', background: '#fff', color: 'var(--tone-danger-text)', cursor: 'pointer', fontSize: 12 }}><Trash2 size={14} />删除订单</button>}
          {nextAction?.kind === 'advance' && onAdvanceStatus && <button type="button" onClick={() => onAdvanceStatus(order, nextAction.target)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, borderRadius: 5, padding: '7px 11px', background: '#17212b', color: '#fff', cursor: 'pointer', fontSize: 12 }}><Truck size={14} />{nextAction.label}</button>}{nextAction?.kind === 'shipping' && onOpenShipping && <button type="button" onClick={() => onOpenShipping(order)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, borderRadius: 5, padding: '7px 11px', background: '#17212b', color: '#fff', cursor: 'pointer', fontSize: 12 }}><Truck size={14} />{nextAction.label}</button>}
        </div>
      </div>
    </Modal>
  );
}
