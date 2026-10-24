import { Fragment, useEffect, useState } from 'react';
import { BatteryCharging, Check, Eye, EyeOff, Image as ImageIcon, Save, Trash2 } from 'lucide-react';
import Modal from './Modal';
import {
  deletePricePlan,
  getBatteryPriceMatrix,
  getCategoryAccessoryPrices,
  getChargerPrices,
  getVolumeDivisor,
  listPricePlans,
  savePricePlan,
  saveVolumeDivisor,
  type PricePlanRecord,
} from '../api';
import { copyText } from '../copy-text';
import { thumbUrl } from '../image-urls';
import type { ProductRecord } from './ProductEditor';
import { accessoryTotals, type AccessoryPrice } from '../../shared/accessory-prices';
import { BATTERY_COMBO_VARIANTS, batteryCellPrice, batteryMatrixVisible, batteryUnitPriceOf, type BatteryPriceMatrix } from '../../shared/battery-prices';
import {
  autoShippingCost,
  batteryComboName,
  chargeableWeightKg,
  comboShippingWeightKg,
  comboTotalCost,
  DEFAULT_SHIPPING_UNIT_PRICE,
  DEFAULT_VOLUME_DIVISOR,
  normalizeVolumeDivisor,
  parsePackagingVolumeCm3,
  planSalePrice,
  priceInclusionLabel,
  round2,
  VOLUME_DIVISOR_MAX,
  VOLUME_DIVISOR_MIN,
  volumetricWeightKg,
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
  /** 电池价格查询浮层：只读展示当前生效的「容量 × 节数 → 单价」。 */
  const [batteryPricesOpen, setBatteryPricesOpen] = useState(false);
  /** 产品没固化配件清单时，与详情一致地沿用类目默认配件。 */
  const [categoryAccessories, setCategoryAccessories] = useState<AccessoryPrice[]>([]);
  /** 体积重参数（cm³/kg）：默认取全局设置，载入方案时按方案快照覆盖。 */
  const [volumeDivisor, setVolumeDivisor] = useState(DEFAULT_VOLUME_DIVISOR);
  /** 点运费金额打开的体积参数弹窗。 */
  const [volumeDialogOpen, setVolumeDialogOpen] = useState(false);
  const [volumeInput, setVolumeInput] = useState(String(DEFAULT_VOLUME_DIVISOR));
  const [volumeBusy, setVolumeBusy] = useState(false);
  const [volumeMessage, setVolumeMessage] = useState('');

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
    setBatteryPricesOpen(false);
    setVolumeDialogOpen(false);
    setVolumeInput(String(DEFAULT_VOLUME_DIVISOR));
    setVolumeMessage('');
    setPlans([]);
    setBatteryMatrix(null);
    setChargerPrices([]);
    setChargerId('');
    setCategoryAccessories([]);
    // 配件与详情同一口径：产品固化过清单（含删空）就以自己为准，否则沿用类目默认。
    if (!product.accessoryPricesCustomized && product.category?.trim()) {
      getCategoryAccessoryPrices(product.category.trim())
        .then((items) => { if (!cancelled) setCategoryAccessories(items); })
        .catch(() => { if (!cancelled) setCategoryAccessories([]); });
    }
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
    getVolumeDivisor()
      .then((divisor) => {
        if (cancelled) return;
        setVolumeDivisor(divisor);
        setVolumeInput(String(divisor));
      })
      .catch(() => { /* 拉不到就用默认 8000 */ });
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

  // 配件与详情同一口径：产品自己的清单优先（含删空），否则用类目默认；价格进成本，重量进实重。
  const accessories = (product.accessoryPricesCustomized ? (product.accessoryPrices ?? []) : categoryAccessories)
    .filter((item) => item.name.trim());
  const accessoryTotalsValue = accessoryTotals(accessories);
  const accessoryPrice = accessoryTotalsValue.price;
  const accessoryWeight = accessoryTotalsValue.weight;

  // 产品重量取包装第一行的内盒重量（单台重量，与矩阵每台成本口径一致）。
  const productWeightKg = Number(product.packaging[0]?.innerWeight) || 0;
  const weightMissing = productWeightKg <= 0;
  const unitPriceValue = amountInput(shippingUnitPrice);
  const autoMode = shippingMode === 'auto';
  // 自动模式下运费按计费重量现算；手动模式用输入框里的固定值。
  const manualShip = amountInput(shipping);

  const packagingRow = product.packaging[0];
  // 体积重按「外箱体积 ÷ 装箱数」折成单台；没填外箱时退回内盒，两者都没有就只按实重。
  const outerVolumeCm3 = parsePackagingVolumeCm3(packagingRow?.outerSize);
  const parcelVolumeCm3 = outerVolumeCm3 ?? parsePackagingVolumeCm3(packagingRow?.innerSize);
  const volumeFromOuter = outerVolumeCm3 != null;
  const unitsPerCarton = Math.max(1, Math.trunc(Number(packagingRow?.packSize) || 1));
  const volumeWeightKg = volumetricWeightKg(parcelVolumeCm3, volumeDivisor, unitsPerCarton);

  /** 某格组合的实重（产品 + 配件 + 电池 × 电数 + 充电器）。 */
  const actualWeightFor = (batteryPackCount?: number, batteryCount?: number, hasCharger?: boolean) => (
    comboShippingWeightKg({ productWeightKg, accessoryWeightKg: accessoryWeight, batteryPackCount, batteryCount, hasCharger })
  );

  /** 某格组合的运费：实重与体积重取较大者 × 单价；手动模式全体同值。 */
  const shippingFor = (batteryPackCount?: number, batteryCount?: number, hasCharger?: boolean) => {
    if (!autoMode) return manualShip;
    const chargeable = chargeableWeightKg(actualWeightFor(batteryPackCount, batteryCount, hasCharger), volumeWeightKg);
    return autoShippingCost(chargeable, unitPriceValue);
  };

  const bareShip = shippingFor();
  const bareActualWeight = actualWeightFor();
  const bareChargeableWeight = chargeableWeightKg(bareActualWeight, volumeWeightKg);
  const bareWeight = bareActualWeight;
  const bareCost = comboTotalCost({ baseCost: base, packaging: pack, shipping: bareShip, taxPercent: tax, accessoryPrice });
  const bareSale = planSalePrice(bareCost, markupValue);

  // 设置里关掉眼睛的行/列对所有产品全局隐藏，不进入计算器。
  const visibleMatrix = batteryMatrix ? batteryMatrixVisible(batteryMatrix) : null;
  const capacities = visibleMatrix?.capacities ?? [];
  // 列 = 每个节数 × 两种成套口径；顺序跟随设置里的节数顺序。
  const combos = visibleMatrix
    ? visibleMatrix.packCounts.flatMap((packCount) => BATTERY_COMBO_VARIANTS.map((variant) => ({ packCount, batteryCount: variant.batteryCount, label: variant.label })))
    : [];

  const copySalePrice = async (text: string, key: string) => {
    const ok = await copyText(text);
    setMessage(ok ? `已复制：${text}` : '复制失败，请手动选中复制');
    setCopiedKey(ok ? key : '');
    if (ok) window.setTimeout(() => setCopiedKey((current) => (current === key ? '' : current)), 1600);
  };

  /** 一格组合的成本/售价：矩阵里该单元格没定价时返回 null（显示 —）。 */
  const comboValues = (capacity: number, packCount: number, batteryCount: number) => {
    const unit = batteryUnitPriceOf(visibleMatrix!, capacity, packCount);
    if (unit == null) return null;
    const shipping = shippingFor(packCount, batteryCount, true);
    const cost = comboTotalCost({
      baseCost: base, packaging: pack, taxPercent: tax,
      shipping, accessoryPrice,
      batteryUnitPrice: unit, batteryCount, chargerPrice,
    });
    return { cost, sale: planSalePrice(cost, markupValue), shipping };
  };

  /** 切到手动：先把当前自动值填进去，避免切过去变 0 让人以为算错。 */
  const switchToManual = () => {
    setShipping(String(bareShip));
    setShippingMode('manual');
  };

  const openVolumeDialog = () => {
    setVolumeInput(String(volumeDivisor));
    setVolumeMessage('');
    setVolumeDialogOpen(true);
  };

  /** 体积参数是全局设置：保存后所有产品的自动运费都按新参数重算。 */
  const saveVolumeSetting = async () => {
    if (volumeBusy) return;
    setVolumeBusy(true);
    setVolumeMessage('');
    try {
      const saved = await saveVolumeDivisor(normalizeVolumeDivisor(volumeInput));
      setVolumeDivisor(saved);
      setVolumeInput(String(saved));
      setVolumeDialogOpen(false);
    } catch (error) {
      setVolumeMessage((error as { message?: string })?.message ?? '体积参数保存失败');
    } finally {
      setVolumeBusy(false);
    }
  };

  const save = async () => {
    if (!/^\d+$/.test(product.id) || busy) return;
    setBusy(true);
    try {
      rememberMarkup(String(markupValue));
      // 明细按裸机成本拆条（税用残差，保证与服务端重算的合计完全一致）；参数快照供载入回显。
      const accessoryItems = accessoryPrice > 0 ? [{ name: '配件', qty: 1, unitPrice: accessoryPrice }] : [];
      const taxAmount = round2(bareCost - base - pack - bareShip - accessoryPrice);
      const params: PricePlanParams = {
        baseCost: base, packaging: pack, shipping: bareShip, taxPercent: tax,
        chargerName: charger?.name ?? '', chargerPrice,
        shippingMode, shippingUnitPrice: unitPriceValue,
        volumeDivisor,
      };
      const plan = await savePricePlan(product.id, {
        name: planName,
        markupPercent: markupValue,
        targetPrice: null,
        items: [
          { name: '采购价', qty: 1, unitPrice: base },
          { name: '包材配件', qty: 1, unitPrice: pack },
          ...accessoryItems,
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
      setVolumeDivisor(normalizeVolumeDivisor(params.volumeDivisor));
      setVolumeInput(String(normalizeVolumeDivisor(params.volumeDivisor)));
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

  return <>
    <Modal open={open} title={`售价计算 · ${product.name || product.sku || '产品'}`} onClose={onClose} width={1100}>
    {/* 产品图 + 名称：截图发客户时一眼看清是哪个产品；右侧小眼睛隐藏全部成本。 */}
    <div className="price-calc2-head">
      {image
        ? <img className="price-calc2-thumb" src={thumbUrl(image.url, 240)} alt="" loading="lazy" decoding="async" />
        : <span className="price-calc2-thumb is-empty" aria-hidden="true"><ImageIcon size={18} /></span>}
      <span className="price-calc2-title">
        <strong>{product.name || product.sku || '未命名产品'}</strong>
        <em>{[product.sku, (product.category ?? '').trim()].filter(Boolean).join(' · ')}</em>
      </span>
      <span className="price-calc2-head-actions">
        {costsVisible && <button
          className="button button-secondary button-sm price-calc2-battery-prices"
          type="button"
          disabled={!batteryMatrix}
          title="查询电池单价（容量 × 节数）"
          onClick={() => setBatteryPricesOpen(true)}
        ><BatteryCharging size={14} />电池价格</button>}
        <button
          className="icon-button price-calc2-eye"
          type="button"
          aria-pressed={!costsVisible}
          aria-label={costsVisible ? '隐藏成本（发客户截图用）' : '显示成本'}
          title={costsVisible ? '隐藏成本（发客户截图用）' : '显示成本'}
          onClick={() => setCostsVisible((current) => !current)}
        >{costsVisible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
      </span>
    </div>
    <div className="price-calc2">
      <div className="price-calc2-params">
        {costsVisible && <>
        <label className="price-calc2-field"><span>采购价</span><input className="input" type="number" min={0} step="0.01" aria-label="采购价" value={baseCost} onChange={(event) => setBaseCost(event.target.value)} /></label>
        <label className="price-calc2-field"><span>毛利率 %</span><input className="input" type="number" min={0} aria-label="毛利率" value={markup} onChange={(event) => setMarkup(event.target.value)} /></label>
        <label className="price-calc2-field"><span>包材配件</span><input className="input" type="number" min={0} step="0.01" aria-label="包材配件" value={packaging} onChange={(event) => setPackaging(event.target.value)} /></label>
        {/* 产品配件：只读汇总，实际增删改在产品编辑器；价格进成本，重量进实重与运费。 */}
        <div className={`price-calc2-accessories${accessories.length ? '' : ' is-empty'}`}>
          <div className="price-calc2-accessories-head">
            <span>配件</span>
            <em>{accessories.length ? `¥${round2(accessoryPrice)} · ${accessoryWeight}kg` : '无'}</em>
          </div>
          {!!accessories.length && <div className="price-calc2-accessories-list">
            {accessories.map((item) => <span key={item.id || item.name}>
              {item.name}
              {item.price > 0 ? ` ¥${round2(item.price)}` : ''}
              {item.weight ? ` · ${item.weight}kg` : ''}
            </span>)}
          </div>}
        </div>
        {/* 运费：自动按「计费重量 × 单价」预估，手动则手填固定值。单价放运费前面。 */}
        <label className="price-calc2-field"><span>运费单价 /kg</span><input className="input" type="number" min={0} step="0.01" aria-label="运费单价" value={shippingUnitPrice} disabled={!autoMode} onChange={(event) => { setShippingUnitPrice(event.target.value); rememberShippingUnitPrice(event.target.value); }} /></label>
        {/* 当前是自动还是手动由下方两个按钮显示，这里不再重复标「自动」。
            自动模式下点运费金额打开体积参数弹窗（全局设置，所有产品共用）。
            实重/抛重放在输入框前面：桌面和手机都能直接看到运费是按哪个重量算的。 */}
        <label className="price-calc2-field price-calc2-shipping-field">
          <span className="price-calc2-shipping-label">运费
            {autoMode && <span
              className="price-calc2-shipweight"
              title={`实重 ${bareActualWeight}kg；抛重 ${parcelVolumeCm3 ? `${volumeWeightKg}kg（÷${volumeDivisor}）` : '未填外箱尺寸'}；计费 ${bareChargeableWeight}kg`}
            >实重 {bareActualWeight}kg / 抛重 {parcelVolumeCm3 ? `${volumeWeightKg}kg` : '—'}</span>}
          </span>
          <input
            className={`input${autoMode ? ' is-volume-trigger' : ''}`}
            type="number"
            min={0}
            step="0.01"
            aria-label="运费金额"
            value={autoMode ? String(bareShip) : shipping}
            readOnly={autoMode}
            title={autoMode ? `点击设置体积参数（计费 ${bareChargeableWeight}kg）` : undefined}
            onClick={() => { if (autoMode) openVolumeDialog(); }}
            onChange={(event) => setShipping(event.target.value)}
          />
        </label>
        <div className="price-calc2-shipmode">
          <button type="button" className={autoMode ? 'is-on' : ''} aria-pressed={autoMode} onClick={() => setShippingMode('auto')}>自动</button>
          <button type="button" className={!autoMode ? 'is-on' : ''} aria-pressed={!autoMode} onClick={switchToManual}>手动</button>
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
            onClick={() => void copySalePrice(`裸机 ${formatHalf(bareSale)}元（${priceInclusionLabel(bareShip, tax)}）`, 'bare')}
          >{copiedKey === 'bare' ? <Check size={13} /> : null}售价 {formatMoney(bareSale)}</button>
          {costsVisible && <span className="price-calc2-bare-profit">毛利 {formatMoney(round2(bareSale - bareCost))}</span>}
        </div>
      </div>

      <div className="price-calc2-matrix">
        {!batteryMatrix && <div className="table-state">正在加载电池价格…</div>}
        {/* 只有矩阵真的没建过时才提示。行/列被眼睛关掉属于主动隐藏，不再提醒「都关掉了」。 */}
        {batteryMatrix && !batteryMatrix.capacities.length && !batteryMatrix.packCounts.length && (
          <div className="table-state">电池价格矩阵还是空的：去「设置 → 电池与充电器」加容量与节数。</div>
        )}
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
                        onClick={() => void copySalePrice(`${copyName} ${formatHalf(values.sale)}元（${priceInclusionLabel(values.shipping, tax)}）`, key)}
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
    </Modal>
    {/* 电池价格查询：只读，按当前可见的容量 × 节数展示单价；成本隐藏时入口也一起收起。 */}
    <Modal open={batteryPricesOpen} title="电池价格" onClose={() => setBatteryPricesOpen(false)} width={620} layer={22}>
      <div className="battery-query">
        <p className="battery-query-hint">单价 = 一块电池包的价格（元）；未定价的组合显示 —。只显示当前对所有产品可见的行/列。</p>
        {visibleMatrix && visibleMatrix.capacities.length && visibleMatrix.packCounts.length ? (
          <div className="battery-query-scroll">
            <table className="battery-query-table">
              <thead><tr>
                <th className="battery-query-corner">容量 \ 节数</th>
                {visibleMatrix.packCounts.map((packCount) => <th key={packCount}>{packCount} 节</th>)}
              </tr></thead>
              <tbody>{visibleMatrix.capacities.map((capacity, rowIndex) => <tr key={capacity}>
                <th>{capacity} mAh</th>
                {visibleMatrix.packCounts.map((packCount, colIndex) => {
                  const price = batteryCellPrice(visibleMatrix, rowIndex, colIndex);
                  return <td key={packCount}>{price > 0 ? `¥${round2(price)}` : '—'}</td>;
                })}
              </tr>)}</tbody>
            </table>
          </div>
        ) : <div className="empty-state">当前没有可查询的电池价格。</div>}
      </div>
    </Modal>
    {/* 体积重参数：点运费金额打开；保存即全局生效，所有产品的自动运费共用。 */}
    <Modal open={volumeDialogOpen} title="运费体积参数" onClose={() => setVolumeDialogOpen(false)} width={480} layer={22}>
      <div className="volume-settings">
        <label className="price-calc2-field"><span>体积参数（cm³/kg）</span>
          <input
            className="input"
            type="number"
            min={VOLUME_DIVISOR_MIN}
            max={VOLUME_DIVISOR_MAX}
            step={100}
            aria-label="体积参数"
            value={volumeInput}
            onChange={(event) => setVolumeInput(event.target.value)}
          />
        </label>
        <p className="volume-settings-hint">单台抛重 = 外箱长×宽×高 ÷ 体积参数 ÷ 装箱数；实重和抛重取较大者计费。默认 8000。</p>
        <p className="volume-settings-meta">
          {parcelVolumeCm3
            ? `本产品：${volumeFromOuter ? '外箱' : '内盒（未填外箱，退回内盒）'} ${parcelVolumeCm3}cm³ ÷ ${unitsPerCarton} 台/箱 → 抛重 ${volumetricWeightKg(parcelVolumeCm3, normalizeVolumeDivisor(volumeInput), unitsPerCarton)}kg`
            : '本产品包装没有外箱/内盒尺寸，暂按实重计费；补尺寸后自动按抛重比较。'}
        </p>
        <div className="volume-settings-actions">
          <button className="button button-secondary" type="button" disabled={volumeBusy} onClick={() => setVolumeDialogOpen(false)}>取消</button>
          <button className="button button-primary" type="button" disabled={volumeBusy} onClick={() => void saveVolumeSetting()}>{volumeBusy ? '保存中...' : '保存（所有产品共用）'}</button>
        </div>
        {!!volumeMessage && <p role="status" className="volume-settings-message">{volumeMessage}</p>}
      </div>
    </Modal>
  </>;
}
