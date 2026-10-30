import { Columns3 } from 'lucide-react';
import type { QuotationColumnKey, SalesDocumentColumnKey } from '../../../shared/documents';

type ColumnKey = QuotationColumnKey | SalesDocumentColumnKey;

export const DEFAULT_QUOTATION_COLUMNS: Record<QuotationColumnKey, boolean> = { image: true, name: true, specification: true, unitPrice: true, tierPrice: true, remark: true };
export const DEFAULT_SALES_COLUMNS: Record<SalesDocumentColumnKey, boolean> = { productCode: true, productName: true, specification: true, quantity: true, unitPrice: true, amount: true, remark: true };

export interface DocumentColumnSettingsProps {
  kind: 'quotation' | 'sales';
  value: Partial<Record<ColumnKey, boolean>>;
  onChange: (value: Partial<Record<ColumnKey, boolean>>) => void;
  showProductImages?: boolean;
  onShowProductImagesChange?: (checked: boolean) => void;
  disabled?: boolean;
}

const quotationColumns: Array<[QuotationColumnKey, string]> = [['image', '图片'], ['name', '品名'], ['specification', '规格'], ['unitPrice', '单价'], ['tierPrice', '数量区间价'], ['remark', '备注']];
const salesColumns: Array<[SalesDocumentColumnKey, string]> = [['productCode', '产品代码'], ['productName', '产品名称'], ['specification', '规格'], ['quantity', '数量'], ['unitPrice', '单价'], ['amount', '金额'], ['remark', '备注']];

export default function DocumentColumnSettings({ kind, value, onChange, showProductImages, onShowProductImagesChange, disabled }: DocumentColumnSettingsProps) {
  const columns = kind === 'quotation' ? quotationColumns : salesColumns;
  const coreColumns = new Set<ColumnKey>(kind === 'quotation' ? ['name'] : ['productName', 'amount']);
  const toggle = (key: ColumnKey, checked: boolean) => onChange({ ...value, [key]: checked });
  return <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, fontSize: 12, color: 'var(--color-text-secondary)' }}>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--color-text-secondary)', fontWeight: 600 }}><Columns3 size={15} />显示列</span>
    {kind === 'sales' && onShowProductImagesChange && <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><input disabled={disabled} type="checkbox" checked={Boolean(showProductImages)} onChange={(event) => onShowProductImagesChange(event.target.checked)} />图片</label>}
    {columns.map(([key, label]) => {
      const core = coreColumns.has(key);
      return <label key={key} title={core ? `${label}为核心列，不能隐藏` : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><input type="checkbox" disabled={disabled || core} checked={core || value[key] !== false} onChange={(event) => toggle(key, event.target.checked)} />{label}</label>;
    })}
  </div>;
}
