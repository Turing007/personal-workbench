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

const inputStyle = { width: '100%', border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', padding: '5px 6px', background: 'var(--control-bg)', color: 'var(--color-text)', fontSize: 11 };

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
  return <Modal open={open} title={`箱唛编辑 · ${order.orderNo}`} onClose={onClose} width={1100} footer={<><button type="button" className="button button-secondary" onClick={() => { void onRestoreAuto?.(); }}><RotateCcw size={14} />恢复自动方案</button><button type="button" className="button button-secondary" onClick={() => { void saveDraft(); }}><Save size={14} />保存修改</button>{onPrint && <button type="button" className="button button-primary" onClick={() => { void printDraft(); }}>预览并打印</button>}</>}>
    <div className="label-editor-layout">
      <div className="label-editor-list">
        <strong className="label-editor-list-title">箱唛列表（{draftLabels.length}）</strong>
        {draftLabels.map((label) => <div key={label.id} className={`label-editor-list-item${label.id === current?.id ? ' is-active' : ''}`}>
          <input type="checkbox" checked={checkedIds.includes(label.id)} onChange={() => setCheckedIds((ids) => ids.includes(label.id) ? ids.filter((id) => id !== label.id) : [...ids, label.id])} />
          <button type="button" onClick={() => setSelectedId(label.id)}>{label.cartonNo} / {label.totalCartons}{label.isTail ? <small>尾数</small> : null}{label.manuallyEdited ? <small>已改</small> : null}</button>
        </div>)}
        <button type="button" className="button button-secondary label-editor-merge" disabled={checkedIds.length < 2} onClick={() => { void onMerge?.(checkedIds); }}><Merge size={14} />手动合箱</button>
      </div>
      <div className="label-editor-preview">{current ? <CartonLabelView label={current} mode="preview" /> : <span className="label-editor-empty">没有箱唛</span>}</div>
      <div className="label-editor-fields">{current && <>
        <div className="label-editor-fields-head"><strong>当前箱内容</strong><span>10 × 10 cm</span></div>
        <div className="label-editor-lines">{current.lines.map((line) => <div key={line.id} className="label-editor-line">
          <label>SKU<input value={line.sku} onChange={(event) => updateCurrent(nextLine(current, line, { sku: event.target.value }))} style={inputStyle} /></label>
          <label>品名<input value={line.name} onChange={(event) => updateCurrent(nextLine(current, line, { name: event.target.value }))} style={inputStyle} /></label>
          <label>规格<input value={line.specification} onChange={(event) => updateCurrent(nextLine(current, line, { specification: event.target.value }))} style={inputStyle} /></label>
          <label>当前箱数量<input type="number" min="1" value={line.quantity} onChange={(event) => updateCurrent(nextLine(current, line, { quantity: Math.max(1, Number(event.target.value) || 1) }))} style={inputStyle} /></label>
          <label>箱唛要求<input value={line.remark ?? ''} onChange={(event) => updateCurrent(nextLine(current, line, { remark: event.target.value }))} style={inputStyle} /></label>
        </div>)}</div>
      </>}</div>
    </div>
  </Modal>;
}

export { CartonLabelView };
