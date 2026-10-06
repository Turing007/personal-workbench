import { ChevronDown, Plus, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Customer, CustomerSaveInput } from '../../../shared/customers';
import CustomerEditorModal from './CustomerEditorModal';

export interface CustomerSelectorProps {
  value: number | null;
  customers: Customer[];
  onChange: (customerId: number | null, customer?: Customer) => void;
  onCreateCustomer?: (input: CustomerSaveInput) => Promise<Customer>;
  disabled?: boolean;
  label?: string;
}

const inputStyle = {
  width: '100%',
  minWidth: 0,
  border: '1px solid #dbe3ea',
  borderRadius: 5,
  padding: '8px 30px 8px 30px',
  font: 'inherit',
  fontSize: 12,
  background: '#fff',
};

export default function CustomerSelector({ value, customers, onChange, onCreateCustomer, disabled, label = '客户' }: CustomerSelectorProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const selected = customers.find((customer) => customer.id === value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) => [customer.name, customer.contactName, customer.contactPhone].join(' ').toLowerCase().includes(needle));
  }, [customers, query]);

  useEffect(() => {
    if (!open && selected) setQuery(selected.name);
  }, [open, selected]);

  const choose = (customer: Customer) => {
    setQuery(customer.name);
    setOpen(false);
    onChange(customer.id, customer);
  };

  const create = async (input: CustomerSaveInput) => {
    if (!onCreateCustomer) return;
    setCreating(true);
    try {
      const customer = await onCreateCustomer(input);
      choose(customer);
      setCreateOpen(false);
    } finally {
      setCreating(false);
    }
  };

  // 显示文本：打开下拉时是搜索词，否则是已选客户名；一键清空按同一份文本判断有没有内容。
  const shownText = open ? query : selected?.name ?? query;
  return <>
    <label style={{ display: 'grid', gap: 5, position: 'relative', color: '#64748b', fontSize: 12 }}>
      {label}
      <span style={{ position: 'relative' }}>
        <UserRound size={14} style={{ position: 'absolute', left: 9, top: 9, color: '#94a3b8', pointerEvents: 'none' }} />
        <input
          aria-label={label}
          disabled={disabled}
          value={open ? query : selected?.name ?? query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); if (!event.target.value.trim()) onChange(null); }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 140)}
          placeholder="搜索并选择客户"
          autoComplete="off"
          style={shownText.trim() ? { ...inputStyle, paddingRight: 48 } : inputStyle}
        />
        {!!shownText.trim() && !disabled && <button type="button" aria-label="清空客户" title="清空" onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(''); onChange(null); setOpen(true); }} style={{ position: 'absolute', right: 26, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, border: 0, borderRadius: '50%', padding: 0, color: '#94a3b8', background: 'transparent', cursor: 'pointer' }}><X size={13} /></button>}
        <ChevronDown size={14} style={{ position: 'absolute', right: 9, top: 9, color: '#94a3b8', pointerEvents: 'none' }} />
      </span>
      {open && <div role="listbox" style={{ position: 'absolute', zIndex: 14, top: 56, left: 0, right: 0, maxHeight: 270, overflowY: 'auto', border: '1px solid #dbe3ea', borderRadius: 6, background: '#fff', boxShadow: '0 12px 28px rgba(15,23,42,.14)' }}>
        {filtered.map((customer) => <button key={customer.id} type="button" role="option" aria-selected={customer.id === value} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(customer)} style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '8px 10px', border: 0, borderBottom: '1px solid #edf0f2', background: customer.id === value ? '#f0fdfa' : '#fff', textAlign: 'left', cursor: 'pointer' }}><span><strong style={{ display: 'block', color: '#17212b', fontSize: 12 }}>{customer.name}</strong><small style={{ color: '#64748b' }}>{[customer.contactName, customer.contactPhone].filter(Boolean).join(' · ') || '暂无联系人信息'}</small></span><small style={{ color: customer.incompleteProductCount ? '#b45309' : '#0f766e' }}>{customer.productCount} 个产品</small></button>)}
        {!filtered.length && <div style={{ padding: 14, color: '#94a3b8', textAlign: 'center' }}>没有匹配客户</div>}
        {onCreateCustomer && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(false); setCreateOpen(true); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: '9px 10px', border: 0, background: '#f0fdfa', color: '#0f766e', textAlign: 'left', cursor: 'pointer', fontSize: 12 }}><Plus size={14} />快速新增客户</button>}
      </div>}
    </label>
    <CustomerEditorModal open={createOpen} busy={creating} onClose={() => { if (!creating) setCreateOpen(false); }} onSave={create} />
  </>;
}
