import { useEffect, useState } from 'react';
import { ChevronDown, Plus, Save, Trash2 } from 'lucide-react';
import Modal from './Modal';
import {
  deletePricePlan,
  getAccessoryPrices,
  listPricePlans,
  savePricePlan,
  type PricePlanRecord,
} from '../api';
import type { ProductRecord } from './ProductEditor';
import type { AccessoryPrice } from '../../shared/accessory-prices';
import {
  planItemAmount,
  planMargin,
  planSalePrice,
  planTotalCost,
  type PricePlanItem,
} from '../../shared/price-calculator';

interface CalculatorRow {
  key: string;
  name: string;
  qty: string;
  unitPrice: string;
}

const MARKUP_MEMORY_KEY = 'price-calc-markup';

function makeKey() {
  return `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function rememberedMarkup(): string {
  try {
    return localStorage.getItem(MARKUP_MEMORY_KEY) ?? '20';
  } catch {
    return '20';
  }
}

/** 默认明细：产品成本与首个包装自动带价，其余留空待选或手填。 */
function defaultRows(product: ProductRecord): CalculatorRow[] {
  const quotes = product.purchaseQuotes ?? [];
  const defaultQuote = quotes.find((quote) => quote.isDefault) ?? quotes[0];
  const productCost = (defaultQuote?.price ?? '').trim() || product.purchasePrice || '';
  const firstPackaging = product.packaging[0];
  return [
    { key: makeKey(), name: '产品成本', qty: '1', unitPrice: productCost },
    { key: makeKey(), name: firstPackaging?.name.trim() || '包装', qty: '1', unitPrice: firstPackaging?.purchasePrice ?? '' },
    { key: makeKey(), name: '电池', qty: '1', unitPrice: '' },
    { key: makeKey(), name: '充电器', qty: '1', unitPrice: '' },
    { key: makeKey(), name: '配件', qty: '1', unitPrice: '' },
    { key: makeKey(), name: '运费', qty: '1', unitPrice: '' },
  ];
}

function rowToItem(row: CalculatorRow): PricePlanItem {
  const qty = Number(row.qty);
  const unitPrice = Number(row.unitPrice);
  const safeQty = Number.isFinite(qty) && qty >= 0 ? qty : 0;
  const safeUnit = Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0;
  return { name: row.name.trim(), qty: safeQty, unitPrice: safeUnit, amount: planItemAmount(safeQty, safeUnit) };
}

function formatMoney(value: number): string {
  return `¥${value.toFixed(2)}`;
}

function formatTime(iso: string): string {
  return iso ? iso.replace('T', ' ').slice(5, 16) : '';
}

export interface PriceCalculatorModalProps {
  open: boolean;
  product?: ProductRecord;
  onClose: () => void;
}

/**
 * 产品售价计算器：左侧成本明细实时试算（选中包装/配件自动带价），右侧本产品已存的算价方案。
 * 保存即新增一条历史（不覆盖）；删除要二次确认。
 */
export default function PriceCalculatorModal({ open, product, onClose }: PriceCalculatorModalProps) {
  const [rows, setRows] = useState<CalculatorRow[]>([]);
  const [markup, setMarkup] = useState(rememberedMarkup);
  const [targetPrice, setTargetPrice] = useState('');
  const [planName, setPlanName] = useState('');
  const [plans, setPlans] = useState<PricePlanRecord[]>([]);
  const [sharedAccessories, setSharedAccessories] = useState<AccessoryPrice[]>([]);
  const [pickerRow, setPickerRow] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open || !product) return;
    let cancelled = false;
    setRows(defaultRows(product));
    setMarkup(rememberedMarkup());
    setTargetPrice('');
    setPlanName('');
    setPickerRow(null);
    setMessage('');
    setPlans([]);
    setSharedAccessories([]);
    // 打开时载入：本产品最近一份方案（回显上次算的）+ 全店共用配件清单。
    if (/^\d+$/.test(product.id)) {
      listPricePlans(product.id)
        .then((items) => {
          if (cancelled) return;
          setPlans(items);
          const latest = items[0];
          if (latest) {
            setRows(latest.items.map((item) => ({ key: makeKey(), name: item.name, qty: String(item.qty), unitPrice: String(item.unitPrice) })));
            setMarkup(String(latest.markupPercent));
            setTargetPrice(latest.targetPrice == null ? '' : String(latest.targetPrice));
            setPlanName(latest.name);
          }
        })
        .catch(() => { if (!cancelled) setMessage('算价方案加载失败'); });
    }
    getAccessoryPrices()
      .then((items) => { if (!cancelled) setSharedAccessories(items); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, product]);

  if (!open || !product) return null;

  const items = rows.map(rowToItem).filter((item) => item.name);
  const totalCost = planTotalCost(items);
  const markupValue = Number(markup);
  const salePrice = planSalePrice(totalCost, Number.isFinite(markupValue) && markupValue >= 0 ? markupValue : 0);
  const targetValue = targetPrice.trim() === '' ? null : Number(targetPrice);
  const margin = targetValue != null && Number.isFinite(targetValue) ? planMargin(targetValue, totalCost) : planMargin(salePrice, totalCost);

  const updateRow = (key: string, patch: Partial<CalculatorRow>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const pickIntoRow = (key: string, name: string, unitPrice: string) => {
    updateRow(key, { name, unitPrice });
    setPickerRow(null);
  };

  const save = async () => {
    if (!items.length) {
      setMessage('至少需要一行有名称的成本明细');
      return;
    }
    setBusy(true);
    try {
      const parsedMarkup = Number(markup);
      const saved = await savePricePlan(product.id, {
        name: planName,
        markupPercent: Number.isFinite(parsedMarkup) ? parsedMarkup : 0,
        targetPrice: targetValue != null && Number.isFinite(targetValue) ? targetValue : null,
        items: items.map((item) => ({ name: item.name, qty: item.qty, unitPrice: item.unitPrice })),
      });
      try { localStorage.setItem(MARKUP_MEMORY_KEY, String(Number.isFinite(parsedMarkup) ? parsedMarkup : 0)); } catch { /* 记住加价率失败不影响保存 */ }
      setPlans((current) => [saved, ...current]);
      setPlanName(saved.name);
      setMessage(`已保存方案「${saved.name || formatTime(saved.createdAt)}」`);
    } catch (error) {
      setMessage((error as { message?: string })?.message ?? '保存失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const loadPlan = (plan: PricePlanRecord) => {
    setRows(plan.items.map((item) => ({ key: makeKey(), name: item.name, qty: String(item.qty), unitPrice: String(item.unitPrice) })));
    setMarkup(String(plan.markupPercent));
    setTargetPrice(plan.targetPrice == null ? '' : String(plan.targetPrice));
    setPlanName(plan.name);
    setMessage(`已载入「${plan.name || formatTime(plan.createdAt)}」`);
  };

  const removePlan = async (plan: PricePlanRecord) => {
    if (!window.confirm(`确定删除方案「${plan.name || formatTime(plan.createdAt)}」吗？删掉后无法恢复。`)) return;
    setBusy(true);
    try {
      await deletePricePlan(product.id, plan.id);
      setPlans((current) => current.filter((item) => item.id !== plan.id));
      setMessage('方案已删除');
    } catch (error) {
      setMessage((error as { message?: string })?.message ?? '删除失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const packagingOptions = product.packaging.filter((item) => item.name.trim());
  const ownAccessories = (product.accessoryPrices ?? []).filter((item) => item.name.trim());

  return <Modal open={open} title={`售价计算 · ${product.name || product.sku || '产品'}`} onClose={onClose} width={980}>
    <div className="price-calc">
      <div className="price-calc-left">
        <div className="price-calc-head"><span>成本明细</span><span>数量</span><span>单价</span><span>金额</span><span /></div>
        {rows.map((row, index) => {
          const item = rowToItem(row);
          return <div className="price-calc-row-block" key={row.key}>
            <div className="price-calc-row">
              <div className="price-calc-name">
                <input className="input" aria-label={`成本${index + 1}名称`} value={row.name} placeholder="成本项名称" onChange={(event) => updateRow(row.key, { name: event.target.value })} />
                <button
                  className="icon-button"
                  type="button"
                  title="从包装方式 / 配件价格选择并自动带价"
                  aria-label={`为第 ${index + 1} 行选择包装或配件`}
                  aria-expanded={pickerRow === row.key}
                  onClick={() => setPickerRow((current) => (current === row.key ? null : row.key))}
                ><ChevronDown size={14} /></button>
              </div>
              <input className="input" type="number" min={0} aria-label={`成本${index + 1}数量`} value={row.qty} onChange={(event) => updateRow(row.key, { qty: event.target.value })} />
              <input className="input" type="number" min={0} step="0.01" aria-label={`成本${index + 1}单价`} value={row.unitPrice} placeholder="元" onChange={(event) => updateRow(row.key, { unitPrice: event.target.value })} />
              <span className="price-calc-amount">{formatMoney(item.amount)}</span>
              <button className="icon-button danger" type="button" title="删除这一行" aria-label={`删除第 ${index + 1} 行成本`} onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}><Trash2 size={14} /></button>
            </div>
            {pickerRow === row.key && <div className="price-calc-picker">
              {packagingOptions.length > 0 && <>
                <span className="price-calc-picker-label">包装方式</span>
                {packagingOptions.map((option) => <button
                  key={`pack-${option.id}`}
                  className="price-calc-picker-item"
                  type="button"
                  onClick={() => pickIntoRow(row.key, option.name.trim(), option.purchasePrice)}
                >{option.name.trim()}<em>{option.purchasePrice.trim() ? `¥${option.purchasePrice}` : '未填采购价'}</em></button>)}
              </>}
              {(sharedAccessories.length > 0 || ownAccessories.length > 0) && <>
                <span className="price-calc-picker-label">配件与价格</span>
                {sharedAccessories.map((option) => <button
                  key={`shared-${option.id}`}
                  className="price-calc-picker-item"
                  type="button"
                  onClick={() => pickIntoRow(row.key, option.name, String(option.price))}
                >{option.name}<em>共用 · ¥{option.price.toFixed(2)}</em></button>)}
                {ownAccessories.map((option) => <button
                  key={`own-${option.id}`}
                  className="price-calc-picker-item"
                  type="button"
                  onClick={() => pickIntoRow(row.key, option.name.trim(), option.price)}
                >{option.name.trim()}<em>本产品 · ¥{Number(option.price || 0).toFixed(2)}</em></button>)}
              </>}
              {!packagingOptions.length && !sharedAccessories.length && !ownAccessories.length && <span className="price-calc-picker-empty">还没有可选的包装与配件价格：产品里填「包装采购价」，设置页或产品里填「配件与价格」。</span>}
            </div>}
          </div>;
        })}
        <button className="button button-secondary button-sm price-calc-add" type="button" onClick={() => setRows((current) => [...current, { key: makeKey(), name: '', qty: '1', unitPrice: '' }])}><Plus size={14} />添加成本项</button>

        <div className="price-calc-summary">
          <div className="price-calc-summary-line"><span>成本合计</span><strong data-testid="price-calc-total">{formatMoney(totalCost)}</strong></div>
          <div className="price-calc-summary-line"><span>加价率 <input className="input price-calc-markup" type="number" min={0} aria-label="加价率" value={markup} onChange={(event) => setMarkup(event.target.value)} /> %</span><span>建议售价 <strong data-testid="price-calc-sale">{formatMoney(salePrice)}</strong></span></div>
          <div className="price-calc-summary-line"><span>目标售价 <input className="input price-calc-target" type="number" min={0} step="0.01" aria-label="目标售价" value={targetPrice} placeholder="选填" onChange={(event) => setTargetPrice(event.target.value)} /></span><span data-testid="price-calc-margin">毛利率 {margin == null ? '—' : `${margin.toFixed(1)}%`}</span></div>
        </div>

        <div className="price-calc-save">
          <input className="input" aria-label="方案名" value={planName} placeholder="方案名（如：双电版）" onChange={(event) => setPlanName(event.target.value)} />
          <button className="button button-primary" type="button" disabled={busy} onClick={() => void save()}><Save size={14} />{busy ? '处理中...' : '保存为方案'}</button>
        </div>
        {!!message && <p className="price-calc-message" role="status">{message}</p>}
      </div>

      <div className="price-calc-right">
        <div className="price-calc-plans-head">已存方案<em>{plans.length ? `${plans.length} 份` : ''}</em></div>
        {plans.length ? <div className="price-calc-plans">{plans.map((plan) => <div className="price-calc-plan" key={plan.id}>
          <div className="price-calc-plan-main">
            <strong>{plan.name || formatTime(plan.createdAt)}</strong>
            <span>{formatMoney(plan.salePrice)} · {formatTime(plan.createdAt)}</span>
          </div>
          <div className="price-calc-plan-actions">
            <button className="button button-secondary button-sm" type="button" disabled={busy} onClick={() => loadPlan(plan)}>载入</button>
            <button className="icon-button danger" type="button" title="删除方案" aria-label={`删除方案 ${plan.name || formatTime(plan.createdAt)}`} disabled={busy} onClick={() => void removePlan(plan)}><Trash2 size={14} /></button>
          </div>
        </div>)}</div> : <div className="empty-state">还没有保存过方案。左侧算好后点「保存为方案」，以后打开会自动回显最近一份。</div>}
      </div>
    </div>
  </Modal>;
}
