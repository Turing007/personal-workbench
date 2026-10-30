import { Fragment, useEffect, useRef, useState } from 'react';
import { BatteryCharging, Check, ChevronDown, Eye, EyeOff, Image as ImageIcon, Save, Trash2 } from 'lucide-react';
import Modal from './Modal';
import PickerCurtain from './PickerCurtain';
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
import { packCountMatchesVoltage } from '../../shared/battery-voltage';
import { BATTERY_COMBO_VARIANTS, batteryCellPrice, batteryUnitPriceOf, type BatteryPriceMatrix } from '../../shared/battery-prices';
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
 * 产品售价计算器（矩阵口径）：上方填采购价/毛利率/其他费用并选包装、配件、运费、税、充电器，
 * 下方按「电池容量 × 节数 × 一电一充/两电一充」整表出成本与售价；
 * 点任意售价即复制「5节1300mah 一电一充 138.12元」，可直接发给客户。
 * 顶部有产品图与名称；「小眼睛」一键隐藏全部成本（含参数、成本列、毛利与方案区），
 * 留在屏幕上的是干净的价格表，方便直接截图发客户。默认每次打开都显示成本。
 * 下方保存方案（记下参数快照，可载入回显）；保存即新增一条历史，不覆盖。
 */
export default function PriceCalculatorModal({ open, product, onClose }: PriceCalculatorModalProps) {
  const [baseCost, setBaseCost] = useState('');
  /** 其他费用：包材费按所选包装自动取采购价，这里只填额外摊进去的费用。 */
  const [otherFees, setOtherFees] = useState('0');
  /** 本次计算用哪一行包装：实重/体积重/装箱数/包材费都跟它走。 */
  const [packagingId, setPackagingId] = useState('');
  const [packagingPickerOpen, setPackagingPickerOpen] = useState(false);
  const packagingAnchorRef = useRef<HTMLDivElement>(null);
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
  /** 配件下拉幕布：多选，只把选中的配件计入成本与实重。 */
  const [accessoryPickerOpen, setAccessoryPickerOpen] = useState(false);
  /** 选中的配件名称；默认空 = 本次不选任何配件，需要时自己勾选。 */
  const [selectedAccessoryNames, setSelectedAccessoryNames] = useState<string[]>([]);
  /** 产品没维护自有配件清单时，与详情/编辑器一致沿用该类目的配件。 */
  const [categoryAccessories, setCategoryAccessories] = useState<AccessoryPrice[]>([]);
  const accessoryAnchorRef = useRef<HTMLDivElement>(null);
  /** 体积重参数（cm³/kg）：默认取全局设置，载入方案时按方案快照覆盖。 */
  const [volumeDivisor, setVolumeDivisor] = useState(DEFAULT_VOLUME_DIVISOR);
  /** 点运费金额打开的体积参数弹窗。 */
  const [volumeDialogOpen, setVolumeDialogOpen] = useState(false);
  const [volumeInput, setVolumeInput] = useState(String(DEFAULT_VOLUME_DIVISOR));
  const [volumeBusy, setVolumeBusy] = useState(false);
  const [volumeMessage, setVolumeMessage] = useState('');
  /** 本次计算用的是哪条采购报价；空串 = 采购价手填（与所选报价无关）。 */
  const [quoteId, setQuoteId] = useState('');

  useEffect(() => {
    if (!open || !product) return;
    let cancelled = false;
    // 采购价：默认档报价 → 镜像列兜底；其他费用从 0 起填，包材费按所选包装自动带。
    const quotes = product.purchaseQuotes ?? [];
    const defaultQuote = quotes.find((quote) => quote.isDefault) ?? quotes[0];
    setBaseCost((defaultQuote?.price ?? '').trim() || product.purchasePrice || '0');
    // 默认档没定价时价格来自镜像列，不能算「选中了某条报价」。
    setQuoteId(defaultQuote?.price?.trim() ? defaultQuote.id : '');
    setOtherFees('0');
    setPackagingId(product.packaging[0]?.id ?? '');
    setPackagingPickerOpen(false);
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
    setAccessoryPickerOpen(false);
    setSelectedAccessoryNames([]);
    setCategoryAccessories([]);
    // 自有清单为空且没固化过：沿用类目配件（和产品编辑器的预填口径一致）。
    const hasOwnAccessories = (product.accessoryPrices ?? []).some((item) => item.name.trim());
    if (!hasOwnAccessories && !product.accessoryPricesCustomized && product.category?.trim()) {
      getCategoryAccessoryPrices(product.category.trim())
        .then((items) => { if (!cancelled) setCategoryAccessories(items.filter((item) => item.name.trim())); })
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
  /** 产品的多档采购报价：本次计算可手动选其中一条，价格填进采购价输入框。 */
  const quotes = product.purchaseQuotes ?? [];
  const selectedQuote = quotes.find((quote) => quote.id === quoteId);
  const quoteText = (quote: { supplier: string; variant: string }) =>
    [quote.supplier.trim() || '未填供应商', quote.variant.trim()].filter(Boolean).join(' · ');
  const packagingRows = product.packaging ?? [];
  const packagingRow = packagingRows.find((row) => row.id === packagingId) ?? packagingRows[0];
  /** 包材费：取所选包装的采购价；产品没填就是 0。 */
  const packagingCost = round2(Number(packagingRow?.purchasePrice) || 0);
  const otherCost = amountInput(otherFees);
  /** 计成本的包材合计 = 包装采购价 + 其他费用。 */
  const pack = round2(packagingCost + otherCost);
  const tax = amountInput(taxPercent);
  const markupValue = amountInput(markup);
  const charger = chargerPrices.find((item) => item.id === chargerId);
  const chargerPrice = charger?.price ?? 0;

  // 配件口径与产品编辑器一致：有自有清单（含明确清空）就用自有；
  // 从没维护过（自有为空且未固化）才沿用类目配件，避免“编辑器里明明有、计算器选不了”。
  const ownAccessories = (product.accessoryPrices ?? []).filter((item) => item.name.trim());
  const allAccessories = ownAccessories.length || product.accessoryPricesCustomized
    ? ownAccessories
    : categoryAccessories;
  // 按名称归组：方案快照按名称记录选择。同名多行一起勾选、金额一起累加，
  // 不会因为只取第一行而少算钱；界面上合并成一个胶囊显示合计。
  const accessoryGroups = new Map<string, AccessoryPrice[]>();
  for (const item of allAccessories) {
    const group = accessoryGroups.get(item.name);
    if (group) group.push(item);
    else accessoryGroups.set(item.name, [item]);
  }
  const accessoryNames = Array.from(accessoryGroups.keys());
  const accessoryOptions = accessoryNames.map((name) => {
    const totals = accessoryTotals(accessoryGroups.get(name)!);
    return { name, price: totals.price, weight: totals.weight };
  });
  // 默认什么都不选：配件成本与重量只在明确勾选后才计入，不用先取消一轮。
  const selectedNameSet = new Set(selectedAccessoryNames);
  const selectedAccessoryOptions = accessoryOptions
    .filter((option) => selectedNameSet.has(option.name));
  const accessories = accessoryNames
    .filter((name) => selectedNameSet.has(name))
    .flatMap((name) => accessoryGroups.get(name)!);
  const accessoryTotalsValue = accessoryTotals(accessories);
  const accessoryPrice = accessoryTotalsValue.price;
  const accessoryWeight = accessoryTotalsValue.weight;
  const allAccessoriesSelected = accessoryNames.length > 0 && accessories.length === accessoryNames.length;

  /** 点胶囊切换单项。 */
  const toggleAccessory = (name: string) => {
    setSelectedAccessoryNames((current) => current.includes(name)
      ? current.filter((item) => item !== name)
      : accessoryNames.filter((item) => item === name || current.includes(item)));
  };
  const selectedAccessoryNamesForSave = selectedAccessoryOptions.map((item) => item.name);

  // 产品重量取包装第一行的内盒重量（单台重量，与矩阵每台成本口径一致）。
  // 产品重量与体积都取所选包装这一行（不再是固定第一条）。
  const productWeightKg = Number(packagingRow?.innerWeight) || 0;
  const weightMissing = productWeightKg <= 0;
  const unitPriceValue = amountInput(shippingUnitPrice);
  const autoMode = shippingMode === 'auto';
  // 自动模式下运费按计费重量现算；手动模式用输入框里的固定值。
  const manualShip = amountInput(shipping);

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

  // 电池矩阵只按产品电压过滤节数：12V=3 节、16.8V=4 节、21V=5 节及以上。
  const capacities = batteryMatrix?.capacities ?? [];
  // 列 = 每个节数 × 两种成套口径；顺序跟随设置里的节数顺序。
  const combos = batteryMatrix
    ? batteryMatrix.packCounts
      .filter((packCount) => packCountMatchesVoltage(packCount, product.batteryVoltage))
      .flatMap((packCount) => BATTERY_COMBO_VARIANTS.map((variant) => ({ packCount, batteryCount: variant.batteryCount, label: variant.label })))
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
        baseCost: base, packaging: packagingCost, shipping: bareShip, taxPercent: tax,
        chargerName: charger?.name ?? '', chargerPrice,
        shippingMode, shippingUnitPrice: unitPriceValue,
        volumeDivisor,
        // 记下这次计入的配件名称：载入方案时照着还原勾选，不会被后来改的清单带偏。
        accessoryNames: selectedAccessoryNamesForSave,
        // 记住这次勾选的包装：载入时按 id/名称找回来，重算仍在同一口径上。
        packagingId: packagingRow?.id ?? '',
        packagingName: packagingRow?.name ?? '',
        otherCost,
        // 记下用的是哪家哪条报价，载入方案时据此找回来回显；手动价不写。
        ...(selectedQuote && (selectedQuote.supplier || selectedQuote.variant)
          ? { quoteSupplier: selectedQuote.supplier, quoteVariant: selectedQuote.variant }
          : {}),
      };
      const plan = await savePricePlan(product.id, {
        name: planName,
        markupPercent: markupValue,
        targetPrice: null,
        items: [
          { name: '采购价', qty: 1, unitPrice: base },
          { name: '包材', qty: 1, unitPrice: packagingCost },
          { name: '其他费用', qty: 1, unitPrice: otherCost },
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
      // 报价按供应商 + 名目找回：报价被删或改了名就退回「手动填写」，价格仍按快照。
      const savedQuote = params.quoteSupplier || params.quoteVariant
        ? quotes.find((quote) => quote.supplier === (params.quoteSupplier ?? '') && quote.variant === (params.quoteVariant ?? ''))
        : undefined;
      setQuoteId(savedQuote?.id ?? '');
      // 包装按方案快照还原：优先 id，其次名称；都找不到就回到第一条。
      const savedPackaging = (params.packagingId ? packagingRows.find((row) => row.id === params.packagingId) : undefined)
        ?? (params.packagingName ? packagingRows.find((row) => row.name === params.packagingName) : undefined)
        ?? packagingRows[0];
      setPackagingId(savedPackaging?.id ?? '');
      if (params.otherCost == null) {
        // 旧方案没有「其他费用」字段：当时 packaging 是手填的包材配件总额，
        // 扣掉现在所选包装的采购价后作为其他费用，保证总成本仍是当时的结果。
        const savedPackagingCost = round2(Number(savedPackaging?.purchasePrice) || 0);
        setOtherFees(String(Math.max(0, round2(params.packaging - savedPackagingCost))));
      } else {
        setOtherFees(String(params.otherCost));
      }
      setShipping(String(params.shipping));
      setShippingMode(params.shippingMode);
      setShippingUnitPrice(String(params.shippingUnitPrice));
      setVolumeDivisor(normalizeVolumeDivisor(params.volumeDivisor));
      setVolumeInput(String(normalizeVolumeDivisor(params.volumeDivisor)));
      setTaxPercent(String(params.taxPercent));
      const matched = chargerPrices.find((item) => item.name === params.chargerName);
      if (matched) setChargerId(matched.id);
      // 配件选择按名称还原；清单里已经删掉的名称自动忽略。
      // 旧方案没记配件（那时是全部自动计入）：按全选回显，保持当时的算法结果。
      const saved = params.accessoryNames ?? accessoryNames;
      setSelectedAccessoryNames(Array.from(new Set(saved)).filter((name) => accessoryNames.includes(name)));
      setMessage('');
    } else {
      // 旧格式方案（没存参数）：按明细里能认出来的行尽量回显。
      const byName = new Map(plan.items.map((item) => [item.name, item.unitPrice]));
      setBaseCost(String(byName.get('产品成本') ?? base));
      setQuoteId('');
      setOtherFees(String(byName.get('其他费用') ?? byName.get('包材配件') ?? byName.get('包材') ?? 0));
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
        <div className="price-calc2-inputs">
        {/* 采购价 + 报价下拉：同一产品有多家供应商报价时，下拉里直接显示名称与价格，
            选一条即把价格填进采购价；手改价格则回到「手动填写」。只有一条报价时不占地方。
            下拉和输入框都在「采购价」这一格里，不跨列，三列对齐和自动/手动的位置都不受影响。 */}
        <div className={`price-calc2-field price-calc2-price-field${quotes.length > 1 ? ' has-quote-select' : ''}`}>
          <span>采购价</span>
          {quotes.length > 1 && <select
            className="toolbar-select price-calc2-quote-select"
            aria-label="采购报价"
            title="选择本次计算用的采购报价；手改价格即视为手动填写"
            value={quoteId}
            onChange={(event) => {
              const next = quotes.find((quote) => quote.id === event.target.value);
              setQuoteId(next?.id ?? '');
              if (next) setBaseCost(next.price);
            }}
          >
            {quotes.map((quote) => {
              const priced = quote.price.trim().length > 0;
              const text = priced ? `¥${quote.price} · ${quoteText(quote)}` : `未定价 · ${quoteText(quote)}`;
              return <option key={quote.id} value={quote.id} disabled={!priced} title={text}>{text}</option>;
            })}
            <option value="">手动填写</option>
          </select>}
          <input className="input" type="number" min={0} step="0.01" aria-label="采购价" value={baseCost} onChange={(event) => { setBaseCost(event.target.value); setQuoteId(''); }} />
        </div>
        <label className="price-calc2-field"><span>毛利率 %</span><input className="input" type="number" min={0} aria-label="毛利率" value={markup} onChange={(event) => setMarkup(event.target.value)} /></label>
        <label className="price-calc2-field"><span>其他费用</span><input className="input" type="number" min={0} step="0.01" aria-label="其他费用" value={otherFees} onChange={(event) => setOtherFees(event.target.value)} title="包材费按所选包装自动带出；这里填额外的其他费用" /></label>
        {/* 运费：自动按「计费重量 × 单价」预估，手动则手填固定值。单价放运费前面。 */}
        <label className="price-calc2-field"><span>运费单价 /kg</span><input className="input" type="number" min={0} step="0.01" aria-label="运费单价" value={shippingUnitPrice} disabled={!autoMode} onChange={(event) => { setShippingUnitPrice(event.target.value); rememberShippingUnitPrice(event.target.value); }} /></label>
        {/* 当前是自动还是手动由下方两个按钮显示，这里不再重复标「自动」。
            自动模式下点运费金额打开体积参数弹窗（全局设置，所有产品共用）。
            实重/体积重放在输入框前面：桌面和手机都能直接看到运费是按哪个重量算的。 */}
        <label className="price-calc2-field price-calc2-shipping-field">
          <span className="price-calc2-shipping-label">运费
            {autoMode && <span
              className="price-calc2-shipweight"
              title={`实重 ${bareActualWeight}kg；体积重 ${parcelVolumeCm3 ? `${volumeWeightKg}kg（÷${volumeDivisor}）` : '未填外箱尺寸'}；计费 ${bareChargeableWeight}kg`}
            >实重 {bareActualWeight}kg / 体积重 {parcelVolumeCm3 ? `${volumeWeightKg}kg` : '—'}</span>}
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
        {autoMode && weightMissing && <p className="price-calc2-warn" role="status">所选包装没填内盒重量，产品部分按 0 算（电池与充电器重量照常计）；去产品库补重量或切手动。</p>}
        <label className="price-calc2-field"><span>税 %</span><input className="input" type="number" min={0} step="0.01" aria-label="税" value={taxPercent} onChange={(event) => setTaxPercent(event.target.value)} /></label>
        <label className="price-calc2-field"><span>充电器</span>
          <select className="toolbar-select price-calc2-charger" aria-label="充电器" value={chargerId} disabled={!chargerPrices.length} onChange={(event) => setChargerId(event.target.value)}>
            {chargerPrices.map((item) => <option key={item.id} value={item.id}>{item.name} ¥{formatHalf(item.price)}</option>)}
            {!chargerPrices.length && <option value="">无（去设置里添加）</option>}
          </select>
        </label>
        </div>
        <div className="price-calc2-pickers">
        {/* 包装：运费按所选包装的内盒重量、外箱尺寸/装箱数计算；包材费取该包装的采购价。 */}
        <div ref={packagingAnchorRef} className={`price-calc2-packaging${packagingRows.length ? '' : ' is-empty'}`}>
          <div className="price-calc2-packaging-head">
            <span>包装</span>
            <em>{packagingRows.length ? `包材 ¥${round2(packagingCost)}` : '无'}</em>
          </div>
          <button
            className="toolbar-select price-calc2-packaging-trigger"
            type="button"
            aria-label="选择包装"
            aria-haspopup="dialog"
            aria-expanded={packagingPickerOpen}
            onClick={() => setPackagingPickerOpen((current) => !current)}
          >
            <span className="price-calc2-packaging-trigger-label">{packagingRow?.name?.trim() || (packagingRows.length ? '未命名包装' : '无包装')}</span>
            <ChevronDown size={13} />
          </button>
          {packagingRow && <div className="price-calc2-packaging-meta">
            {[packagingRow.packSize ? `${packagingRow.packSize} 台/箱` : '', packagingRow.innerWeight ? `内盒 ${packagingRow.innerWeight}kg` : '', packagingRow.outerSize ? `外箱 ${packagingRow.outerSize}` : ''].filter(Boolean).join(' · ')}
          </div>}
          <PickerCurtain
            open={packagingPickerOpen}
            onClose={() => setPackagingPickerOpen(false)}
            anchorRef={packagingAnchorRef}
            ariaLabel="选择包装"
            className="price-calc2-packaging-curtain"
          >
            <div className="search-history-head">
              <span>选择计算运费用的包装</span>
              <button
                type="button"
                className="search-history-clear"
                onClick={() => setPackagingPickerOpen(false)}
              >完成</button>
            </div>
            {!!packagingRows.length && <div className="search-history-chips">
              {packagingRows.map((row) => {
                const selected = row.id === packagingRow?.id;
                return <button
                  key={row.id}
                  type="button"
                  className={`category-chip${selected ? ' is-selected' : ''}`}
                  aria-pressed={selected}
                  onClick={() => { setPackagingId(row.id); setPackagingPickerOpen(false); }}
                >
                  {row.name?.trim() || '未命名包装'}
                  {row.packSize ? ` ${row.packSize}台/箱` : ''}
                  {row.innerWeight ? ` · ${row.innerWeight}kg` : ''}
                </button>;
              })}
            </div>}
            {!packagingRows.length && <p className="price-calc2-accessory-empty">本产品还没有包装。去产品编辑页的「包装」里添加后，这里就能选。</p>}
            {!!packagingRows.length && <p className="price-calc2-accessory-empty">运费按所选包装的装箱数与尺寸计算；包材费取该包装的采购价。包装明细在产品编辑页维护。</p>}
          </PickerCurtain>
        </div>
        {/* 配件：只列本产品自己的清单（类目默认只在新建时预填，不在这里出现）；
            用下拉幕布勾选本次要计入的配件，选中的价格进成本、重量进实重与运费。 */}
        <div ref={accessoryAnchorRef} className={`price-calc2-accessories${accessories.length ? '' : ' is-empty'}`}>
          <div className="price-calc2-accessories-head">
            <span>配件</span>
            <em>{!accessoryNames.length ? '无' : !accessories.length ? '未选' : `¥${round2(accessoryPrice)} · ${accessoryWeight}kg`}</em>
          </div>
          <button
            className="toolbar-select price-calc2-accessory-trigger"
            type="button"
            aria-label="选择配件"
            aria-haspopup="dialog"
            aria-expanded={accessoryPickerOpen}
            onClick={() => setAccessoryPickerOpen((current) => !current)}
          >
            <span className="price-calc2-accessory-trigger-label">{!accessoryNames.length
              ? '无配件'
              : allAccessoriesSelected ? `全部 ${accessoryNames.length} 项` : selectedAccessoryOptions.length ? `已选 ${selectedAccessoryOptions.length}/${accessoryNames.length} 项` : '未选择'}</span>
            <ChevronDown size={13} />
          </button>
          {/* 选中的配件只留一行名称（超出省略），价格/重量的明细在幕布里看；
              配件多时不会把参数列撑成一长串。 */}
          {!!selectedAccessoryOptions.length && <div className="price-calc2-accessories-list" title={selectedAccessoryOptions.map((item) => item.name).join('、')}>
            {selectedAccessoryOptions.map((item) => item.name).join('、')}
          </div>}
          <PickerCurtain
            open={accessoryPickerOpen}
            onClose={() => setAccessoryPickerOpen(false)}
            anchorRef={accessoryAnchorRef}
            ariaLabel="选择配件"
            className="price-calc2-accessory-curtain"
          >
            <div className="search-history-head">
              <span>选择配件（价格与重量一起计入）</span>
              <span className="price-calc2-accessory-curtain-actions">
                {!!accessoryNames.length && <>
                  <button
                    type="button"
                    className="search-history-clear"
                    onClick={() => setSelectedAccessoryNames(accessoryNames)}
                  >全选</button>
                  <button
                    type="button"
                    className="search-history-clear"
                    onClick={() => setSelectedAccessoryNames([])}
                  >清空</button>
                </>}
                <button
                  type="button"
                  className="search-history-clear"
                  onClick={() => setAccessoryPickerOpen(false)}
                >完成</button>
              </span>
            </div>
            {!!accessoryNames.length && <div className="search-history-chips">
              {accessoryOptions.map((item) => {
                const selected = selectedNameSet.has(item.name);
                return <button
                  key={item.name}
                  type="button"
                  className={`category-chip${selected ? ' is-selected' : ''}`}
                  aria-pressed={selected}
                  onClick={() => toggleAccessory(item.name)}
                >
                  {item.name}
                  {item.price > 0 ? ` ¥${round2(item.price)}` : ''}
                  {item.weight ? ` · ${item.weight}kg` : ''}
                </button>;
              })}
            </div>}
            {!accessoryNames.length && <p className="price-calc2-accessory-empty">本产品还没有配件。去产品编辑页的「配件」里添加后，这里就能勾选。</p>}
          </PickerCurtain>
        </div>
        </div>
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
        {/* 只有矩阵真的没建过时才提示。 */}
        {batteryMatrix && !batteryMatrix.capacities.length && !batteryMatrix.packCounts.length && (
          <div className="table-state">电池价格矩阵还是空的：去「设置 → 电池与充电器」加容量与节数。</div>
        )}
        {batteryMatrix && !!batteryMatrix.capacities.length && !!batteryMatrix.packCounts.length && !combos.length && (
          <div className="table-state">该产品是 {product.batteryVoltage ?? '21V'}，电池矩阵里没有匹配的节数：12V 对应 3 节、16.8V 对应 4 节、21V 对应 5 节及以上。</div>
        )}
        {batteryMatrix && !!capacities.length && <div className="price-calc2-scroll">
          <table className="battery-price-table">
            <thead>
              <tr>
                <th className="battery-price-corner" rowSpan={2}>单节电芯容量</th>
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
    {/* 电池价格查询：参考表列出完整矩阵，不受产品电压过滤；成本隐藏时入口一起收起，避免发客户截图时暴露进价。 */}
    <Modal open={batteryPricesOpen} title="电池价格" onClose={() => setBatteryPricesOpen(false)} width={620} layer={22} compact>
      <div className="battery-query">
        <p className="battery-query-hint">单价 = 一块电池包的价格（元）；未定价的组合显示 —。这里列出全部容量与节数，不受产品电压过滤（计算器里只显示适配电压的节数）。</p>
        {batteryMatrix && batteryMatrix.capacities.length && batteryMatrix.packCounts.length ? (
          <div className="battery-query-scroll">
            <table className="battery-query-table">
              <thead><tr>
                <th className="battery-query-corner">容量 \ 节数</th>
                {batteryMatrix.packCounts.map((packCount) => <th key={packCount}>{packCount} 节</th>)}
              </tr></thead>
              <tbody>{batteryMatrix.capacities.map((capacity, rowIndex) => (
                <tr key={capacity}>
                  <th>{capacity} mAh</th>
                  {batteryMatrix.packCounts.map((packCount, colIndex) => {
                    const price = batteryCellPrice(batteryMatrix, rowIndex, colIndex);
                    return <td key={packCount}>{price > 0 ? `¥${round2(price)}` : '—'}</td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="empty-state">当前没有可查询的电池价格。</div>}
      </div>
    </Modal>
    {/* 体积重参数：点运费金额打开；保存即全局生效，所有产品的自动运费共用。 */}
    <Modal open={volumeDialogOpen} title="运费体积参数" onClose={() => setVolumeDialogOpen(false)} width={480} layer={22} compact>
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
        <p className="volume-settings-hint">单台体积重 = 外箱长×宽×高 ÷ 体积参数 ÷ 装箱数；实重和体积重取较大者计费。默认 8000。</p>
        <p className="volume-settings-meta">
          {parcelVolumeCm3
            ? `本产品：${volumeFromOuter ? '外箱' : '内盒（未填外箱，退回内盒）'} ${parcelVolumeCm3}cm³ ÷ ${unitsPerCarton} 台/箱 → 体积重 ${volumetricWeightKg(parcelVolumeCm3, normalizeVolumeDivisor(volumeInput), unitsPerCarton)}kg`
            : '本产品所选包装没有外箱/内盒尺寸，暂按实重计费；补尺寸后自动按体积重比较。'}
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
