import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BatteryCharging, Plus, Save, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { getBatteryPriceMatrix, getChargerPrices, saveBatteryPriceMatrix, saveChargerPrices } from '../../api';
import { ACCESSORY_PRICE_LIST_LIMIT, type AccessoryPrice } from '../../../shared/accessory-prices';
import {
  BATTERY_MATRIX_MAX_DIM,
  moveBatteryCapacity,
  moveBatteryPackCount,
  type BatteryPriceMatrix,
} from '../../../shared/battery-prices';

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

  const [chargers, setChargers] = useState<AccessoryPrice[]>([]);
  const [chargerDirty, setChargerDirty] = useState(false);
  const [chargerBusy, setChargerBusy] = useState(false);
  const [chargerMessage, setChargerMessage] = useState('');
  const [chargerMessageKind, setChargerMessageKind] = useState<'success' | 'error'>('success');

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getBatteryPriceMatrix(), getChargerPrices()])
      .then(([matrixItems, chargerItems]) => {
        if (cancelled) return;
        setMatrix(matrixItems);
        setChargers(chargerItems);
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
    }));
    setMatrixDirty(true);
  };
  const addPackCountColumn = () => {
    setMatrix((current) => ({
      ...current,
      packCounts: [...current.packCounts, 0],
      prices: current.prices.map((row) => [...row, 0]),
    }));
    setMatrixDirty(true);
  };
  const removeCapacityRow = (rowIndex: number) => {
    setMatrix((current) => ({
      ...current,
      capacities: current.capacities.filter((_item, index) => index !== rowIndex),
      prices: current.prices.filter((_row, index) => index !== rowIndex),
    }));
    setMatrixDirty(true);
  };
  const removePackCountColumn = (colIndex: number) => {
    setMatrix((current) => ({
      ...current,
      packCounts: current.packCounts.filter((_item, index) => index !== colIndex),
      prices: current.prices.map((row) => row.filter((_cell, index) => index !== colIndex)),
    }));
    setMatrixDirty(true);
  };

  const moveCapacity = (from: number, to: number) => {
    setMatrix((current) => moveBatteryCapacity(current, from, to));
    setMatrixDirty(true);
  };
  const movePackCount = (from: number, to: number) => {
    setMatrix((current) => moveBatteryPackCount(current, from, to));
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

  /** 行首/列头的小眼睛已移除：显示哪些节数统一由产品电压决定。 */
  return <div className="settings-section card">
    <div className="settings-heading"><BatteryCharging size={18} /><strong>电池与充电器</strong></div>
    <p>售价计算器里按行名自动匹配：<b>电池行只出电池价、充电器行只出充电器价</b>；其它专属配件（钻头、锯片等）按产品类目在产品编辑器里维护。</p>

    <h3 className="accessory-module-title">电池价格（行 = 单节容量，列 = 节数，格子 = 单价）</h3>
    <p className="battery-scope-hint">显示哪些节数由产品编辑里的<b>电池电压</b>决定：12V → 3 节、16.8V → 4 节、21V → 5 节及以上。箭头用来调整顺序，改完点下方「保存电池价格」。</p>
    {loading && <div className="table-state">正在加载...</div>}
    {!loading && <>
      <div className="battery-matrix-scroll">
      <div className="battery-matrix" style={{ gridTemplateColumns: `132px repeat(${matrix.packCounts.length}, minmax(78px, 1fr)) 30px` }}>
        <span className="battery-matrix-corner">容量 \ 节数</span>
        {matrix.packCounts.map((packCount, colIndex) => <div className="battery-matrix-headcol" key={`col-${colIndex}`}>
          <span className="battery-matrix-col-edit">
            <input className="input" type="number" min={1} aria-label={`第 ${colIndex + 1} 节数列数`} value={packCount || ''} placeholder="节数" disabled={matrixBusy} onChange={(event) => updatePackCount(colIndex, event.target.value)} />
            <span>节</span>
          </span>
          <span className="battery-matrix-col-tools">
            <button className="battery-move-button" type="button" title="左移这一列" aria-label={`左移第 ${colIndex + 1} 节数列`} disabled={matrixBusy || colIndex === 0} onClick={() => movePackCount(colIndex, colIndex - 1)}><ArrowLeft size={12} /></button>
            <button className="battery-move-button" type="button" title="右移这一列" aria-label={`右移第 ${colIndex + 1} 节数列`} disabled={matrixBusy || colIndex >= matrix.packCounts.length - 1} onClick={() => movePackCount(colIndex, colIndex + 1)}><ArrowRight size={12} /></button>
            <button className="battery-move-button is-danger" type="button" title="删除这一节数列" aria-label={`删除第 ${colIndex + 1} 节数列`} disabled={matrixBusy} onClick={() => removePackCountColumn(colIndex)}><Trash2 size={12} /></button>
          </span>
        </div>)}
        <span />
        {matrix.capacities.map((capacity, rowIndex) => <Fragment key={`row-${rowIndex}`}>
          <span className="battery-matrix-rowhead">
            <span className="battery-matrix-row-line">
              <input className="input" type="number" min={1} aria-label={`第 ${rowIndex + 1} 容量行 mAh`} value={capacity || ''} placeholder="容量" disabled={matrixBusy} onChange={(event) => updateCapacity(rowIndex, event.target.value)} />
              <span>mAh</span>
            </span>
            <span className="battery-matrix-row-tools">
              <button className="battery-move-button" type="button" title="上移这一行" aria-label={`上移第 ${rowIndex + 1} 容量行`} disabled={matrixBusy || rowIndex === 0} onClick={() => moveCapacity(rowIndex, rowIndex - 1)}><ArrowUp size={12} /></button>
              <button className="battery-move-button" type="button" title="下移这一行" aria-label={`下移第 ${rowIndex + 1} 容量行`} disabled={matrixBusy || rowIndex >= matrix.capacities.length - 1} onClick={() => moveCapacity(rowIndex, rowIndex + 1)}><ArrowDown size={12} /></button>
            </span>
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
  </div>;
}
