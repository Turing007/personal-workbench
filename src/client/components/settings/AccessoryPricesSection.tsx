import { Calculator, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getAccessoryPrices, saveAccessoryPrices } from '../../api';
import { ACCESSORY_PRICE_LIST_LIMIT, type AccessoryPrice } from '../../../shared/accessory-prices';

function errorMessage(error: unknown, fallback: string) {
  return (error as { message?: string } | undefined)?.message ?? fallback;
}

/** 全店共用的「配件与价格」：售价计算器里选到即自动带价；产品里还能各加专属件。 */
export default function AccessoryPricesSection() {
  const [items, setItems] = useState<AccessoryPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error'>('success');

  const show = (text: string, kind: 'success' | 'error' = 'success') => {
    setMessage(text);
    setMessageKind(kind);
  };

  useEffect(() => {
    let cancelled = false;
    getAccessoryPrices()
      .then((list) => { if (!cancelled) { setItems(list); setLoading(false); } })
      .catch((error) => {
        if (cancelled) return;
        setItems([]);
        setLoading(false);
        show(errorMessage(error, '配件价格加载失败'), 'error');
      });
    return () => { cancelled = true; };
  }, []);

  const update = (index: number, patch: Partial<AccessoryPrice>) => {
    setItems((current) => current.map((item, position) => (position === index ? { ...item, ...patch } : item)));
    setDirty(true);
  };
  const remove = (index: number) => {
    setItems((current) => current.filter((_, position) => position !== index));
    setDirty(true);
  };
  const add = () => {
    setItems((current) => [...current, { id: `accessory-${Date.now()}`, name: '', price: 0 }]);
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      // 以服务端清洗后的结果为准：空名行会被丢弃、价格会归一到 ≥0 的两位小数。
      setItems(await saveAccessoryPrices(items));
      setDirty(false);
      show('配件价格已保存，售价计算器立即可选');
    } catch (error) {
      show(errorMessage(error, '配件价格保存失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const atLimit = items.length >= ACCESSORY_PRICE_LIST_LIMIT;

  return <div className="settings-section card">
    <div className="settings-heading"><Calculator size={18} /><strong>配件与价格</strong></div>
    <p>全店共用一份：售价计算器里点每行的「选」即可按名称挑出、自动带价（电池、充电器、常用配件放这里最省事）。产品编辑器里还能给单个产品加专属件。这里的清单存服务端，手机和电脑看到的是同一份。</p>
    {loading && <div className="table-state">正在加载配件价格...</div>}
    {!loading && !!items.length && <div className="accessory-price-list">
      {items.map((item, index) => <div className="accessory-price-row" key={item.id || index}>
        <input className="input" aria-label={`配件${index + 1}名称`} value={item.name} disabled={busy} placeholder="如：21V 2.0Ah 电池" onChange={(event) => update(index, { name: event.target.value })} />
        <input className="input" type="number" min={0} step="0.01" aria-label={`配件${index + 1}价格`} value={item.price} disabled={busy} placeholder="元" onChange={(event) => update(index, { price: Number(event.target.value) || 0 })} />
        <button className="icon-button danger" type="button" title="删除这条价格" aria-label={`删除第 ${index + 1} 条配件价格`} disabled={busy} onClick={() => remove(index)}><Trash2 size={14} /></button>
      </div>)}
    </div>}
    {!loading && !items.length && <div className="empty-state">还没有配件价格，点「添加一行」开始维护（如：21V 2.0Ah 电池 8.5 元）。</div>}
    <div className="packaging-preset-form-footer">
      <button className="button button-secondary" type="button" disabled={busy || atLimit} title={atLimit ? `最多 ${ACCESSORY_PRICE_LIST_LIMIT} 条` : undefined} onClick={add}><Plus size={14} />添加一行</button>
      <span className={dirty ? 'packaging-preset-dirty' : 'packaging-preset-saved'} role="status">{dirty ? '有未保存的修改' : `${items.length} / ${ACCESSORY_PRICE_LIST_LIMIT} 条`}</span>
      <button className="button button-primary" type="button" disabled={busy || loading || !dirty} onClick={() => void save()}><Save size={14} />{busy ? '保存中...' : '保存配件价格'}</button>
    </div>
    {!!message && <p role="status" className={`notice notice-${messageKind}`} style={{ color: messageKind === 'error' ? 'var(--tone-danger-text)' : 'var(--tone-accent-text)', fontSize: 12 }}>{message}</p>}
  </div>;
}
