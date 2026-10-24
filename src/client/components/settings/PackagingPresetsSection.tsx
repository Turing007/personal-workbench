import { ArrowDown, ArrowUp, Package, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getPackagingCategories, getPackagingPresets, getVolumeDivisor, reseedPackagingPresets, savePackagingPresets, saveVolumeDivisor } from '../../api';
import { PACKAGING_PRESET_LIMIT, type PackagingPreset } from '../../../shared/packaging-presets';
import { DEFAULT_VOLUME_DIVISOR, normalizeVolumeDivisor, VOLUME_DIVISOR_MAX, VOLUME_DIVISOR_MIN } from '../../../shared/price-calculator';

function errorMessage(error: unknown, fallback: string) {
  return (error as { message?: string } | undefined)?.message ?? fallback;
}

interface CategoryOption {
  name: string;
  productCount: number;
}

/**
 * 包装管理：包装规格的主数据维护入口。
 * 既保留「一键填入」的原有用途，又新增「可以装哪些产品」—— 按产品分类关联，
 * 产品编辑器里命中的包装会排到最前面并带「适用本类」角标。
 */
export default function PackagingPresetsSection() {
  const [items, setItems] = useState<PackagingPreset[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error'>('success');
  /** 体积重参数：售价计算器自动预估运费共用，和包装尺寸直接相关，放这一区维护。 */
  const [volumeDivisor, setVolumeDivisor] = useState(DEFAULT_VOLUME_DIVISOR);
  const [volumeInput, setVolumeInput] = useState(String(DEFAULT_VOLUME_DIVISOR));
  const [volumeBusy, setVolumeBusy] = useState(false);
  const [volumeMessage, setVolumeMessage] = useState('');

  const show = (text: string, kind: 'success' | 'error' = 'success') => {
    setMessage(text);
    setMessageKind(kind);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPackagingPresets(), getPackagingCategories(), getVolumeDivisor().catch(() => DEFAULT_VOLUME_DIVISOR)])
      .then(([presets, categories, divisor]) => {
        if (cancelled) return;
        setItems(presets);
        setCategoryOptions(categories);
        setVolumeDivisor(divisor);
        setVolumeInput(String(divisor));
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setItems([]);
        setCategoryOptions([]);
        setLoading(false);
        show(errorMessage(error, '包装管理数据加载失败'), 'error');
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
    setItems((current) => [...current, { id: `pack-preset-${Date.now()}`, name: '', innerSize: '', outerSize: '', packSize: 1, purchasePrice: '', categories: [] }]);
    setDirty(true);
  };

  /** 勾选/取消一个适用分类；候选之外的手工分类也能加进来（回车提交）。 */
  const toggleCategory = (index: number, category: string) => {
    const name = category.trim();
    if (!name) return;
    setItems((current) => current.map((item, position) => {
      if (position !== index) return item;
      const exists = item.categories.includes(name);
      return { ...item, categories: exists ? item.categories.filter((entry) => entry !== name) : [...item.categories, name] };
    }));
    setDirty(true);
    if (!categoryOptions.some((option) => option.name === name)) {
      setCategoryOptions((current) => [...current, { name, productCount: 0 }].sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name)));
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      // 以服务端清洗后的结果为准：全空行会被丢掉、超出上限会被截断。
      const saved = await savePackagingPresets(items);
      setItems(saved);
      setDirty(false);
      // 保存后重新拉一次候选：可能新增了手工分类，合并进列表供下次编辑展示。
      try {
        setCategoryOptions(await getPackagingCategories());
      } catch {
        // 候选刷新失败不影响保存结果，静默保留旧候选。
      }
      show('包装管理已保存，产品编辑器立即可用');
    } catch (error) {
      show(errorMessage(error, '包装管理保存失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const reseed = async () => {
    if (!window.confirm('确定按现有产品包装记录重算吗？当前这份列表（含手工改过的）会被覆盖。')) return;
    setBusy(true);
    try {
      const list = await reseedPackagingPresets();
      setItems(list);
      setDirty(false);
      show('已按产品库重新统计，确认无误后请点击保存');
    } catch (error) {
      show(errorMessage(error, '重新统计失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveVolume = async () => {
    if (volumeBusy) return;
    setVolumeBusy(true);
    setVolumeMessage('');
    try {
      const saved = await saveVolumeDivisor(normalizeVolumeDivisor(volumeInput));
      setVolumeDivisor(saved);
      setVolumeInput(String(saved));
      setVolumeMessage('已保存，售价计算器立即生效');
    } catch (error) {
      setVolumeMessage(errorMessage(error, '体积参数保存失败'));
    } finally {
      setVolumeBusy(false);
    }
  };

  const atLimit = items.length >= PACKAGING_PRESET_LIMIT;

  return <div className="settings-section card">
    <div className="settings-heading"><Package size={18} /><strong>包装管理</strong></div>
    <p>包装规格的主数据。产品编辑器「包装方式」上方的卡片点一下即可整行填入；「可以装哪些产品」按产品分类关联，编辑对应分类的产品时，适用的包装会排到最前面并标注「适用本类」。留空表示通用，不限分类。</p>
    <section className="volume-setting-box" aria-label="运费体积参数">
      <div className="volume-setting-head"><strong>运费体积参数</strong><em>cm³/kg</em></div>
      <div className="volume-setting-row">
        <input
          className="input"
          type="number"
          min={VOLUME_DIVISOR_MIN}
          max={VOLUME_DIVISOR_MAX}
          step={100}
          aria-label="运费体积参数"
          value={volumeInput}
          disabled={volumeBusy}
          onChange={(event) => setVolumeInput(event.target.value)}
        />
        <button className="button button-primary button-sm" type="button" disabled={volumeBusy || normalizeVolumeDivisor(volumeInput) === volumeDivisor} onClick={() => void saveVolume()}>{volumeBusy ? '保存中...' : '保存'}</button>
      </div>
      <p className="volume-setting-hint">售价计算器自动预估运费时使用：单台抛重 = 外箱长×宽×高 ÷ 参数 ÷ 装箱数，实重与抛重取较大者。默认 8000；在计算器点运费金额也能改，保存后所有产品共用。</p>
      {!!volumeMessage && <p className="volume-setting-message" role="status">{volumeMessage}</p>}
    </section>
    {loading && <div className="table-state">正在加载包装管理...</div>}
    {!loading && !!items.length && <div className="packaging-preset-form">
      <div className="packaging-preset-form-head">
        <span>包装名称</span><span>内盒尺寸</span><span>外箱尺寸</span><span>装箱数</span><span>包装采购价</span><span>可以装哪些产品</span><span />
      </div>
      {items.map((item, index) => <div className="packaging-preset-form-row" key={item.id || index}>
        <input className="input" aria-label={`包装${index + 1}包装名称`} value={item.name} disabled={busy} placeholder="牛皮纸盒-20台装" onChange={(event) => update(index, { name: event.target.value })} />
        <input className="input" aria-label={`包装${index + 1}内盒尺寸`} value={item.innerSize} disabled={busy} placeholder="45*9*9" onChange={(event) => update(index, { innerSize: event.target.value })} />
        <input className="input" aria-label={`包装${index + 1}外箱尺寸`} value={item.outerSize} disabled={busy} placeholder="47*48*36" onChange={(event) => update(index, { outerSize: event.target.value })} />
        <input className="input" type="number" min={1} aria-label={`包装${index + 1}装箱数`} value={item.packSize} disabled={busy} onChange={(event) => update(index, { packSize: Math.max(1, Math.trunc(Number(event.target.value) || 1)) })} />
        <input className="input" type="number" min={0} step="0.01" aria-label={`包装${index + 1}包装采购价`} value={item.purchasePrice} disabled={busy} placeholder="元" onChange={(event) => update(index, { purchasePrice: event.target.value })} />
        <div className="packaging-preset-categories">
          {item.categories.map((category) => <span className="packaging-preset-category-chip" key={category}>
            {category}
            <button type="button" aria-label={`移除包装${index + 1}的分类 ${category}`} title="移除该分类" disabled={busy} onClick={() => toggleCategory(index, category)}><X size={11} /></button>
          </span>)}
          <select
            className="input packaging-preset-category-select"
            aria-label={`包装${index + 1}添加适用分类`}
            value=""
            disabled={busy}
            onChange={(event) => { if (event.target.value) toggleCategory(index, event.target.value); }}
          >
            <option value="">+ 添加分类</option>
            {categoryOptions
              .filter((option) => !item.categories.includes(option.name))
              .map((option) => <option key={option.name} value={option.name}>{option.name}{option.productCount ? `（${option.productCount}）` : ''}</option>)}
          </select>
        </div>
        <div className="packaging-preset-form-actions">
          <button className="icon-button" type="button" title="上移" aria-label={`上移第 ${index + 1} 条包装`} disabled={index === 0 || busy} onClick={() => move(index, -1)}><ArrowUp size={14} /></button>
          <button className="icon-button" type="button" title="下移" aria-label={`下移第 ${index + 1} 条包装`} disabled={index === items.length - 1 || busy} onClick={() => move(index, 1)}><ArrowDown size={14} /></button>
          <button className="icon-button danger" type="button" title="删除包装" aria-label={`删除第 ${index + 1} 条包装`} disabled={busy} onClick={() => remove(index)}><Trash2 size={14} /></button>
        </div>
      </div>)}
    </div>}
    {!loading && !items.length && <div className="empty-state">还没有包装规格。点「从产品库重新统计」可立刻按现有包装记录生成一批，或手动添加。</div>}
    <div className="packaging-preset-form-footer">
      <button className="button button-secondary" type="button" disabled={busy || atLimit} title={atLimit ? `最多 ${PACKAGING_PRESET_LIMIT} 条` : undefined} onClick={add}><Plus size={14} />添加包装</button>
      <button className="button button-secondary" type="button" disabled={busy || loading} onClick={() => void reseed()}><RotateCcw size={14} />从产品库重新统计</button>
      <span className={dirty ? 'packaging-preset-dirty' : 'packaging-preset-saved'} role="status">{dirty ? '有未保存的修改' : `${items.length} / ${PACKAGING_PRESET_LIMIT} 条`}</span>
      <button className="button button-primary" type="button" disabled={busy || loading || !dirty} onClick={() => void save()}><Save size={14} />{busy ? '保存中...' : '保存'}</button>
    </div>
    {!!message && <p role="status" className={`notice notice-${messageKind}`} style={{ color: messageKind === 'error' ? 'var(--tone-danger-text)' : 'var(--tone-accent-text)', fontSize: 12 }}>{message}</p>}
  </div>;
}
