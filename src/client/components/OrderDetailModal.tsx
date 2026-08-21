import { Download, ExternalLink, FileText, Image as ImageIcon, Package, Printer, Trash2, Truck, UserRound } from 'lucide-react';
import { useState, useEffect, Fragment } from 'react';
import { calculateOrderLineAmountCents } from '../../shared/order-prices';
import { getOrderItemImages } from '../api';
import Modal from './Modal';
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
  onDeleteOrder?: (order: OrderDraft) => void;
  onAdvanceStatus?: (order: OrderDraft, status: OrderStatus) => void;
  onOpenShipping?: (order: OrderDraft) => void;
  onOpenFinance?: (order: OrderDraft) => void;
}

const statusLabels: Record<OrderStatus, string> = {
  label_pending: '待打印箱唛',
  pending_stock: '待备货',
  stock_reported: '已备货',
  pending_packing: '待打包',
  ship_pending: '待发货',
  shipped: '已发货',
};

const detailStyle = { display: 'grid', gap: 4, minWidth: 0 };
const labelStyle = { color: '#94a3b8', fontSize: 11 };
const valueStyle = { color: '#334155', fontSize: 12, overflowWrap: 'anywhere' as const };

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

function packagingSize(item: { outerSize?: string; length?: string; width?: string; height?: string }) {
  if (item.outerSize) return item.outerSize;
  const dimensions = [item.length, item.width, item.height].filter(Boolean);
  return dimensions.length ? dimensions.join(' × ') : '未填写';
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
  onDeleteOrder,
  onAdvanceStatus,
  onOpenShipping,
  onOpenFinance,
}: OrderDetailModalProps) {
  const [deletingContractId, setDeletingContractId] = useState<string>();
  const [itemImages, setItemImages] = useState<Record<number, Array<{ url: string; name: string; mimeType: string }>>>({});

  useEffect(() => {
    if (!open || !order?.id) return;
    let cancelled = false;
    void getOrderItemImages(order.id).then((result) => {
      if (!cancelled) setItemImages(result.itemImages);
    }).catch(() => { /* 图片加载失败不打断详情展示 */ });
    return () => { cancelled = true; };
  }, [open, order?.id]);

  if (!order) return null;

  const nextAction = getOrderNextAction(order.status);
  const contracts = order.contracts ?? [];
  const paymentProofs = order.paymentProofs ?? [];
  const labels = order.labels ?? [];

  const deleteContract = async (contract: OrderContractDraft) => {
    if (!onDeleteContract || deletingContractId || !window.confirm(`确定删除合同“${contract.name}”吗？`)) return;
    setDeletingContractId(contract.id);
    try {
      await onDeleteContract(contract.id);
    } finally {
      setDeletingContractId(undefined);
    }
  };

  return (
    <Modal open={open} title={`订单详情 · ${order.orderNo}`} onClose={onClose} width={900}>
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 12 }}>
          <div style={detailStyle}><span style={labelStyle}>订单状态</span><strong style={{ color: '#0f766e', fontSize: 13 }}>{order.status ? statusLabels[order.status] : '未设置'}</strong><span style={{ color: order.labelPrintedAt ? '#0f766e' : '#b45309', fontSize: 11 }}>{order.labelPrintedAt ? `箱唛已打印 · ${order.labelPrintedAt.replace('T', ' ').slice(0, 16)}` : '箱唛待打印（不影响流程）'}</span></div>
          <div style={detailStyle}><span style={labelStyle}>下单时间</span><strong style={{ fontSize: 13 }}>{formatDate(order.orderedAt)}</strong></div>
          <div style={detailStyle}><span style={labelStyle}>订单金额</span><strong style={{ fontSize: 13 }}>¥ {order.amount || '0.00'}</strong></div>
          <div style={detailStyle}><span style={labelStyle}>运费</span><strong style={{ fontSize: 13 }}>¥ {((order.shippingCents ?? 0) / 100).toFixed(2)}</strong></div>
          <div style={detailStyle}><span style={labelStyle}>总箱数</span><strong style={{ fontSize: 13 }}>{order.totalBoxes ?? order.items.reduce((sum, item) => sum + item.boxes, 0)}</strong></div>
          <div style={detailStyle}><span style={labelStyle}>物流单号</span><strong style={{ fontSize: 13 }}>{order.trackingNo || '未填写'}</strong></div>
        </div>

        <section style={{ display: 'grid', gap: 9, padding: 12, background: '#f8fafc', borderRadius: 7 }}>
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
          <div style={{ whiteSpace: 'pre-wrap', color: '#334155', fontSize: 12, lineHeight: 1.7 }}>{order.orderDetail || '未填写文字详情'}</div>
          {order.orderDetailImages?.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {order.orderDetailImages.map((image) => <a key={image.id} href={image.url} target="_blank" rel="noreferrer" title={image.name}><img src={image.url} alt={image.name} style={{ width: 92, height: 70, objectFit: 'cover', border: '1px solid #dbe3ea', borderRadius: 5 }} /></a>)}
            </div>
          ) : <span style={{ color: '#94a3b8', fontSize: 11 }}><ImageIcon size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />暂无详情图片</span>}
        </section>

        <section style={{ display: 'grid', gap: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Package size={15} /><strong style={{ fontSize: 13 }}>产品明细</strong><span style={{ color: '#94a3b8', fontSize: 11 }}>（金额按数量 × 单价自动计算）</span></div>
          <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 760 }}>
              <thead><tr style={{ background: '#f8fafc', textAlign: 'left', color: '#64748b' }}>{['品名', 'SKU', '规格', '数量', '装箱数', '箱数', '单价', '金额', '运费/箱', '运费小计', '备注'].map((title) => <th key={title} style={{ padding: '8px 9px', fontWeight: 600 }}>{title}</th>)}</tr></thead>
              <tbody>
                {order.items.length ? order.items.map((item) => {
                  const unitPriceCents = item.unitPriceCents ?? 0;
                  const amountCents = item.amountCents ?? calculateOrderLineAmountCents({ quantity: item.quantity, unitPriceCents });
                  const packaging = item.packaging ?? [];
                  const images = itemImages[Number(item.id)] ?? [];
                  const requirementAttachments = item.customerProductAttachments ?? [];
                  return <Fragment key={item.id}><tr style={{ borderTop: '1px solid #edf0f2', verticalAlign: 'top' }}>
                    <td style={{ padding: '8px 9px', minWidth: 120 }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{images.length ? <a href={images[0]!.url} target="_blank" rel="noreferrer" title="查看原图"><img src={images[0]!.url} alt={images[0]!.name} style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: '1px solid #e2e8f0', flexShrink: 0 }} /></a> : null}<span>{item.name}</span></div></td>
                    <td style={{ padding: '8px 9px' }}>{item.sku}</td>
                    <td style={{ padding: '8px 9px' }}>{item.specification}</td>
                    <td style={{ padding: '8px 9px' }}>{item.quantity}</td>
                    <td style={{ padding: '8px 9px' }}>{item.packSize}</td>
                    <td style={{ padding: '8px 9px' }}>{item.boxes}</td>
                    <td style={{ padding: '8px 9px', color: '#0f766e', fontWeight: 650 }}>{`¥ ${(unitPriceCents / 100).toFixed(2)}`}</td>
                    <td style={{ padding: '8px 9px', color: '#0f766e', fontWeight: 650 }}>{`¥ ${(amountCents / 100).toFixed(2)}`}</td>
                    <td style={{ padding: '8px 9px' }}>{`¥ ${((item.freightPerBoxCents ?? 0) / 100).toFixed(2)}`}</td>
                    <td style={{ padding: '8px 9px' }}>{`¥ ${(((item.freightPerBoxCents ?? 0) * item.boxes) / 100).toFixed(2)}`}</td>
                    <td style={{ padding: '8px 9px', whiteSpace: 'pre-wrap' }}>{item.remark || '—'}</td>
                  </tr>{packaging.length > 0 && <tr style={{ borderTop: '1px dashed #e2e8f0' }}><td colSpan={11} style={{ padding: '0 9px 8px', color: '#64748b', fontSize: 11 }}>包装快照：{packaging.map((pack) => `${pack.name || '未命名包装'} · ${packagingSize(pack)} · ${pack.outerWeight || '未填写'} · ${pack.packSize} 件/箱`).join('；')}</td></tr>}</Fragment>;
                }) : <tr><td colSpan={11} style={{ padding: 14, textAlign: 'center', color: '#94a3b8' }}>暂无产品明细</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {order.items.some((item) => item.customerProductAttachments?.length) && <section style={{ display: 'none' }} />}
        {contracts.length > 0 && <section style={{ display: 'grid', gap: 7 }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={15} /><strong style={{ fontSize: 13 }}>订单附件</strong><span style={{ color: '#94a3b8', fontSize: 11 }}>（{contracts.length}）</span></div><div style={{ display: 'grid', gap: 6 }}>{contracts.map((contract) => <div key={`contract-${contract.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '7px 9px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fbfdff' }}><FileText size={18} color="#0f766e" /><div style={{ minWidth: 0, flex: 1 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#334155', fontSize: 12 }}>{contract.name}</div><span style={{ color: '#94a3b8', fontSize: 11 }}>{formatFileSize(contract.size)} · {contract.category && contract.category !== 'other' ? requirementAttachmentLabels[contract.category] ?? '订单附件' : '订单附件'}</span></div>{contract.url && <><a href={contract.url} target="_blank" rel="noreferrer" title="打开订单附件" style={{ color: '#0f766e' }}><ExternalLink size={14} /></a><a href={contract.url} download={contract.name} title="下载订单附件" style={{ color: '#475569' }}><Download size={14} /></a></>}{onDeleteContract && <button type="button" onClick={() => { void deleteContract(contract); }} title="删除订单附件" style={{ border: 0, background: 'transparent', color: '#b91c1c', cursor: 'pointer' }}><Trash2 size={14} /></button>}</div>)}</div></section>}

        <section style={{ display: 'grid', gap: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={15} /><strong style={{ fontSize: 13 }}>付款信息</strong><span style={{ color: '#94a3b8', fontSize: 11 }}>（{paymentProofs.length} 张凭证）</span></div>
          <div style={detailStyle}><span style={labelStyle}>付款备注</span><span style={{ ...valueStyle, whiteSpace: 'pre-wrap' }}>{order.paymentNote || '未填写'}</span></div>
          {paymentProofs.length ? <div style={{ display: 'grid', gap: 6 }}>{paymentProofs.map((proof) => <div key={proof.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fbfdff' }}>{proof.url ? <img src={proof.url} alt={proof.name} style={{ width: 42, height: 34, objectFit: 'cover', borderRadius: 4 }} /> : <FileText size={20} color="#64748b" />}<div style={{ minWidth: 0, flex: 1 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#334155', fontSize: 12 }}>{proof.name}</div><span style={{ color: '#94a3b8', fontSize: 11 }}>{formatFileSize(proof.size)}{proof.createdAt ? ` · ${formatDate(proof.createdAt)}` : ''}{proof.note ? ` · ${proof.note}` : ''}</span></div>{proof.url && <a href={proof.url} target="_blank" rel="noreferrer" title="打开付款凭证" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#0f766e', fontSize: 12, textDecoration: 'none' }}><ExternalLink size={14} />打开</a>}</div>)}</div> : <div style={{ padding: '10px 12px', border: '1px dashed #cbd5e1', borderRadius: 6, color: '#94a3b8', fontSize: 12 }}>暂无付款凭证</div>}
        </section>

        <section style={{ display: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={15} /><strong style={{ fontSize: 13 }}>合同附件</strong><span style={{ color: '#94a3b8', fontSize: 11 }}>（{contracts.length}）</span></div>
          {contracts.length ? <div style={{ display: 'grid', gap: 6 }}>{contracts.map((contract) => <div key={contract.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '7px 9px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fbfdff' }}>{isImageContract(contract) && contract.url ? <img src={contract.url} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 4 }} /> : <FileText size={22} color="#64748b" />}<div style={{ minWidth: 0, flex: 1 }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#334155', fontSize: 12 }}>{contract.name}</div><span style={{ color: '#94a3b8', fontSize: 11 }}>{formatFileSize(contract.size)}{contract.createdAt ? ` · ${formatDate(contract.createdAt)}` : ''}</span></div>{contract.url && <><a href={contract.url} target="_blank" rel="noreferrer" title="打开合同" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#0f766e', fontSize: 12, textDecoration: 'none' }}><ExternalLink size={14} />打开</a><a href={contract.url} download={contract.name} title="下载合同" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#475569', fontSize: 12, textDecoration: 'none' }}><Download size={14} />下载</a></>}{onDeleteContract && <button type="button" onClick={() => { void deleteContract(contract); }} disabled={Boolean(deletingContractId)} title="删除合同" style={{ display: 'inline-flex', alignItems: 'center', border: 0, background: 'transparent', color: '#b91c1c', cursor: deletingContractId ? 'wait' : 'pointer', opacity: deletingContractId && deletingContractId !== contract.id ? .45 : 1 }}><Trash2 size={14} /></button>}</div>)}</div> : <div style={{ padding: '10px 12px', border: '1px dashed #cbd5e1', borderRadius: 6, color: '#94a3b8', fontSize: 12 }}>暂无合同附件</div>}
        </section>

        {labels.length > 0 && <section style={{ display: 'grid', gap: 7 }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Package size={15} /><strong style={{ fontSize: 13 }}>箱唛摘要</strong><span style={{ color: '#94a3b8', fontSize: 11 }}>（{labels.length} 箱）</span></div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{labels.map((label, index) => <span key={String(label.id ?? index)} style={{ padding: '5px 8px', border: '1px solid #dbe3ea', borderRadius: 5, color: '#475569', fontSize: 11 }}>第 {String(label.box_no ?? label.boxNo ?? index + 1)} 箱 / 共 {String(label.total_boxes ?? label.totalBoxes ?? labels.length)} 箱</span>)}</div></section>}
        {order.remark && <div style={{ display: 'grid', gap: 4 }}><span style={labelStyle}>订单备注</span><span style={{ ...valueStyle, whiteSpace: 'pre-wrap' }}>{order.remark}</span></div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 7, borderTop: '1px solid #edf0f2', paddingTop: 13 }}>
          {onEditOrder && <button type="button" onClick={() => onEditOrder(order)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #cbd5e1', borderRadius: 5, padding: '7px 11px', background: '#fff', cursor: 'pointer', fontSize: 12 }}>编辑订单</button>}
          {onEditLabels && <button type="button" onClick={() => onEditLabels(order)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #cbd5e1', borderRadius: 5, padding: '7px 11px', background: '#fff', cursor: 'pointer', fontSize: 12 }}><ExternalLink size={14} />编辑箱唛</button>}
          {onPrintLabels && <button type="button" onClick={() => onPrintLabels(order)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #0f766e', borderRadius: 5, padding: '7px 11px', background: '#f0fdfa', color: '#0f766e', cursor: 'pointer', fontSize: 12 }}><Printer size={14} />打印箱唛</button>}
          {onOpenFinance && <button type="button" onClick={() => onOpenFinance(order)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #b7e4df', borderRadius: 5, padding: '7px 11px', background: '#e6f7f4', color: '#0f766e', cursor: 'pointer', fontSize: 12 }}>财务详情</button>}
          {onDeleteOrder && <button type="button" onClick={() => onDeleteOrder(order)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #fecaca', borderRadius: 5, padding: '7px 11px', background: '#fff', color: '#b91c1c', cursor: 'pointer', fontSize: 12 }}><Trash2 size={14} />删除订单</button>}
          {nextAction?.kind === 'advance' && onAdvanceStatus && <button type="button" onClick={() => onAdvanceStatus(order, nextAction.target)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, borderRadius: 5, padding: '7px 11px', background: '#17212b', color: '#fff', cursor: 'pointer', fontSize: 12 }}><Truck size={14} />{nextAction.label}</button>}{nextAction?.kind === 'shipping' && onOpenShipping && <button type="button" onClick={() => onOpenShipping(order)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, borderRadius: 5, padding: '7px 11px', background: '#17212b', color: '#fff', cursor: 'pointer', fontSize: 12 }}><Truck size={14} />{nextAction.label}</button>}
        </div>
      </div>
    </Modal>
  );
}
