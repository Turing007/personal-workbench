import { ArrowDown, ArrowUp, Package, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getPackagingPresets, reseedPackagingPresets, savePackagingPresets } from '../../api';
import { PACKAGING_PRESET_LIMIT, type PackagingPreset } from '../../../shared/packaging-presets';

function errorMessage(error: unknown, fallback: string) {
  return (error as { message?: string } | undefined)?.message ?? fallback;
}

/** 包装预设维护：产品编辑器「包装方式」上方一键填入的那几套常用组合。 */
export default function PackagingPresetsSection() {
  const [items, setItems] = useState<PackagingPreset[]>([]);
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
    getPackagingPresets()
      .then((list) => { if (!cancelled) { setItems(list); setLoading(false); } })
      .catch((error) => {
        if (cancelled) return;
        setItems([]);
        setLoading(false);
        show(errorMessage(error, '包装预设加载失败'), 'error');
      });
    return () => { cancelled = true; };
  }, []);

  const update = (index: number, patch: Partial<PackagingPreset>) => {
    setItems((current) => current.map((item, position) => (position === index ? { ...item, ...patch } : item)));
    setDirty(true);
  };
  const move = (index: number, delta: number) => {
    setItems((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
  };
  const remove = (index: number) => {
    setItems((current) => current.filter((_, position) => position !== index));
    setDirty(true);
  };
  const add = () => {
    setItems((current) => [...current, { id: `pack-preset-${Date.now()}`, name: '', innerSize: '', outerSize: '', packSize: 1, purchasePrice: '' }]);
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      // 以服务端清洗后的结果为准：全空行会被丢掉、超出上限会被截断。
      setItems(await savePackagingPresets(items));
      setDirty(false);
      show('包装预设已保存，产品编辑器立即可用');
    } catch (error) {
      show(errorMessage(error, '包装预设保存失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const reseed = async () => {
    if (!window.confirm('确定按现有产品包装记录重算预设吗？当前这份列表（含手工改过的）会被覆盖。')) return;
    setBusy(true);
    try {
      setItems(await reseedPackagingPresets());
      setDirty(false);
      show('已按产品库重新统计，确认无误后请点击保存');
    } catch (error) {
      show(errorMessage(error, '重新统计失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const atLimit = items.length >= PACKAGING_PRESET_LIMIT;

  return <div className="settings-section card">
    <div className="settings-heading"><Package size={18} /><strong>包装预设</strong></div>
    <p>产品编辑器里的「包装方式」会把这些组合显示成一键填入的卡片：点一下同时填好包装名称、内盒尺寸、外箱尺寸、装箱数和包装采购价。预设存在服务端，手机和电脑看到的是同一份。</p>
    {loading && <div className="table-state">正在加载包装预设...</div>}
    {!loading && !!items.length && <div className="packaging-preset-form">
      <div className="packaging-preset-form-head">
        <span>包装名称</span><span>内盒尺寸</span><span>外箱尺寸</span><span>装箱数</span><span>包装采购价</span><span />
      </div>
      {items.map((item, index) => <div className="packaging-preset-form-row" key={item.id || index}>
        <input className="input" aria-label={`预设${index + 1}包装名称`} value={item.name} disabled={busy} placeholder="牛皮纸盒-20台装" onChange={(event) => update(index, { name: event.target.value })} />
        <input className="input" aria-label={`预设${index + 1}内盒尺寸`} value={item.innerSize} disabled={busy} placeholder="45*9*9" onChange={(event) => update(index, { innerSize: event.target.value })} />
        <input className="input" aria-label={`预设${index + 1}外箱尺寸`} value={item.outerSize} disabled={busy} placeholder="47*48*36" onChange={(event) => update(index, { outerSize: event.target.value })} />
        <input className="input" type="number" min={1} aria-label={`预设${index + 1}装箱数`} value={item.packSize} disabled={busy} onChange={(event) => update(index, { packSize: Math.max(1, Math.trunc(Number(event.target.value) || 1)) })} />
        <input className="input" type="number" min={0} step="0.01" aria-label={`预设${index + 1}包装采购价`} value={item.purchasePrice} disabled={busy} placeholder="元" onChange={(event) => update(index, { purchasePrice: event.target.value })} />
        <div className="packaging-preset-form-actions">
          <button className="icon-button" type="button" title="上移" aria-label={`上移第 ${index + 1} 条预设`} disabled={index === 0 || busy} onClick={() => move(index, -1)}><ArrowUp size={14} /></button>
          <button className="icon-button" type="button" title="下移" aria-label={`下移第 ${index + 1} 条预设`} disabled={index === items.length - 1 || busy} onClick={() => move(index, 1)}><ArrowDown size={14} /></button>
          <button className="icon-button danger" type="button" title="删除预设" aria-label={`删除第 ${index + 1} 条预设`} disabled={busy} onClick={() => remove(index)}><Trash2 size={14} /></button>
        </div>
      </div>)}
    </div>}
    {!loading && !items.length && <div className="empty-state">还没有预设。点「从产品库重新统计」可立刻按现有包装记录生成一批，或手动添加。</div>}
    <div className="packaging-preset-form-footer">
      <button className="button button-secondary" type="button" disabled={busy || atLimit} title={atLimit ? `最多 ${PACKAGING_PRESET_LIMIT} 条` : undefined} onClick={add}><Plus size={14} />添加预设</button>
      <button className="button button-secondary" type="button" disabled={busy || loading} onClick={() => void reseed()}><RotateCcw size={14} />从产品库重新统计</button>
      <span className={dirty ? 'packaging-preset-dirty' : 'packaging-preset-saved'} role="status">{dirty ? '有未保存的修改' : `${items.length} / ${PACKAGING_PRESET_LIMIT} 条`}</span>
      <button className="button button-primary" type="button" disabled={busy || loading || !dirty} onClick={() => void save()}><Save size={14} />{busy ? '保存中...' : '保存预设'}</button>
    </div>
    {!!message && <p role="status" className={`notice notice-${messageKind}`} style={{ color: messageKind === 'error' ? 'var(--tone-danger-text)' : 'var(--tone-accent-text)', fontSize: 12 }}>{message}</p>}
  </div>;
}
