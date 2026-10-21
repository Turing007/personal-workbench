import { BatteryCharging, Eye, EyeOff, Plus, Save, Trash2, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { getBatteryPriceMatrix, getChargerPrices, getPackagingCategories, saveBatteryPriceMatrix, saveChargerPrices } from '../../api';
import { ACCESSORY_PRICE_LIST_LIMIT, type AccessoryPrice } from '../../../shared/accessory-prices';
import { BATTERY_MATRIX_MAX_DIM, type BatteryPriceMatrix } from '../../../shared/battery-prices';
import AnchoredPopover from '../AnchoredPopover';

function errorMessage(error: unknown, fallback: string) {
  return (error as { message?: string } | undefined)?.message ?? fallback;
}

const EMPTY_MATRIX: BatteryPriceMatrix = { capacities: [], packCounts: [], prices: [] };

/** 电池/充电器价格：售价计算器里按行名自动匹配——电池行只出电池价、充电器行只出充电器价。 */
export default function AccessoryPricesSection() {
  const [matrix, setMatrix] = useState<BatteryPriceMatrix>(EMPTY_MATRIX);
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [matrixBusy, setMatrixBusy] = useState(false);
  const [matrixMessage, setMatrixMessage] = useState('');
  const [matrixMessageKind, setMatrixMessageKind] = useState<'success' | 'error'>('success');
  const [categoryOptions, setCategoryOptions] = useState<Array<{ name: string; productCount: number }>>([]);
  /** 正在编辑可见范围的行/列：null = 没开；用锚点定位弹出层。 */
  const [scopeEditor, setScopeEditor] = useState<{ kind: 'capacity' | 'packCount'; index: number; anchor: HTMLElement } | null>(null);
  const scopeEditorRef = useRef<HTMLDivElement>(null);

  const [chargers, setChargers] = useState<AccessoryPrice[]>([]);
  const [chargerDirty, setChargerDirty] = useState(false);
  const [chargerBusy, setChargerBusy] = useState(false);
  const [chargerMessage, setChargerMessage] = useState('');
  const [chargerMessageKind, setChargerMessageKind] = useState<'success' | 'error'>('success');

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getBatteryPriceMatrix(), getChargerPrices(), getPackagingCategories().catch(() => [])])
      .then(([matrixItems, chargerItems, categories]) => {
        if (cancelled) return;
        setMatrix(matrixItems);
        setChargers(chargerItems);
        setCategoryOptions(categories);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoading(false);
        setMatrixMessageKind('error');
        setMatrixMessage(errorMessage(error, '电池/充电器价格加载失败'));
      });
    return () => { cancelled = true; };
  }, []);

  const updateCell = (rowIndex: number, colIndex: number, value: string) => {
    setMatrix((current) => ({
      ...current,
      prices: current.prices.map((row, r) => (r === rowIndex ? row.map((cell, c) => (c === colIndex ? Number(value) || 0 : cell)) : row)),
    }));
    setMatrixDirty(true);
  };
  const updateCapacity = (rowIndex: number, value: string) => {
    const parsed = Math.trunc(Number(value)) || 0;
    setMatrix((current) => ({ ...current, capacities: current.capacities.map((item, index) => (index === rowIndex ? parsed : item)) }));
    setMatrixDirty(true);
  };
  const updatePackCount = (colIndex: number, value: string) => {
    const parsed = Math.trunc(Number(value)) || 0;
    setMatrix((current) => ({ ...current, packCounts: current.packCounts.map((item, index) => (index === colIndex ? parsed : item)) }));
    setMatrixDirty(true);
  };
  const addCapacityRow = () => {
    setMatrix((current) => ({
      ...current,
      capacities: [...current.capacities, 0],
      prices: [...current.prices, new Array(current.packCounts.length).fill(0)],
      capacityScopes: [...(current.capacityScopes ?? current.capacities.map(() => [])), []],
    }));
    setMatrixDirty(true);
  };
  const addPackCountColumn = () => {
    setMatrix((current) => ({
      ...current,
      packCounts: [...current.packCounts, 0],
      prices: current.prices.map((row) => [...row, 0]),
      packCountScopes: [...(current.packCountScopes ?? current.packCounts.map(() => [])), []],
    }));
    setMatrixDirty(true);
  };
  const removeCapacityRow = (rowIndex: number) => {
    setMatrix((current) => ({
      ...current,
      capacities: current.capacities.filter((_item, index) => index !== rowIndex),
      prices: current.prices.filter((_row, index) => index !== rowIndex),
      capacityScopes: (current.capacityScopes ?? current.capacities.map(() => [])).filter((_item, index) => index !== rowIndex),
    }));
    setMatrixDirty(true);
  };
  const removePackCountColumn = (colIndex: number) => {
    setMatrix((current) => ({
      ...current,
      packCounts: current.packCounts.filter((_item, index) => index !== colIndex),
      prices: current.prices.map((row) => row.filter((_cell, index) => index !== colIndex)),
      packCountScopes: (current.packCountScopes ?? current.packCounts.map(() => [])).filter((_item, index) => index !== colIndex),
    }));
    setMatrixDirty(true);
  };

  /** 切换某行/某列的可见范围：空数组 = 所有产品都显示。 */
  const toggleScope = (kind: 'capacity' | 'packCount', index: number, category: string) => {
    setMatrix((current) => {
      const key = kind === 'capacity' ? 'capacityScopes' : 'packCountScopes';
      const list = (current[key] ?? (kind === 'capacity' ? current.capacities : current.packCounts).map(() => []))
        .map((scope, position) => (position === index
          ? (scope.includes(category) ? scope.filter((entry) => entry !== category) : [...scope, category])
          : scope));
      return { ...current, [key]: list };
    });
    setMatrixDirty(true);
  };

  const saveMatrix = async () => {
    setMatrixBusy(true);
    try {
      setMatrix(await saveBatteryPriceMatrix(matrix));
      setMatrixDirty(false);
      setMatrixMessageKind('success');
      setMatrixMessage('电池价格已保存，售价计算器立即可用');
    } catch (error) {
      setMatrixMessageKind('error');
      setMatrixMessage(errorMessage(error, '电池价格保存失败'));
    } finally {
      setMatrixBusy(false);
    }
  };

  const updateCharger = (index: number, patch: Partial<AccessoryPrice>) => {
    setChargers((current) => current.map((item, position) => (position === index ? { ...item, ...patch } : item)));
    setChargerDirty(true);
  };
  const removeCharger = (index: number) => {
    setChargers((current) => current.filter((_item, position) => position !== index));
    setChargerDirty(true);
  };
  const addCharger = () => {
    setChargers((current) => [...current, { id: `charger-${Date.now()}`, name: '', price: 0 }]);
    setChargerDirty(true);
  };
  const saveChargers = async () => {
    setChargerBusy(true);
    try {
      setChargers(await saveChargerPrices(chargers));
      setChargerDirty(false);
      setChargerMessageKind('success');
      setChargerMessage('充电器价格已保存，售价计算器立即可用');
    } catch (error) {
      setChargerMessageKind('error');
      setChargerMessage(errorMessage(error, '充电器价格保存失败'));
    } finally {
      setChargerBusy(false);
    }
  };

  const matrixAtLimit = matrix.capacities.length >= BATTERY_MATRIX_MAX_DIM || matrix.packCounts.length >= BATTERY_MATRIX_MAX_DIM;
  const chargerAtLimit = chargers.length >= ACCESSORY_PRICE_LIST_LIMIT;

  /** 某行/某列当前的可见范围；空数组 = 所有产品可见。 */
  const scopeOf = (kind: 'capacity' | 'packCount', index: number): string[] => {
    const list = kind === 'capacity' ? matrix.capacityScopes : matrix.packCountScopes;
    return list?.[index] ?? [];
  };

  /** 行首/列头的眼睛：范围为空显示睁眼（对所有产品可见），有限定时显示闭眼并标出数量。 */
  const renderScopeEye = (kind: 'capacity' | 'packCount', index: number, label: string) => {
    const scope = scopeOf(kind, index);
    const limited = scope.length > 0;
    const open = scopeEditor?.kind === kind && scopeEditor.index === index;
    return <button
      className={`icon-button battery-scope-eye${limited ? ' is-limited' : ''}${open ? ' is-open' : ''}`}
      type="button"
      title={limited ? `${label}：只在 ${scope.join('、')} 显示` : `${label}：所有产品都显示（点开可限定）`}
      aria-label={limited ? `${label}可见范围：${scope.join('、')}` : `${label}：所有产品可见`}
      aria-expanded={open}
      disabled={matrixBusy}
      onClick={(event) => {
        const anchor = event.currentTarget;
        setScopeEditor((current) => (current?.kind === kind && current.index === index ? null : { kind, index, anchor }));
      }}
    >{limited ? <EyeOff size={13} /> : <Eye size={13} />}</button>;
  };

  const scopeEditorScope = scopeEditor ? scopeOf(scopeEditor.kind, scopeEditor.index) : [];
  const scopeEditorLabel = scopeEditor
    ? (scopeEditor.kind === 'capacity'
      ? `${matrix.capacities[scopeEditor.index] || `第 ${scopeEditor.index + 1} 容量行`} mAh`
      : `${matrix.packCounts[scopeEditor.index] || `第 ${scopeEditor.index + 1} 节数列`} 节`)
    : '';

  return <div className="settings-section card">
    <div className="settings-heading"><BatteryCharging size={18} /><strong>电池与充电器</strong></div>
    <p>售价计算器里按行名自动匹配：<b>电池行只出电池价、充电器行只出充电器价</b>；其它专属配件（钻头、锯片等）按产品类目在产品编辑器里维护。</p>

    <h3 className="accessory-module-title">电池价格（行 = 单节容量，列 = 节数，格子 = 单价）</h3>
    <p className="battery-scope-hint">行首、列头的<b>眼睛</b>用来限定这一行/列在哪些产品里出现：点开勾选产品分类，不勾（默认）就是所有产品都显示。</p>
    {loading && <div className="table-state">正在加载...</div>}
    {!loading && <>
      <div className="battery-matrix" style={{ gridTemplateColumns: `132px repeat(${matrix.packCounts.length}, minmax(78px, 1fr)) 30px` }}>
        <span className="battery-matrix-corner">容量 \ 节数</span>
        {matrix.packCounts.map((packCount, colIndex) => <div className="battery-matrix-headcol" key={`col-${colIndex}`}>
          <span className="battery-matrix-col-edit">
            {renderScopeEye('packCount', colIndex, `第 ${colIndex + 1} 节数列`)}
            <input className="input" type="number" min={1} aria-label={`第 ${colIndex + 1} 节数列数`} value={packCount || ''} placeholder="节数" disabled={matrixBusy} onChange={(event) => updatePackCount(colIndex, event.target.value)} />
            <span>节</span>
          </span>
          <button className="icon-button danger" type="button" title="删除这一节数列" aria-label={`删除第 ${colIndex + 1} 节数列`} disabled={matrixBusy} onClick={() => removePackCountColumn(colIndex)}><Trash2 size={13} /></button>
        </div>)}
        <span />
        {matrix.capacities.map((capacity, rowIndex) => <Fragment key={`row-${rowIndex}`}>
          <span className="battery-matrix-rowhead">
            {renderScopeEye('capacity', rowIndex, `第 ${rowIndex + 1} 容量行`)}
            <input className="input" type="number" min={1} aria-label={`第 ${rowIndex + 1} 容量行 mAh`} value={capacity || ''} placeholder="容量" disabled={matrixBusy} onChange={(event) => updateCapacity(rowIndex, event.target.value)} />
            <span>mAh</span>
          </span>
          {matrix.packCounts.map((_packCount, colIndex) => <input
            key={`cell-${rowIndex}-${colIndex}`}
            className="input"
            type="number"
            min={0}
            step="0.01"
            aria-label={`${capacity || `容量行 ${rowIndex + 1}`} ${matrix.packCounts[colIndex] || ''} 节的单价`}
            value={matrix.prices[rowIndex]?.[colIndex] || ''}
            placeholder="元"
            disabled={matrixBusy}
            onChange={(event) => updateCell(rowIndex, colIndex, event.target.value)}
          />)}
          <button className="icon-button danger" type="button" title="删除这一容量行" aria-label={`删除第 ${rowIndex + 1} 容量行`} disabled={matrixBusy} onClick={() => removeCapacityRow(rowIndex)}><Trash2 size={13} /></button>
        </Fragment>)}
      </div>
      {!matrix.capacities.length && !matrix.packCounts.length && <div className="empty-state">矩阵还是空的：先「添加容量行」和「添加节数列」，再逐格填单价。</div>}
      <div className="packaging-preset-form-footer">
        <button className="button button-secondary" type="button" disabled={matrixBusy || matrixAtLimit} title={matrixAtLimit ? `行列各最多 ${BATTERY_MATRIX_MAX_DIM} 个` : undefined} onClick={addCapacityRow}><Plus size={14} />添加容量行</button>
        <button className="button button-secondary" type="button" disabled={matrixBusy || matrixAtLimit} title={matrixAtLimit ? `行列各最多 ${BATTERY_MATRIX_MAX_DIM} 个` : undefined} onClick={addPackCountColumn}><Plus size={14} />添加节数列</button>
        <span className={matrixDirty ? 'packaging-preset-dirty' : 'packaging-preset-saved'} role="status">{matrixDirty ? '有未保存的修改' : ''}</span>
        <button className="button button-primary" type="button" disabled={matrixBusy || !matrixDirty} onClick={() => void saveMatrix()}><Save size={14} />{matrixBusy ? '保存中...' : '保存电池价格'}</button>
      </div>
      {!!matrixMessage && <p role="status" className="notice" style={{ color: matrixMessageKind === 'error' ? 'var(--tone-danger-text)' : 'var(--tone-accent-text)', fontSize: 12 }}>{matrixMessage}</p>}
    </>}

    <h3 className="accessory-module-title">充电器价格（名称 + 单价）</h3>
    {loading && <div className="table-state">正在加载...</div>}
    {!loading && <>
      {!!chargers.length && <div className="accessory-price-list">
        {chargers.map((item, index) => <div className="accessory-price-row" key={item.id || index}>
          <input className="input" aria-label={`充电器${index + 1}名称`} value={item.name} disabled={chargerBusy} placeholder="如：1.5A 充电器" onChange={(event) => updateCharger(index, { name: event.target.value })} />
          <input className="input" type="number" min={0} step="0.01" aria-label={`充电器${index + 1}价格`} value={item.price} disabled={chargerBusy} placeholder="元" onChange={(event) => updateCharger(index, { price: Number(event.target.value) || 0 })} />
          <button className="icon-button danger" type="button" title="删除这条价格" aria-label={`删除第 ${index + 1} 条充电器价格`} disabled={chargerBusy} onClick={() => removeCharger(index)}><Trash2 size={14} /></button>
        </div>)}
      </div>}
      {!chargers.length && <div className="empty-state">还没有充电器价格，点「添加一行」开始（如：1.5A 充电器 6 元）。</div>}
      <div className="packaging-preset-form-footer">
        <button className="button button-secondary" type="button" disabled={chargerBusy || chargerAtLimit} title={chargerAtLimit ? `最多 ${ACCESSORY_PRICE_LIST_LIMIT} 条` : undefined} onClick={addCharger}><Plus size={14} />添加一行</button>
        <span className={chargerDirty ? 'packaging-preset-dirty' : 'packaging-preset-saved'} role="status">{chargerDirty ? '有未保存的修改' : `${chargers.length} / ${ACCESSORY_PRICE_LIST_LIMIT} 条`}</span>
        <button className="button button-primary" type="button" disabled={chargerBusy || !chargerDirty} onClick={() => void saveChargers()}><Save size={14} />{chargerBusy ? '保存中...' : '保存充电器价格'}</button>
      </div>
      {!!chargerMessage && <p role="status" className="notice" style={{ color: chargerMessageKind === 'error' ? 'var(--tone-danger-text)' : 'var(--tone-accent-text)', fontSize: 12 }}>{chargerMessage}</p>}
    </>}

    {/* 可见范围编辑器：勾选的产品分类才会在计算器里看到这一行/列；一个都不勾 = 所有产品可见。 */}
    {scopeEditor && <AnchoredPopover anchor={scopeEditor.anchor} width={260} maxHeight={320} onClose={() => setScopeEditor(null)}>
      <div className="battery-scope-panel" ref={scopeEditorRef}>
        <div className="battery-scope-head">
          <strong>{scopeEditorLabel} 显示给</strong>
          <button className="icon-button" type="button" title="关闭" aria-label="关闭可见范围" onClick={() => setScopeEditor(null)}><X size={13} /></button>
        </div>
        <p className="battery-scope-tip">{scopeEditorScope.length ? '只在这些分类的产品里显示；取消全部勾选则所有产品都显示。' : '当前所有产品都显示。勾选分类后，只在这些分类的产品里显示。'}</p>
        <div className="battery-scope-list">
          {categoryOptions.map((option) => <label className="battery-scope-option" key={option.name}>
            <input
              type="checkbox"
              checked={scopeEditorScope.includes(option.name)}
              onChange={() => toggleScope(scopeEditor.kind, scopeEditor.index, option.name)}
            />
            <span>{option.name}</span>
            {option.productCount > 0 && <em>{option.productCount}</em>}
          </label>)}
          {!categoryOptions.length && <div className="battery-scope-empty">产品库里还没有分类，先去产品编辑器给产品填分类。</div>}
        </div>
        {!!scopeEditorScope.length && <div className="battery-scope-chips">
          {scopeEditorScope.map((category) => <span className="packaging-preset-category-chip" key={category}>
            {category}
            <button type="button" title="移除该分类" aria-label={`移除分类 ${category}`} onClick={() => toggleScope(scopeEditor.kind, scopeEditor.index, category)}><X size={11} /></button>
          </span>)}
        </div>}
        <p className="battery-scope-foot">改完记得点下方「保存电池价格」。</p>
      </div>
    </AnchoredPopover>}
  </div>;
}
