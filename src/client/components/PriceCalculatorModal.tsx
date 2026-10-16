import { Fragment, useEffect, useState } from 'react';
import { Check, Eye, EyeOff, Image as ImageIcon, Save, Trash2 } from 'lucide-react';
import Modal from './Modal';
import {
  deletePricePlan,
  getBatteryPriceMatrix,
  getChargerPrices,
  listPricePlans,
  savePricePlan,
  type PricePlanRecord,
} from '../api';
import { copyText } from '../copy-text';
import { thumbUrl } from '../image-urls';
import type { ProductRecord } from './ProductEditor';
import type { AccessoryPrice } from '../../shared/accessory-prices';
import { BATTERY_COMBO_VARIANTS, batteryUnitPriceOf, type BatteryPriceMatrix } from '../../shared/battery-prices';
import {
  autoShippingCost,
  batteryComboName,
  comboShippingWeightKg,
  comboTotalCost,
  DEFAULT_SHIPPING_UNIT_PRICE,
  planSalePrice,
  round2,
  type PricePlanParams,
  type PriceShippingMode,
} from '../../shared/price-calculator';

import { rememberedMarkup, rememberMarkup, rememberedShippingUnitPrice, rememberShippingUnitPrice } from '../price-calc-memory';

/** 价格显示口径：四舍五入到 0.5，最多一位小数（100 / 126.5 / 130）。 */
function roundHalf(value: number): number {
  return Math.round(value * 2 + 1e-6) / 2;
}

function formatHalf(value: number): string {
  const rounded = roundHalf(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatMoney(value: number): string {
  return `¥${formatHalf(value)}`;
}

/** 只显示到「几月几日」，不显示几点。 */
function formatDate(iso: string): string {
  const matched = iso.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (!matched) return iso;
  return `${Number(matched[1])}月${Number(matched[2])}日`;
}

/** 输入框里的数字：空/非法/负号一律按 0（成本不可能为负）。 */
function amountInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export interface PriceCalculatorModalProps {
  open: boolean;
  product?: ProductRecord;
  onClose: () => void;
}

/**
 * 产品售价计算器（矩阵口径）：左边填采购价/毛利率/包材配件/运费/税并选充电器，
 * 右边按「电池容量 × 节数 × 一电一充/两电一充」整表出成本与售价；
 * 点任意售价即复制「5节1300mah 一电一充 138.12元」，可直接发给客户。
 * 顶部有产品图与名称；「小眼睛」一键隐藏全部成本（含参数、成本列、毛利与方案区），
 * 留在屏幕上的是干净的价格表，方便直接截图发客户。默认每次打开都显示成本。
 * 下方保存方案（记下参数快照，可载入回显）；保存即新增一条历史，不覆盖。
 */
export default function PriceCalculatorModal({ open, product, onClose }: PriceCalculatorModalProps) {
  const [baseCost, setBaseCost] = useState('');
  const [packaging, setPackaging] = useState('0');
  const [shipping, setShipping] = useState('0');
  const [shippingMode, setShippingMode] = useState<PriceShippingMode>('auto');
  const [shippingUnitPrice, setShippingUnitPrice] = useState(String(DEFAULT_SHIPPING_UNIT_PRICE));
  const [taxPercent, setTaxPercent] = useState('0');
  const [markup, setMarkup] = useState(rememberedMarkup);
  const [chargerId, setChargerId] = useState('');
  const [chargerPrices, setChargerPrices] = useState<AccessoryPrice[]>([]);
  const [batteryMatrix, setBatteryMatrix] = useState<BatteryPriceMatrix | null>(null);
  const [plans, setPlans] = useState<PricePlanRecord[]>([]);
  const [planName, setPlanName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [copiedKey, setCopiedKey] = useState('');
  const [costsVisible, setCostsVisible] = useState(true);

  useEffect(() => {
    if (!open || !product) return;
    let cancelled = false;
    // 采购价：默认档报价 → 镜像列兜底；包材配件：第一条包装的采购价。
    const quotes = product.purchaseQuotes ?? [];
    const defaultQuote = quotes.find((quote) => quote.isDefault) ?? quotes[0];
    setBaseCost((defaultQuote?.price ?? '').trim() || product.purchasePrice || '0');
    setPackaging(product.packaging[0]?.purchasePrice?.trim() || '0');
    setShipping('0');
    // 每次打开回到自动预估：这是默认口径，手动是临时覆盖。
    setShippingMode('auto');
    setShippingUnitPrice(rememberedShippingUnitPrice());
    setTaxPercent('0');
    setMarkup(rememberedMarkup());
    setPlanName('');
    setMessage('');
    setCopiedKey('');
    setCostsVisible(true);
    setPlans([]);
    setBatteryMatrix(null);
    setChargerPrices([]);
    setChargerId('');
    if (/^\d+$/.test(product.id)) {
      listPricePlans(product.id)
        .then((items) => { if (!cancelled) setPlans(items); })
        .catch(() => { if (!cancelled) setMessage('方案加载失败'); });
    }
    getBatteryPriceMatrix()
      .then((matrix) => { if (!cancelled) setBatteryMatrix(matrix); })
      .catch(() => {});
    getChargerPrices()
      .then((items) => {
        if (cancelled) return;
        setChargerPrices(items);
        setChargerId(items[0]?.id ?? '');
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, product]);

  if (!open || !product) return null;

  const image = product.images[0];
  const base = amountInput(baseCost);
  const pack = amountInput(packaging);
  const tax = amountInput(taxPercent);
  const markupValue = amountInput(markup);
  const charger = chargerPrices.find((item) => item.id === chargerId);
  const chargerPrice = charger?.price ?? 0;

  // 产品重量取包装第一行的内盒重量（单台重量，与矩阵每台成本口径一致）。
  const productWeightKg = Number(product.packaging[0]?.innerWeight) || 0;
  const weightMissing = productWeightKg <= 0;
  const unitPriceValue = amountInput(shippingUnitPrice);
  const autoMode = shippingMode === 'auto';
  // 自动模式下运费按重量现算；手动模式用输入框里的固定值。
  const manualShip = amountInput(shipping);

  /** 某格组合的运费：自动按「(产品重量 + 电池×电数 + 充电器) × 单价」，手动全体同值。 */
  const shippingFor = (batteryPackCount?: number, batteryCount?: number, hasCharger?: boolean) => {
    if (!autoMode) return manualShip;
    const weight = comboShippingWeightKg({ productWeightKg, batteryPackCount, batteryCount, hasCharger });
    return autoShippingCost(weight, unitPriceValue);
  };

  const bareShip = shippingFor();
  const bareWeight = comboShippingWeightKg({ productWeightKg });
  const bareCost = comboTotalCost({ baseCost: base, packaging: pack, shipping: bareShip, taxPercent: tax });
  const bareSale = planSalePrice(bareCost, markupValue);

  const capacities = batteryMatrix?.capacities ?? [];
  // 列 = 每个节数 × 两种成套口径；顺序跟随设置里的节数顺序。
  const combos = batteryMatrix
    ? batteryMatrix.packCounts.flatMap((packCount) => BATTERY_COMBO_VARIANTS.map((variant) => ({ packCount, batteryCount: variant.batteryCount, label: variant.label })))
    : [];

  const copySalePrice = async (text: string, key: string) => {
    const ok = await copyText(text);
    setMessage(ok ? `已复制：${text}` : '复制失败，请手动选中复制');
    setCopiedKey(ok ? key : '');
    if (ok) window.setTimeout(() => setCopiedKey((current) => (current === key ? '' : current)), 1600);
  };

  /** 一格组合的成本/售价：矩阵里该单元格没定价时返回 null（显示 —）。 */
  const comboValues = (capacity: number, packCount: number, batteryCount: number) => {
    const unit = batteryUnitPriceOf(batteryMatrix!, capacity, packCount);
    if (unit == null) return null;
    const cost = comboTotalCost({
      baseCost: base, packaging: pack, taxPercent: tax,
      shipping: shippingFor(packCount, batteryCount, true),
      batteryUnitPrice: unit, batteryCount, chargerPrice,
    });
    return { cost, sale: planSalePrice(cost, markupValue) };
  };

  /** 切到手动：先把当前自动值填进去，避免切过去变 0 让人以为算错。 */
  const switchToManual = () => {
    setShipping(String(bareShip));
    setShippingMode('manual');
  };

  const save = async () => {
    if (!/^\d+$/.test(product.id) || busy) return;
    setBusy(true);
    try {
      rememberMarkup(String(markupValue));
      // 明细按裸机成本拆四条（税用残差，保证与服务端重算的合计完全一致）；参数快照供载入回显。
      const taxAmount = round2(bareCost - base - pack - bareShip);
      const params: PricePlanParams = {
        baseCost: base, packaging: pack, shipping: bareShip, taxPercent: tax,
        chargerName: charger?.name ?? '', chargerPrice,
        shippingMode, shippingUnitPrice: unitPriceValue,
      };
      const plan = await savePricePlan(product.id, {
        name: planName,
        markupPercent: markupValue,
        targetPrice: null,
        items: [
          { name: '采购价', qty: 1, unitPrice: base },
          { name: '包材配件', qty: 1, unitPrice: pack },
          { name: '运费', qty: 1, unitPrice: bareShip },
          { name: '税', qty: 1, unitPrice: taxAmount },
        ],
        params,
      });
      setPlans((current) => [plan, ...current]);
      setPlanName('');
      setMessage(`已保存方案「${plan.name || formatDate(plan.createdAt)}」`);
    } catch (error) {
      setMessage((error as { message?: string })?.message ?? '方案保存失败');
    } finally {
      setBusy(false);
    }
  };

  const loadPlan = (plan: PricePlanRecord) => {
    const params = plan.params;
    if (params) {
      setBaseCost(String(params.baseCost));
      setPackaging(String(params.packaging));
      setShipping(String(params.shipping));
      setShippingMode(params.shippingMode);
      setShippingUnitPrice(String(params.shippingUnitPrice));
      setTaxPercent(String(params.taxPercent));
      const matched = chargerPrices.find((item) => item.name === params.chargerName);
      if (matched) setChargerId(matched.id);
      setMessage('');
    } else {
      // 旧格式方案（没存参数）：按明细里能认出来的行尽量回显。
      const byName = new Map(plan.items.map((item) => [item.name, item.unitPrice]));
      setBaseCost(String(byName.get('产品成本') ?? base));
      setPackaging(String(byName.get('包装') ?? 0));
      setShipping(String(byName.get('运费') ?? 0));
      setMessage('旧方案只回显了采购价等部分参数');
    }
    setMarkup(String(plan.markupPercent));
    setPlanName(plan.name);
  };

  const removePlan = async (plan: PricePlanRecord) => {
    const label = plan.name || formatDate(plan.createdAt);
    if (!window.confirm(`确定删除方案「${label}」吗？删除后不能恢复。`)) return;
    setBusy(true);
    try {
      await deletePricePlan(product.id, plan.id);
      setPlans((current) => current.filter((item) => item.id !== plan.id));
      setMessage(`已删除方案「${label}」`);
    } catch (error) {
      setMessage((error as { message?: string })?.message ?? '方案删除失败');
    } finally {
      setBusy(false);
    }
  };

  return <Modal open={open} title={`售价计算 · ${product.name || product.sku || '产品'}`} onClose={onClose} width={1100}>
    {/* 产品图 + 名称：截图发客户时一眼看清是哪个产品；右侧小眼睛隐藏全部成本。 */}
    <div className="price-calc2-head">
      {image
        ? <img className="price-calc2-thumb" src={thumbUrl(image.url, 240)} alt="" loading="lazy" decoding="async" />
        : <span className="price-calc2-thumb is-empty" aria-hidden="true"><ImageIcon size={18} /></span>}
      <span className="price-calc2-title">
        <strong>{product.name || product.sku || '未命名产品'}</strong>
        <em>{[product.sku, (product.category ?? '').trim()].filter(Boolean).join(' · ')}</em>
      </span>
      <button
        className="icon-button price-calc2-eye"
        type="button"
        aria-pressed={!costsVisible}
        aria-label={costsVisible ? '隐藏成本（发客户截图用）' : '显示成本'}
        title={costsVisible ? '隐藏成本（发客户截图用）' : '显示成本'}
        onClick={() => setCostsVisible((current) => !current)}
      >{costsVisible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
    </div>
    <div className="price-calc2">
      <div className="price-calc2-params">
        {costsVisible && <>
        <label className="price-calc2-field"><span>采购价</span><input className="input" type="number" min={0} step="0.01" aria-label="采购价" value={baseCost} onChange={(event) => setBaseCost(event.target.value)} /></label>
        <label className="price-calc2-field"><span>毛利率 %</span><input className="input" type="number" min={0} aria-label="毛利率" value={markup} onChange={(event) => setMarkup(event.target.value)} /></label>
        <label className="price-calc2-field"><span>包材配件</span><input className="input" type="number" min={0} step="0.01" aria-label="包材配件" value={packaging} onChange={(event) => setPackaging(event.target.value)} /></label>
        {/* 运费：自动按「计费重量 × 单价」预估，手动则手填固定值。单价放运费前面。 */}
        <label className="price-calc2-field"><span>运费单价 /kg</span><input className="input" type="number" min={0} step="0.01" aria-label="运费单价" value={shippingUnitPrice} disabled={!autoMode} onChange={(event) => { setShippingUnitPrice(event.target.value); rememberShippingUnitPrice(event.target.value); }} /></label>
        {/* 当前是自动还是手动由下方两个按钮显示，这里不再重复标「自动」。 */}
        <label className="price-calc2-field"><span>运费</span><input className="input" type="number" min={0} step="0.01" aria-label="运费金额" value={autoMode ? String(bareShip) : shipping} readOnly={autoMode} onChange={(event) => setShipping(event.target.value)} /></label>
        <div className="price-calc2-shipmode">
          <button type="button" className={autoMode ? 'is-on' : ''} aria-pressed={autoMode} onClick={() => setShippingMode('auto')}>自动</button>
          <button type="button" className={!autoMode ? 'is-on' : ''} aria-pressed={!autoMode} onClick={switchToManual}>手动</button>
          {autoMode && <span className="price-calc2-shiphint">裸机 {bareWeight}kg{weightMissing ? '（未填重量）' : ''}</span>}
        </div>
        {autoMode && weightMissing && <p className="price-calc2-warn" role="status">该产品包装第一行没填内盒重量，产品部分按 0 算（电池与充电器重量照常计）；去产品库补重量或切手动。</p>}
        <label className="price-calc2-field"><span>税 %</span><input className="input" type="number" min={0} step="0.01" aria-label="税" value={taxPercent} onChange={(event) => setTaxPercent(event.target.value)} /></label>
        <label className="price-calc2-field"><span>充电器</span>
          <select className="toolbar-select price-calc2-charger" aria-label="充电器" value={chargerId} disabled={!chargerPrices.length} onChange={(event) => setChargerId(event.target.value)}>
            {chargerPrices.map((item) => <option key={item.id} value={item.id}>{item.name} ¥{formatHalf(item.price)}</option>)}
            {!chargerPrices.length && <option value="">无（去设置里添加）</option>}
          </select>
        </label>
        </>}
        <div className="price-calc2-bare">
          <span className="price-calc2-bare-title">裸机</span>
          {costsVisible && <span>成本 <strong>{formatMoney(bareCost)}</strong></span>}
          <button
            className={`price-calc2-sale${copiedKey === 'bare' ? ' is-copied' : ''}`}
            type="button"
            title="点击复制售价"
            aria-label={`复制裸机售价 ${formatHalf(bareSale)}元`}
            onClick={() => void copySalePrice(`裸机 ${formatHalf(bareSale)}元`, 'bare')}
          >{copiedKey === 'bare' ? <Check size={13} /> : null}售价 {formatMoney(bareSale)}</button>
          {costsVisible && <span className="price-calc2-bare-profit">毛利 {formatMoney(round2(bareSale - bareCost))}</span>}
        </div>
      </div>

      <div className="price-calc2-matrix">
        {!batteryMatrix && <div className="table-state">正在加载电池价格…</div>}
        {batteryMatrix && !capacities.length && <div className="table-state">电池价格矩阵还是空的：去「设置 → 配件价格」加容量与节数。</div>}
        {batteryMatrix && !!capacities.length && <div className="price-calc2-scroll">
          <table className="battery-price-table">
            <thead>
              <tr>
                <th className="battery-price-corner" rowSpan={2}>电池容量</th>
                {combos.map((combo) => <th key={`${combo.packCount}-${combo.batteryCount}`} className="battery-price-group-start" colSpan={costsVisible ? 3 : 1}>{combo.packCount}节{combo.label}</th>)}
              </tr>
              {/* 每组首列打 group-start 标记（隐藏成本时首列是售价），CSS 据此画组分隔线。 */}
              <tr>{combos.map((combo) => <Fragment key={`${combo.packCount}-${combo.batteryCount}`}>{costsVisible
                ? <><th className="battery-price-mini battery-price-group-start">成本</th><th className="battery-price-mini">售价</th><th className="battery-price-mini">毛利</th></>
                : <th className="battery-price-mini battery-price-group-start">售价</th>}</Fragment>)}</tr>
            </thead>
            <tbody>
              {capacities.map((capacity) => <tr key={capacity}>
                <td className="battery-price-capacity">{capacity}mAh</td>
                {combos.map((combo) => {
                  const values = comboValues(capacity, combo.packCount, combo.batteryCount);
                  const key = `${combo.packCount}-${combo.batteryCount}-${capacity}`;
                  const copyName = batteryComboName(combo.packCount, capacity, combo.label);
                  const groupStart = ' battery-price-group-start';
                  return <Fragment key={key}>
                    {costsVisible && <td className={`battery-price-cost${groupStart}`}>{values ? formatHalf(values.cost) : '—'}</td>}
                    <td className={costsVisible ? 'battery-price-sale-cell' : `battery-price-sale-cell${groupStart}`}>{values
                      ? <button
                        className={`price-calc2-sale${copiedKey === key ? ' is-copied' : ''}`}
                        type="button"
                        title="点击复制售价（自带名称）"
                        aria-label={`复制售价 ${copyName} ${formatHalf(values.sale)}元`}
                        onClick={() => void copySalePrice(`${copyName} ${formatHalf(values.sale)}元`, key)}
                      >{copiedKey === key ? <Check size={13} /> : null}{formatHalf(values.sale)}</button>
                      : '—'}</td>
                    {costsVisible && <td className="battery-price-profit">{values ? formatHalf(round2(values.sale - values.cost)) : '—'}</td>}
                  </Fragment>;
                })}
              </tr>)}
            </tbody>
          </table>
        </div>}
      </div>
    </div>

    {costsVisible && <div className="price-calc2-save">
      <input className="input" aria-label="方案名" value={planName} placeholder="方案名（如：10 节两电一充）" onChange={(event) => setPlanName(event.target.value)} />
      <button className="button button-primary" type="button" disabled={busy} onClick={() => void save()}><Save size={14} />{busy ? '处理中...' : '保存为方案'}</button>
    </div>}
    {!!message && <p className="price-calc-message" role="status">{message}</p>}

    {costsVisible && <div className="price-calc2-plans">
      <div className="price-calc-plans-head">已存方案<em>{plans.length ? `${plans.length} 份` : ''}</em></div>
      {plans.length ? <div className="price-calc-plans">{plans.map((plan) => {
        const planProfit = round2(plan.salePrice - plan.totalCost);
        return <div className="price-calc-plan" key={plan.id}>
          <div className="price-calc-plan-main">
            <strong>{plan.name || formatDate(plan.createdAt)}</strong>
            <span>裸机 {formatMoney(plan.salePrice)} · 毛利 {formatMoney(planProfit)}</span>
            {plan.name ? <span className="price-calc-plan-date">{formatDate(plan.createdAt)}</span> : null}
          </div>
          <div className="price-calc-plan-actions">
            <button className="button button-secondary button-sm" type="button" disabled={busy} onClick={() => loadPlan(plan)}>载入</button>
            <button className="icon-button danger" type="button" title="删除方案" aria-label={`删除方案 ${plan.name || formatDate(plan.createdAt)}`} disabled={busy} onClick={() => void removePlan(plan)}><Trash2 size={14} /></button>
          </div>
        </div>;
      })}</div> : <div className="empty-state">还没有保存过方案。上面算好后点「保存为方案」。</div>}
    </div>}
  </Modal>;
}
