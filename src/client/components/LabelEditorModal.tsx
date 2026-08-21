import { Merge, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import type { OrderDraft } from './OrderForm';
import CartonLabelView from './carton-label/CartonLabelView';
import type { CartonLabel, LabelLine } from './carton-label/types';

export type { CartonLabel, LabelLine } from './carton-label/types';

export interface LabelEditorModalProps {
  open: boolean;
  order?: OrderDraft;
  labels: CartonLabel[];
  onClose: () => void;
  onSave: (labels: CartonLabel[]) => void | Promise<CartonLabel[] | undefined>;
  onPrint?: (labels: CartonLabel[]) => void | Promise<void>;
  onMerge?: (labelIds: string[]) => void | Promise<void>;
  onRestoreAuto?: () => void | Promise<void>;
}

const inputStyle = { width: '100%', border: '1px solid #dbe3ea', borderRadius: 4, padding: '5px 6px', fontSize: 11 };

function nextLine(label: CartonLabel, line: LabelLine, patch: Partial<LabelLine>): CartonLabel {
  return { ...label, manuallyEdited: true, lines: label.lines.map((entry) => entry.id === line.id ? { ...entry, ...patch } : entry) };
}

export default function LabelEditorModal({ open, order, labels, onClose, onSave, onPrint, onMerge, onRestoreAuto }: LabelEditorModalProps) {
  const [draftLabels, setDraftLabels] = useState(labels);
  const [selectedId, setSelectedId] = useState(labels[0]?.id ?? '');
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const current = useMemo(() => draftLabels.find((label) => label.id === selectedId) ?? draftLabels[0], [draftLabels, selectedId]);
  useEffect(() => {
    setDraftLabels(labels);
    if (!labels.some((label) => label.id === selectedId)) setSelectedId(labels[0]?.id ?? '');
    setCheckedIds((ids) => ids.filter((id) => labels.some((label) => label.id === id)));
  }, [labels, selectedId]);
  const updateCurrent = (next: CartonLabel) => setDraftLabels((currentLabels) => currentLabels.map((label) => label.id === next.id ? next : label));
  const saveDraft = async () => {
    const saved = await onSave(draftLabels);
    if (saved?.length) setDraftLabels(saved);
    return saved ?? draftLabels;
  };
  const printDraft = async () => {
    const saved = await saveDraft();
    await onPrint?.(saved);
  };
  if (!order) return null;
  return <Modal open={open} title={`箱唛编辑 · ${order.orderNo}`} onClose={onClose} width={1100} footer={<><button type="button" onClick={() => { void onRestoreAuto?.(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', padding: '8px 11px', cursor: 'pointer', fontSize: 12 }}><RotateCcw size={14} />恢复自动方案</button><button type="button" onClick={() => { void saveDraft(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #0f766e', borderRadius: 5, background: '#f0fdfa', color: '#0f766e', padding: '8px 11px', cursor: 'pointer', fontSize: 12 }}><Save size={14} />保存修改</button>{onPrint && <button type="button" onClick={() => { void printDraft(); }} style={{ border: 0, borderRadius: 5, background: '#0f766e', color: '#fff', padding: '8px 14px', cursor: 'pointer', fontWeight: 650, fontSize: 12 }}>预览并打印</button>}</>}> 
    <div style={{ display: 'grid', gridTemplateColumns: '205px minmax(400px, 1fr) 390px', gap: 14, minHeight: 510 }}>
      <div style={{ display: 'grid', alignContent: 'start', gap: 6 }}><strong style={{ fontSize: 12 }}>箱唛列表（{draftLabels.length}）</strong>{draftLabels.map((label) => <div key={label.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 8, border: `1px solid ${label.id === current?.id ? '#0f766e' : '#e2e8f0'}`, background: label.id === current?.id ? '#f0fdfa' : '#fff', borderRadius: 5 }}><input type="checkbox" checked={checkedIds.includes(label.id)} onChange={() => setCheckedIds((ids) => ids.includes(label.id) ? ids.filter((id) => id !== label.id) : [...ids, label.id])} /><button type="button" onClick={() => setSelectedId(label.id)} style={{ border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 12, flex: 1 }}>{label.cartonNo} / {label.totalCartons}{label.isTail ? <small style={{ color: '#b45309', marginLeft: 5 }}>尾数</small> : null}{label.manuallyEdited ? <small style={{ color: '#b45309', marginLeft: 5 }}>已改</small> : null}</button></div>)}<button type="button" disabled={checkedIds.length < 2} onClick={() => { void onMerge?.(checkedIds); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'center', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', color: '#475569', padding: '7px 9px', cursor: checkedIds.length > 1 ? 'pointer' : 'not-allowed', fontSize: 12 }}><Merge size={14} />手动合箱</button></div>
      <div style={{ display: 'grid', placeItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 7, padding: 18, overflow: 'auto' }}>{current ? <CartonLabelView label={current} mode="preview" /> : <span style={{ color: '#94a3b8' }}>没有箱唛</span>}</div>
      <div style={{ display: 'grid', alignContent: 'start', gap: 10 }}>{current && <><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong style={{ fontSize: 12 }}>当前箱内容</strong><span style={{ color: '#94a3b8', fontSize: 11 }}>10 × 10 cm</span></div><div style={{ display: 'grid', gap: 9 }}>{current.lines.map((line) => <div key={line.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: 9, border: '1px solid #e2e8f0', borderRadius: 6 }}><label style={{ display: 'grid', gap: 3, color: '#64748b', fontSize: 10 }}>SKU<input value={line.sku} onChange={(event) => updateCurrent(nextLine(current, line, { sku: event.target.value }))} style={inputStyle} /></label><label style={{ display: 'grid', gap: 3, color: '#64748b', fontSize: 10 }}>品名<input value={line.name} onChange={(event) => updateCurrent(nextLine(current, line, { name: event.target.value }))} style={inputStyle} /></label><label style={{ display: 'grid', gap: 3, color: '#64748b', fontSize: 10 }}>规格<input value={line.specification} onChange={(event) => updateCurrent(nextLine(current, line, { specification: event.target.value }))} style={inputStyle} /></label><label style={{ display: 'grid', gap: 3, color: '#64748b', fontSize: 10 }}>当前箱数量<input type="number" min="1" value={line.quantity} onChange={(event) => updateCurrent(nextLine(current, line, { quantity: Math.max(1, Number(event.target.value) || 1) }))} style={inputStyle} /></label><label style={{ display: 'grid', gap: 3, color: '#64748b', fontSize: 10 }}>SKU备注<input value={line.remark ?? ''} onChange={(event) => updateCurrent(nextLine(current, line, { remark: event.target.value }))} style={inputStyle} /></label></div>)}</div></>}</div>
    </div>
  </Modal>;
}

export { CartonLabelView };
