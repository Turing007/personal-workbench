import { ChevronDown, Plus, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Customer, CustomerSaveInput } from '../../../shared/customers';
import CustomerEditorModal from './CustomerEditorModal';

export interface CustomerSelectorProps {
  value: number | null;
  customers: Customer[];
  onChange: (customerId: number | null, customer?: Customer) => void;
  onCreateCustomer?: (input: CustomerSaveInput) => Promise<Customer>;
  /** 临时客户名称：未挂正式客户时显示。与 onTemporaryNameChange 配合支持直接输名字开单。 */
  temporaryName?: string;
  onTemporaryNameChange?: (name: string) => void;
  disabled?: boolean;
  label?: string;
}

const inputStyle = {
  width: '100%',
  minWidth: 0,
  border: '1px solid var(--color-border-control)',
  borderRadius: 'var(--radius-ui)',
  padding: '8px 30px 8px 30px',
  font: 'inherit',
  fontSize: 12,
  background: 'var(--color-surface)',
};

export default function CustomerSelector({ value, customers, onChange, onCreateCustomer, temporaryName, onTemporaryNameChange, disabled, label = '客户' }: CustomerSelectorProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const selected = customers.find((customer) => customer.id === value);
  const currentText = selected?.name ?? temporaryName ?? '';
  const canUseTemporary = Boolean(onTemporaryNameChange);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) => [customer.name, customer.contactName, customer.contactPhone].join(' ').toLowerCase().includes(needle));
  }, [customers, query]);
  const exactMatch = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? customers.find((customer) => customer.name.trim().toLowerCase() === needle) : undefined;
  }, [customers, query]);
  const showTemporaryOption = canUseTemporary && !!query.trim() && !exactMatch;

  useEffect(() => {
    if (!open) setQuery(currentText);
  }, [open, currentText]);

  const choose = (customer: Customer) => {
    setQuery(customer.name);
    setOpen(false);
    onTemporaryNameChange?.('');
    onChange(customer.id, customer);
  };

  const chooseTemporary = () => {
    const name = query.trim();
    if (!name || !onTemporaryNameChange) return;
    setQuery(name);
    setOpen(false);
    onChange(null);
    onTemporaryNameChange(name);
  };

  const clear = () => {
    setQuery('');
    onChange(null);
    onTemporaryNameChange?.('');
    setOpen(true);
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

  // 失焦时把未匹配已有客户的输入按临时客户名称落定；点下拉项用 onMouseDown 阻止失焦，不会误触发。
  // 已选值与文本一致时不重复触发 onChange，避免重置表单里其它已填字段（如报价单产品行）。
  const commitOnBlur = () => {
    window.setTimeout(() => {
      setOpen(false);
      const text = query.trim();
      if (!text) {
        if (selected || temporaryName) { onChange(null); onTemporaryNameChange?.(''); }
        return;
      }
      const lower = text.toLowerCase();
      if (selected && selected.name.trim().toLowerCase() === lower) return;
      if (!selected && temporaryName && temporaryName.trim().toLowerCase() === lower) return;
      const match = customers.find((customer) => customer.name.trim().toLowerCase() === lower);
      if (match) { choose(match); return; }
      if (canUseTemporary) chooseTemporary();
    }, 140);
  };

  const shownText = open ? query : currentText;
  const isTemporary = !selected && !!temporaryName;
  return <>
    <label style={{ display: 'grid', gap: 5, position: 'relative', color: 'var(--color-text-secondary)', fontSize: 12 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{label}{isTemporary && <span className="badge badge-neutral" style={{ fontSize: 10 }}>临时</span>}</span>
      <span style={{ position: 'relative' }}>
        <UserRound size={14} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
        <input
          aria-label={label}
          disabled={disabled}
          value={shownText}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); if (!event.target.value.trim()) { onChange(null); onTemporaryNameChange?.(''); } }}
          onFocus={() => setOpen(true)}
          onBlur={commitOnBlur}
          placeholder="搜索客户，或直接输名字按临时客户开单"
          autoComplete="off"
          style={shownText.trim() ? { ...inputStyle, paddingRight: 48 } : inputStyle}
        />
        {!!shownText.trim() && !disabled && <button type="button" aria-label="清空客户" title="清空" onMouseDown={(event) => event.preventDefault()} onClick={clear} style={{ position: 'absolute', right: 26, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, border: 0, borderRadius: '50%', padding: 0, color: 'var(--color-text-muted)', background: 'transparent', cursor: 'pointer' }}><X size={13} /></button>}
        <ChevronDown size={14} style={{ position: 'absolute', right: 9, top: 9, color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
      </span>
      {open && <div role="listbox" style={{ position: 'absolute', zIndex: 14, top: 56, left: 0, right: 0, maxHeight: 270, overflowY: 'auto', border: '1px solid var(--color-border-control)', borderRadius: 'var(--radius-ui)', background: 'var(--color-surface)', boxShadow: '0 12px 28px rgba(15,23,42,.14)' }}>
        {showTemporaryOption && <button type="button" role="option" aria-selected={false} onMouseDown={(event) => event.preventDefault()} onClick={chooseTemporary} style={{ width: '100%', display: 'grid', gap: 2, padding: '9px 10px', border: 0, borderBottom: '1px solid var(--color-border)', background: 'var(--color-accent-soft)', color: 'var(--color-accent)', textAlign: 'left', cursor: 'pointer', fontSize: 12 }}><strong>按临时客户开单：「{query.trim()}」</strong><small style={{ color: 'var(--color-text-secondary)' }}>不建客户档案，名称记在订单上；转正后可挂接历史订单</small></button>}
        {filtered.map((customer) => <button key={customer.id} type="button" role="option" aria-selected={customer.id === value} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(customer)} style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '8px 10px', border: 0, borderBottom: '1px solid var(--color-border)', background: customer.id === value ? 'var(--color-accent-soft)' : 'var(--color-surface)', textAlign: 'left', cursor: 'pointer' }}><span><strong style={{ display: 'block', color: 'var(--color-text)', fontSize: 12 }}>{customer.name}</strong><small style={{ color: 'var(--color-text-secondary)' }}>{[customer.contactName, customer.contactPhone].filter(Boolean).join(' · ') || '暂无联系人信息'}</small></span><small style={{ color: customer.incompleteProductCount ? 'var(--color-warning-text)' : 'var(--color-accent)' }}>{customer.productCount} 个产品</small></button>)}
        {!filtered.length && !showTemporaryOption && <div style={{ padding: 14, color: 'var(--color-text-muted)', textAlign: 'center' }}>没有匹配客户</div>}
        {onCreateCustomer && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(false); setCreateOpen(true); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: '9px 10px', border: 0, background: 'var(--color-accent-soft)', color: 'var(--color-accent)', textAlign: 'left', cursor: 'pointer', fontSize: 12 }}><Plus size={14} />快速新增客户</button>}
      </div>}
    </label>
    <CustomerEditorModal open={createOpen} busy={creating} onClose={() => { if (!creating) setCreateOpen(false); }} onSave={create} />
  </>;
}