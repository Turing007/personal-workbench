import { useEffect, useState } from 'react';
import { ChevronDown, Plus, Save, Trash2 } from 'lucide-react';
import Modal from './Modal';
import {
  deletePricePlan,
  getBatteryPriceMatrix,
  getCategoryAccessoryPrices,
  getChargerPrices,
  listPricePlans,
  savePricePlan,
  type PricePlanRecord,
} from '../api';
import type { ProductRecord } from './ProductEditor';
import type { AccessoryPrice } from '../../shared/accessory-prices';
import { batteryMatrixOptions, type BatteryPriceMatrix } from '../../shared/battery-prices';
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

/** 只显示到「几月几日」，不显示几点。 */
function formatDate(iso: string): string {
  const matched = iso.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (!matched) return iso;
  return `${Number(matched[1])}月${Number(matched[2])}日`;
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
  const [batteryMatrix, setBatteryMatrix] = useState<BatteryPriceMatrix | null>(null);
  const [chargerPrices, setChargerPrices] = useState<AccessoryPrice[]>([]);
  const [categoryAccessories, setCategoryAccessories] = useState<AccessoryPrice[]>([]);
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
    setBatteryMatrix(null);
    setChargerPrices([]);
    setCategoryAccessories([]);
    // 打开时载入：本产品最近一份方案（回显上次算的）+ 电池矩阵 + 充电器价格 + 本类目配件。
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
    getBatteryPriceMatrix()
      .then((matrix) => { if (!cancelled) setBatteryMatrix(matrix); })
      .catch(() => {});
    getChargerPrices()
      .then((items) => { if (!cancelled) setChargerPrices(items); })
      .catch(() => {});
    const category = (product.category ?? '').trim();
    if (category) {
      getCategoryAccessoryPrices(category)
        .then((items) => { if (!cancelled) setCategoryAccessories(items); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [open, product]);

  // 选择浮层：点浮层与触发按钮以外的任何地方都关掉。
  useEffect(() => {
    if (!pickerRow) return;
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.price-calc-picker') || target?.closest('[data-picker-toggle]')) return;
      setPickerRow(null);
    };
    document.addEventListener('click', onDocumentClick);
    return () => document.removeEventListener('click', onDocumentClick);
  }, [pickerRow]);

  if (!open || !product) return null;

  const items = rows.map(rowToItem).filter((item) => item.name);
  const totalCost = planTotalCost(items);
  const markupValue = Number(markup);
  const salePrice = planSalePrice(totalCost, Number.isFinite(markupValue) && markupValue >= 0 ? markupValue : 0);
  const targetValue = targetPrice.trim() === '' ? null : Number(targetPrice);
  const margin = targetValue != null && Number.isFinite(targetValue) ? planMargin(targetValue, totalCost) : planMargin(salePrice, totalCost);
  // 毛利按「当前采用的那档售价」算：填了目标售价就用目标售价，否则用建议售价。
  const effectivePrice = targetValue != null && Number.isFinite(targetValue) ? targetValue : salePrice;
  const profit = Math.round((effectivePrice - totalCost) * 100) / 100;
  const profitText = profit < 0 ? `-¥${Math.abs(profit).toFixed(2)}` : formatMoney(profit);

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
      setMessage(`已保存方案「${saved.name || formatDate(saved.createdAt)}」`);
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
    setMessage(`已载入「${plan.name || formatDate(plan.createdAt)}」`);
  };

  const removePlan = async (plan: PricePlanRecord) => {
    if (!window.confirm(`确定删除方案「${plan.name || formatDate(plan.createdAt)}」吗？删掉后无法恢复。`)) return;
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
  const productCategory = (product.category ?? '').trim();
  const batteryOptions = batteryMatrix ? batteryMatrixOptions(batteryMatrix) : [];
  const chargerOptions = chargerPrices.filter((item) => item.name.trim());

  /**
   * 每行只出和它相关的来源：包装行只出包装方式、电池行只出电池价、充电器行只出充电器价，
   * 其余行出本类目配件；产品成本/运费这类不需要选的没有下拉。
   */
  const rowOptions = (name: string): Array<{ key: string; name: string; price: string; priceText: string; source: string }> => {
    const text = name.trim();
    if (!text || text.includes('成本') || text.includes('运费')) return [];
    if (text.includes('包装') || packagingOptions.some((item) => text.includes(item.name.trim()))) {
      return packagingOptions.map((item) => ({ key: `pack-${item.id}`, name: item.name.trim(), price: item.purchasePrice, priceText: item.purchasePrice.trim() ? `¥${item.purchasePrice}` : '未填采购价', source: '包装方式' }));
    }
    if (text.includes('电池')) {
      return batteryOptions.map((item) => ({ key: `battery-${item.id}`, name: item.name, price: String(item.price), priceText: `¥${item.price.toFixed(2)}`, source: '电池价格' }));
    }
    if (text.includes('充电')) {
      return chargerOptions.map((item) => ({ key: `charger-${item.id}`, name: item.name, price: String(item.price), priceText: `¥${item.price.toFixed(2)}`, source: '充电器价格' }));
    }
    return categoryAccessories.map((item) => ({ key: `category-${item.id}`, name: item.name, price: String(item.price), priceText: `¥${item.price.toFixed(2)}`, source: `本类目配件${productCategory ? `（${productCategory}）` : ''}` }));
  };

  return <Modal open={open} title={`售价计算 · ${product.name || product.sku || '产品'}`} onClose={onClose} width={980}>
    <div className="price-calc">
      <div className="price-calc-left">
        <div className="price-calc-head"><span>成本明细</span><span>数量</span><span>单价</span><span>金额</span><span /></div>
        {rows.map((row, index) => {
          const item = rowToItem(row);
          const options = rowOptions(row.name);
          const pickerOpen = pickerRow === row.key && options.length > 0;
          return <div className="price-calc-row-block" key={row.key}>
            <div className="price-calc-row">
              <div className="price-calc-name">
                <input className="input" aria-label={`成本${index + 1}名称`} value={row.name} placeholder="成本项名称" onChange={(event) => updateRow(row.key, { name: event.target.value })} />
                {options.length > 0 && <button
                  className="icon-button"
                  type="button"
                  data-picker-toggle="true"
                  title={`从${options[0].source}选择并自动带价`}
                  aria-label={`为第 ${index + 1} 行选择${options[0].source}`}
                  aria-expanded={pickerOpen}
                  onClick={() => setPickerRow((current) => (current === row.key ? null : row.key))}
                ><ChevronDown size={14} /></button>}
              </div>
              <input className="input" type="number" min={0} aria-label={`成本${index + 1}数量`} value={row.qty} onChange={(event) => updateRow(row.key, { qty: event.target.value })} />
              <input className="input" type="number" min={0} step="0.01" aria-label={`成本${index + 1}单价`} value={row.unitPrice} placeholder="元" onChange={(event) => updateRow(row.key, { unitPrice: event.target.value })} />
              <span className="price-calc-amount">{formatMoney(item.amount)}</span>
              <button className="icon-button danger" type="button" title="删除这一行" aria-label={`删除第 ${index + 1} 行成本`} onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}><Trash2 size={14} /></button>
            </div>
            {pickerOpen && <div className="price-calc-picker">
              <span className="price-calc-picker-label">{options[0].source}</span>
              {options.map((option) => <button
                key={option.key}
                className="price-calc-picker-item"
                type="button"
                onClick={() => pickIntoRow(row.key, option.name, option.price)}
              >{option.name}<em>{option.priceText}</em></button>)}
            </div>}
          </div>;
        })}
        <button className="button button-secondary button-sm price-calc-add" type="button" onClick={() => setRows((current) => [...current, { key: makeKey(), name: '', qty: '1', unitPrice: '' }])}><Plus size={14} />添加成本项</button>

        <div className="price-calc-summary">
          <div className="price-calc-summary-line"><span>成本合计</span><strong data-testid="price-calc-total">{formatMoney(totalCost)}</strong></div>
          <div className="price-calc-summary-line"><span>加价率 <input className="input price-calc-markup" type="number" min={0} aria-label="加价率" value={markup} onChange={(event) => setMarkup(event.target.value)} /> %</span><span>建议售价 <strong data-testid="price-calc-sale">{formatMoney(salePrice)}</strong></span></div>
          <div className="price-calc-summary-line"><span>目标售价 <input className="input price-calc-target" type="number" min={0} step="0.01" aria-label="目标售价" value={targetPrice} placeholder="选填" onChange={(event) => setTargetPrice(event.target.value)} /></span><span data-testid="price-calc-margin">毛利率 {margin == null ? '—' : `${margin.toFixed(1)}%`}</span></div>
          <div className="price-calc-summary-line price-calc-summary-profit"><span>毛利</span><strong data-testid="price-calc-profit">{profitText}</strong></div>
        </div>

        <div className="price-calc-save">
          <input className="input" aria-label="方案名" value={planName} placeholder="方案名（如：双电版）" onChange={(event) => setPlanName(event.target.value)} />
          <button className="button button-primary" type="button" disabled={busy} onClick={() => void save()}><Save size={14} />{busy ? '处理中...' : '保存为方案'}</button>
        </div>
        {!!message && <p className="price-calc-message" role="status">{message}</p>}
      </div>

      <div className="price-calc-right">
        <div className="price-calc-plans-head">已存方案<em>{plans.length ? `${plans.length} 份` : ''}</em></div>
        {plans.length ? <div className="price-calc-plans">{plans.map((plan) => {
          const planProfit = Math.round((plan.salePrice - plan.totalCost) * 100) / 100;
          return <div className="price-calc-plan" key={plan.id}>
          <div className="price-calc-plan-main">
            <strong>{plan.name || formatDate(plan.createdAt)}</strong>
            <span>售价 {formatMoney(plan.salePrice)} · 毛利 {planProfit < 0 ? `-¥${Math.abs(planProfit).toFixed(2)}` : formatMoney(planProfit)}</span>
            {plan.name ? <span className="price-calc-plan-date">{formatDate(plan.createdAt)}</span> : null}
          </div>
          <div className="price-calc-plan-actions">
            <button className="button button-secondary button-sm" type="button" disabled={busy} onClick={() => loadPlan(plan)}>载入</button>
            <button className="icon-button danger" type="button" title="删除方案" aria-label={`删除方案 ${plan.name || formatDate(plan.createdAt)}`} disabled={busy} onClick={() => void removePlan(plan)}><Trash2 size={14} /></button>
          </div>
        </div>; })}</div> : <div className="empty-state">还没有保存过方案。左侧算好后点「保存为方案」，以后打开会自动回显最近一份。</div>}
      </div>
    </div>
  </Modal>;
}
