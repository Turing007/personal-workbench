import ImagePasteUpload, { type ImageAttachment } from '../ImagePasteUpload';

export interface TemporaryProductDraft {
  clientKey: string;
  name: string;
  sku: string;
  specification: string;
  remark: string;
  images: ImageAttachment[];
}

export interface TemporaryProductEditorProps {
  value: TemporaryProductDraft;
  onChange: (value: TemporaryProductDraft) => void;
  disabled?: boolean;
  showValidation?: boolean;
}

const fieldStyle = { width: '100%', minWidth: 0, border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', padding: '8px 9px', font: 'inherit', fontSize: 12 };

export default function TemporaryProductEditor({ value, onChange, disabled, showValidation }: TemporaryProductEditorProps) {
  const setField = <K extends keyof TemporaryProductDraft>(field: K, next: TemporaryProductDraft[K]) => onChange({ ...value, [field]: next });
  const missingName = showValidation && !value.name.trim();
  return <div style={{ display: 'grid', gap: 10 }}>
    <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1.2fr', gap: 9 }}>
      <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>品名 <span style={{ color: 'var(--color-danger-strong)' }}>*</span><input disabled={disabled} value={value.name} onChange={(event) => setField('name', event.target.value)} aria-invalid={missingName || undefined} style={{ ...fieldStyle, borderColor: missingName ? 'var(--color-danger-strong)' : 'var(--color-border-control)' }} />{missingName && <small style={{ color: 'var(--color-danger-strong)' }}>请填写品名</small>}</label>
      <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>SKU<input disabled={disabled} value={value.sku} onChange={(event) => setField('sku', event.target.value)} style={fieldStyle} /></label>
      <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>规格<input disabled={disabled} value={value.specification} onChange={(event) => setField('specification', event.target.value)} style={fieldStyle} /></label>
    </div>
    <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>备注<textarea disabled={disabled} rows={2} value={value.remark} onChange={(event) => setField('remark', event.target.value)} style={{ ...fieldStyle, resize: 'vertical' }} /></label>
    <ImagePasteUpload label="当前单据产品图片" value={value.images} onChange={(images) => setField('images', images)} multiple={false} maxFiles={1} showNotes={false} />
  </div>;
}
