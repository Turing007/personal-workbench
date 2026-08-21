import type { CSSProperties } from 'react';
import type { CartonLabel } from './types';

export interface CartonLabelViewProps {
  label: CartonLabel;
  mode?: 'preview' | 'print';
}

function text(value: unknown, fallback = '-') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

export default function CartonLabelView({ label, mode = 'preview' }: CartonLabelViewProps) {
  const print = mode === 'print';
  const lineFontSize = print ? '0.23cm' : 9;
  const cellPadding = print ? '0.08cm' : 4;
  const rows = label.lines;
  const labelStyle: CSSProperties = {
    width: print ? '100mm' : 378,
    height: print ? '100mm' : 378,
    minWidth: print ? '100mm' : 378,
    minHeight: print ? '100mm' : 378,
    padding: print ? '0.35cm' : 15,
    background: '#fff',
    border: `${print ? '1px' : '2px'} solid ${label.isTail ? '#e67e22' : '#111827'}`,
    borderStyle: label.isTail ? 'dashed' : 'solid',
    color: '#111827',
    display: 'grid',
    gridTemplateRows: 'auto auto 1fr auto',
    gap: print ? '0.18cm' : 8,
    fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
    overflow: 'hidden',
  };
  const tableStyle: CSSProperties = {
    width: '100%',
    alignSelf: 'start',
    borderCollapse: 'collapse',
    tableLayout: 'fixed',
    fontSize: lineFontSize,
  };
  const headerStyle: CSSProperties = {
    border: print ? '0.02cm solid #111827' : '1px solid #111827',
    padding: cellPadding,
    textAlign: 'center',
    background: '#f4f4f5',
    overflowWrap: 'anywhere',
    fontWeight: 800,
  };
  const cellStyle: CSSProperties = {
    border: print ? '0.02cm solid #111827' : '1px solid #111827',
    padding: cellPadding,
    textAlign: 'center',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    verticalAlign: 'middle',
    fontWeight: 700,
  };
  const heads = ['SKU', '品名', '规格', '装箱数', '箱数', '总数量'];
  return (
    <div className={`carton-label-view carton-label-view-${mode}${label.isTail ? ' carton-label-view-tail' : ''}`} style={labelStyle}>
      <div className="carton-label-view-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, borderBottom: print ? '0.04cm solid #111827' : '1.5px solid #111827', paddingBottom: print ? '0.12cm' : 6 }}>
        <div style={{ textAlign: 'center', flex: 1, fontWeight: 800, fontSize: print ? '0.48cm' : 19, letterSpacing: print ? '0.1cm' : 3 }}>箱 唛 <span style={{ fontSize: print ? '0.28cm' : 11, letterSpacing: print ? '0.02cm' : 1 }}>／ BOX LABEL</span></div>
        {label.isTail && <span style={{ flexShrink: 0, padding: print ? '0.03cm 0.1cm' : '2px 5px', borderRadius: 3, background: '#e67e22', color: '#111827', fontSize: print ? '0.18cm' : 9, fontWeight: 700 }}>尾数箱</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: print ? '0.08cm' : 5, fontSize: print ? '0.28cm' : 11, minWidth: 0 }}>
        <span style={{ overflowWrap: 'anywhere', fontSize: print ? '0.42cm' : 16, fontWeight: 800 }}>收件人：<strong>{text(label.recipientName)}</strong></span>
        <span style={{ overflowWrap: 'anywhere', fontSize: print ? '0.34cm' : 13, fontWeight: 800 }}>订单号：<strong>{text(label.orderNo)}</strong></span>
        <strong style={{ gridColumn: '1 / -1', textAlign: 'center', fontSize: print ? '0.7cm' : 27, lineHeight: 1.1 }}>{label.cartonNo} / {label.totalCartons}</strong>
      </div>
      <div style={{ minHeight: 0, overflow: 'hidden' }}>
        <table style={tableStyle}>
          <colgroup><col style={{ width: '20%' }} /><col style={{ width: '20%' }} /><col style={{ width: '20%' }} /><col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '14%' }} /></colgroup>
          <thead><tr>{heads.map((head) => <th key={head} style={headerStyle}>{head}</th>)}</tr></thead>
          <tbody>
            {rows.map((line) => <tr key={line.id}>
              {[line.sku, line.name, line.specification, label.isTail ? line.quantity : line.packSize, line.boxCount ?? 1, line.totalQuantity ?? line.quantity].map((value, index) => <td key={index} style={{ ...cellStyle, fontWeight: index >= 3 ? 800 : 700 }}>{text(value)}</td>)}
            </tr>)}
            {rows.map((line) => line.remark ? <tr key={`${line.id}-remark`}><td colSpan={6} style={{ ...cellStyle, textAlign: 'left', fontSize: print ? '0.18cm' : 8, fontWeight: 400 }}>SKU备注：{line.remark}</td></tr> : null)}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'grid', gap: print ? '0.08cm' : 4, fontSize: print ? '0.18cm' : 8, minWidth: 0 }}>
        {label.orderRemark && <div style={{ borderTop: print ? '0.02cm solid #999' : '1px solid #999', paddingTop: print ? '0.08cm' : 4, textAlign: 'left', overflowWrap: 'anywhere' }}>订单备注：{label.orderRemark}</div>}
        <div style={{ textAlign: 'right', color: '#333' }}>打印日期：{new Date().toLocaleDateString('zh-CN')}</div>
      </div>
    </div>
  );
}

export { CartonLabelView };
