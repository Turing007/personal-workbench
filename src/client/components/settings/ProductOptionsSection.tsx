import { Palette, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getProductOptionPresets, reseedProductOptionPresets, saveProductOptionPresets } from '../../api';
import { PRODUCT_OPTION_LIMIT, PRODUCT_OPTION_NAME_LIMIT, cleanProductOptionName, type ProductOptionPresets } from '../../../shared/product-options';

function errorMessage(error: unknown, fallback: string) {
  return (error as { message?: string } | undefined)?.message ?? fallback;
}

type OptionField = keyof ProductOptionPresets;

const GROUPS: Array<{ field: OptionField; label: string; hint: string; placeholder: string }> = [
  { field: 'colors', label: '颜色', hint: '产品编辑器「颜色（多选）」的预设胶囊', placeholder: '如 蓝、红色、墨绿' },
  { field: 'plugs', label: '电池插脚', hint: '产品编辑器「电池插脚（多选）」的预设胶囊', placeholder: '如 MT、DE' },
];

/**
 * 颜色与插脚：产品编辑器里只能从这份清单里勾选，自定义值统一在这里维护。
 * 默认值由产品库现有记录统计得出；用户保存过（哪怕清空）就不再自动重算。
 */
export default function ProductOptionsSection() {
  const [items, setItems] = useState<ProductOptionPresets>({ colors: [], plugs: [] });
  const [drafts, setDrafts] = useState<Record<OptionField, string>>({ colors: '', plugs: '' });
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
    getProductOptionPresets()
      .then((presets) => {
        if (cancelled) return;
        setItems(presets);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoading(false);
        show(errorMessage(error, '颜色与插脚加载失败'), 'error');
      });
    return () => { cancelled = true; };
  }, []);

  const add = (field: OptionField) => {
    const name = cleanProductOptionName(drafts[field]);
    if (!name) return;
    if (items[field].length >= PRODUCT_OPTION_LIMIT) {
      show(`${GROUPS.find((group) => group.field === field)?.label}最多 ${PRODUCT_OPTION_LIMIT} 条，请先删除再添加`, 'error');
      return;
    }
    if (items[field].some((entry) => entry.toLowerCase() === name.toLowerCase())) {
      show(`「${name}」已经在清单里了`, 'error');
      setDrafts((current) => ({ ...current, [field]: '' }));
      return;
    }
    setItems((current) => ({ ...current, [field]: [...current[field], name] }));
    setDrafts((current) => ({ ...current, [field]: '' }));
    setDirty(true);
  };

  const remove = (field: OptionField, name: string) => {
    setItems((current) => ({ ...current, [field]: current[field].filter((entry) => entry !== name) }));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      // 以服务端清洗后的结果为准：重复、超长、超上限都会被处理掉。
      const saved = await saveProductOptionPresets(items);
      setItems(saved);
      setDirty(false);
      show('颜色与插脚已保存，产品编辑器立即可用');
    } catch (error) {
      show(errorMessage(error, '颜色与插脚保存失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const reseed = async () => {
    if (!window.confirm('确定按现有产品记录重新统计吗？当前这份清单（含手工添加的）会被覆盖。')) return;
    setBusy(true);
    try {
      const list = await reseedProductOptionPresets();
      setItems(list);
      setDirty(false);
      show('已按产品库重新统计，确认无误后请点击保存');
    } catch (error) {
      show(errorMessage(error, '重新统计失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return <div className="settings-section card">
    <div className="settings-heading"><Palette size={18} /><strong>颜色与插脚</strong></div>
    <p>产品编辑器里的颜色、电池插脚只能从这里勾选，不再支持在编辑器里临时新增。默认按产品库现有记录统计；留空表示该项暂时没有可选项。</p>
    {loading && <div className="table-state">正在加载颜色与插脚...</div>}
    {!loading && <div className="product-options-editor">
      {GROUPS.map((group) => {
        const list = items[group.field];
        const full = list.length >= PRODUCT_OPTION_LIMIT;
        return <div className="product-options-group" key={group.field}>
          <div className="product-options-group-head">
            <strong>{group.label}</strong>
            <span>{list.length} / {PRODUCT_OPTION_LIMIT} 条</span>
          </div>
          <p className="product-options-hint">{group.hint}</p>
          {list.length
            ? <div className="product-options-chips">
              {list.map((name) => <span className="product-options-chip" key={name}>
                {name}
                <button
                  type="button"
                  aria-label={`删除${group.label} ${name}`}
                  title="删除"
                  disabled={busy}
                  onClick={() => remove(group.field, name)}
                ><Trash2 size={11} /></button>
              </span>)}
            </div>
            : <div className="empty-state">还没有{group.label}。可在下方输入添加，或点「从产品库重新统计」。</div>}
          <div className="product-options-add">
            <input
              className="input"
              aria-label={`新增${group.label}`}
              value={drafts[group.field]}
              maxLength={PRODUCT_OPTION_NAME_LIMIT}
              disabled={busy || full}
              placeholder={full ? `最多 ${PRODUCT_OPTION_LIMIT} 条` : group.placeholder}
              onChange={(event) => setDrafts((current) => ({ ...current, [group.field]: event.target.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(group.field); } }}
            />
            <button className="button button-secondary" type="button" disabled={busy || full || !drafts[group.field].trim()} onClick={() => add(group.field)}><Plus size={14} />添加</button>
          </div>
        </div>;
      })}
    </div>}
    <div className="product-options-footer">
      <button className="button button-secondary" type="button" disabled={busy || loading} onClick={() => void reseed()}><RotateCcw size={14} />从产品库重新统计</button>
      <span className={dirty ? 'packaging-preset-dirty' : 'packaging-preset-saved'} role="status">{dirty ? '有未保存的修改' : '已与产品编辑器同步'}</span>
      <button className="button button-primary" type="button" disabled={busy || loading || !dirty} onClick={() => void save()}><Save size={14} />{busy ? '保存中...' : '保存'}</button>
    </div>
    {!!message && <p role="status" className={`notice notice-${messageKind}`} style={{ color: messageKind === 'error' ? 'var(--tone-danger-text)' : 'var(--tone-accent-text)', fontSize: 12 }}>{message}</p>}
  </div>;
}
