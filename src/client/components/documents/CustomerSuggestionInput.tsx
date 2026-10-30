import { Search, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DocumentCustomerSuggestion } from '../../../shared/documents';

export interface DocumentCustomerFields extends DocumentCustomerSuggestion {}

export interface CustomerSuggestionInputProps {
  value: DocumentCustomerFields;
  onChange: (value: DocumentCustomerFields) => void;
  loadSuggestions?: (query: string) => Promise<DocumentCustomerSuggestion[]>;
  disabled?: boolean;
}

const fieldStyle = { width: '100%', minWidth: 0, border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', padding: '8px 9px', font: 'inherit', fontSize: 12 };

async function defaultLoadSuggestions(query: string): Promise<DocumentCustomerSuggestion[]> {
  const response = await fetch(`/api/document-customers/suggestions?q=${encodeURIComponent(query)}`);
  const payload = await response.json() as { ok?: boolean; data?: { items?: DocumentCustomerSuggestion[] }; error?: { message?: string } };
  if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? '客户建议加载失败');
  return payload.data?.items ?? [];
}

export default function CustomerSuggestionInput({ value, onChange, loadSuggestions = defaultLoadSuggestions, disabled }: CustomerSuggestionInputProps) {
  const [suggestions, setSuggestions] = useState<DocumentCustomerSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const query = value.customerName.trim();
    if (!query) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const currentRequest = ++requestId.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void loadSuggestions(query)
        .then((items) => {
          if (currentRequest !== requestId.current) return;
          setSuggestions(items);
          setOpen(items.length > 0);
        })
        .catch(() => {
          if (currentRequest === requestId.current) setSuggestions([]);
        })
        .finally(() => {
          if (currentRequest === requestId.current) setLoading(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadSuggestions, value.customerName]);

  const setField = <K extends keyof DocumentCustomerFields>(field: K, next: DocumentCustomerFields[K]) => onChange({ ...value, [field]: next });
  const choose = (suggestion: DocumentCustomerSuggestion) => {
    onChange({ ...suggestion });
    setOpen(false);
  };

  return <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1.5fr', gap: 10 }}>
    <label style={{ display: 'grid', gap: 5, position: 'relative', fontSize: 12, color: 'var(--color-text-secondary)' }}>
      客户名称
      <span style={{ position: 'relative', display: 'block' }}><Search size={14} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--color-text-muted)' }} /><input disabled={disabled} value={value.customerName} onChange={(event) => setField('customerName', event.target.value)} onFocus={() => setOpen(suggestions.length > 0)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} placeholder="输入客户名称查找历史记录" autoComplete="off" style={{ ...fieldStyle, paddingLeft: 29 }} /></span>
      {open && <div role="listbox" style={{ position: 'absolute', zIndex: 12, top: 57, left: 0, right: 0, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface)', boxShadow: '0 10px 25px rgba(15,23,42,.12)' }}>
        {suggestions.map((item, index) => <button key={`${item.customerName}-${item.contactPhone}-${index}`} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)} style={{ width: '100%', display: 'grid', gridTemplateColumns: '18px 1fr', gap: 7, padding: '8px 9px', border: 0, borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', textAlign: 'left', cursor: 'pointer' }}><UserRound size={14} color="var(--color-text-secondary)" /><span style={{ minWidth: 0 }}><strong style={{ display: 'block', fontSize: 12, color: 'var(--color-text)' }}>{item.customerName}</strong><small style={{ display: 'block', marginTop: 2, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[item.contactName, item.contactPhone].filter(Boolean).join(' · ') || '无联系人信息'}</small></span></button>)}
      </div>}
      {loading && <small style={{ position: 'absolute', right: 8, top: 31, color: 'var(--color-text-muted)' }}>查询中</small>}
    </label>
    <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--color-text-secondary)' }}>联系人<input disabled={disabled} value={value.contactName} onChange={(event) => setField('contactName', event.target.value)} style={fieldStyle} /></label>
    <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--color-text-secondary)' }}>联系电话<input disabled={disabled} value={value.contactPhone} onChange={(event) => setField('contactPhone', event.target.value)} style={fieldStyle} /></label>
    <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--color-text-secondary)' }}>客户地址<input disabled={disabled} value={value.address} onChange={(event) => setField('address', event.target.value)} style={fieldStyle} /></label>
  </div>;
}
