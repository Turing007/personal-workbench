import { Building2, ImageOff } from 'lucide-react';
import type { CompanySnapshot } from '../../../shared/documents';

export interface CompanyDisplayOptions {
  showLogo: boolean;
  showCompanyPhone: boolean;
  showCompanyAddress: boolean;
}

export interface CompanySnapshotFieldsProps {
  value: CompanySnapshot;
  onChange: (value: CompanySnapshot) => void;
  display: CompanyDisplayOptions;
  onDisplayChange: (value: CompanyDisplayOptions) => void;
  disabled?: boolean;
}

const fieldStyle = { width: '100%', minWidth: 0, border: '1px solid #dbe3ea', borderRadius: 5, padding: '8px 9px', font: 'inherit', fontSize: 12 };

export default function CompanySnapshotFields({ value, onChange, display, onDisplayChange, disabled }: CompanySnapshotFieldsProps) {
  const setField = <K extends keyof CompanySnapshot>(field: K, next: CompanySnapshot[K]) => onChange({ ...value, [field]: next });
  const setDisplay = (field: keyof CompanyDisplayOptions, checked: boolean) => onDisplayChange({ ...display, [field]: checked });
  const logoUrl = value.logoRelativePath ? `/files/${value.logoRelativePath}` : '';
  return <div style={{ display: 'grid', gap: 10 }}>
    <div className="company-snapshot-fields">
      <div style={{ width: 88, height: 64, display: 'flex', justifyContent: 'center', alignItems: 'center', border: '1px solid #dbe3ea', borderRadius: 6, overflow: 'hidden', background: '#f8fafc' }}>{logoUrl ? <img src={logoUrl} alt="公司 Logo" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', objectPosition: '50% 50%' }} /> : <ImageOff size={20} color="#94a3b8" />}</div>
      <label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#64748b' }}>公司名称<input disabled={disabled} value={value.name} onChange={(event) => setField('name', event.target.value)} style={fieldStyle} /></label>
      <label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#64748b' }}>联系电话<input disabled={disabled} value={value.phone} onChange={(event) => setField('phone', event.target.value)} style={fieldStyle} /></label>
      <label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#64748b' }}>公司地址<input disabled={disabled} value={value.address} onChange={(event) => setField('address', event.target.value)} style={fieldStyle} /></label>
      <label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#64748b' }}>默认开单人<input disabled={disabled} value={value.defaultIssuer} onChange={(event) => setField('defaultIssuer', event.target.value)} style={fieldStyle} /></label>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, fontSize: 12, color: '#475569' }}><Building2 size={15} color="#64748b" />{([['showLogo', '显示 Logo'], ['showCompanyPhone', '显示电话'], ['showCompanyAddress', '显示地址']] as const).map(([key, label]) => <label key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><input disabled={disabled || (key === 'showLogo' && !value.logoRelativePath)} type="checkbox" checked={display[key]} onChange={(event) => setDisplay(key, event.target.checked)} />{label}</label>)}</div>
  </div>;
}
