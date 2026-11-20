import { useState } from 'react';
import { Calculator, CircleAlert, PencilLine } from 'lucide-react';
import {
  ORDER_ITEM_COST_FIELDS,
  calculateOrderItemCostCents,
  calculateOrderProfit,
  orderItemUnitCostCents,
  type OrderItemCostField,
} from '../../../shared/order-profit';
import { calculateOrderLineAmountCents } from '../../../shared/order-prices';
import type { OrderDraft, OrderItemDraft } from '../OrderForm';

const COST_LABELS: Record<OrderItemCostField, string> = {
  machineCostCents: '机头',
  batteryCostCents: '电池',
  chargerCostCents: '充电器',
  packagingCostCents: '包装',
  accessoryCostCents: '配件',
  otherCostCents: '其他',
};

function money(cents: number): string {
  return `¥ ${(cents / 100).toFixed(2)}`;
}

function costInputValue(value: number | null | undefined): string {
  return value == null ? '' : (value / 100).toFixed(2);
}

function parseCostInput(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

/** 金额输入中间态：编辑时保留用户原始输入，失焦后再规范成两位小数，避免每次按键重排光标。 */
function CostInput({ label, value, onChange }: {
  label: string;
  value: number | null | undefined;
  onChange: (cents: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input
    type="text"
    inputMode="decimal"
    aria-label={label}
    value={draft ?? costInputValue(value)}
    onChange={(event) => {
      const next = event.target.value;
      if (next !== '' && !/^\d*(?:\.\d{0,2})?$/.test(next)) return;
      setDraft(next);
      onChange(parseCostInput(next));
    }}
    onBlur={() => setDraft(null)}
    placeholder="0.00"
  />;
}

export function OrderItemCostEditor({
  item,
  onChange,
}: {
  item: OrderItemDraft;
  onChange: (patch: Partial<OrderItemDraft>) => void;
}) {
  const unitCostCents = orderItemUnitCostCents(item);
  const lineCostCents = calculateOrderItemCostCents(item);
  const lineRevenueCents = calculateOrderLineAmountCents({
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents ?? 0,
  });
  return <details className="order-item-cost-editor" open={!item.costConfirmed}>
    <summary>
      <span className="order-cost-summary-title"><Calculator size={13} />成本核算</span>
      <span className={item.costConfirmed ? 'order-cost-state is-confirmed' : 'order-cost-state'}>
        {item.costConfirmed
          ? `单件 ${money(unitCostCents ?? 0)} · 行成本 ${money(lineCostCents ?? 0)}`
          : '成本待补'}
      </span>
    </summary>
    <div className="order-item-cost-body">
      <p className="order-cost-hint">以下都是每件成本。包装如果按箱采购，可先除以装箱数再填。</p>
      <div className="order-item-cost-grid">
        {ORDER_ITEM_COST_FIELDS.map((field) => <label key={field}>
          <span>{COST_LABELS[field]}</span>
          <CostInput
            label={`${COST_LABELS[field]}单件成本`}
            value={item[field]}
            onChange={(cents) => onChange({ [field]: cents } as Partial<OrderItemDraft>)}
          />
        </label>)}
      </div>
      <div className="order-item-cost-footer">
        <label className="order-cost-confirm">
          <input type="checkbox" checked={Boolean(item.costConfirmed)} onChange={(event) => onChange({ costConfirmed: event.target.checked })} />
          <span>这行成本已核对</span>
        </label>
        {lineCostCents == null ? <span className="finance-warning">核对后才计入整单毛利</span> : <span>
          单件成本 <b>{money(unitCostCents ?? 0)}</b> · 行成本 <b>{money(lineCostCents)}</b> ·
          行毛利 <b className={lineRevenueCents - lineCostCents < 0 ? 'finance-warning' : 'finance-positive'}>{money(lineRevenueCents - lineCostCents)}</b>
        </span>}
      </div>
    </div>
  </details>;
}

export function OrderCostEditor({
  order,
  onChange,
}: {
  order: OrderDraft;
  onChange: (patch: Partial<OrderDraft>) => void;
}) {
  const profit = calculateOrderProfit({
    amountCents: Math.round(Number(order.amount || 0) * 100),
    items: order.items,
    logisticsCostCents: order.logisticsCostCents,
    labelCostCents: order.labelCostCents,
    otherCostCents: order.otherCostCents,
    costConfirmed: order.costConfirmed,
  });
  return <section className="order-cost-editor">
    <div className="order-cost-editor-head">
      <div><strong><Calculator size={14} />订单费用</strong><span>实际支出，不是向客户收取的运费</span></div>
      <span className={profit.costComplete ? 'order-cost-state is-confirmed' : 'order-cost-state'}>
        {profit.costComplete ? `毛利 ${money(profit.profitCents ?? 0)}` : `成本待补 ${profit.missingItemCount} 行`}
      </span>
    </div>
    <div className="order-level-cost-grid">
      <label><span>实际物流费（元）</span><CostInput label="实际物流费" value={order.logisticsCostCents} onChange={(cents) => onChange({ logisticsCostCents: cents })} /></label>
      <label><span>标贴成本（整单，元）</span><CostInput label="标贴成本" value={order.labelCostCents} onChange={(cents) => onChange({ labelCostCents: cents })} /></label>
      <label><span>其他整单费用（元）</span><CostInput label="其他整单费用" value={order.otherCostCents} onChange={(cents) => onChange({ otherCostCents: cents })} /></label>
      <label className="is-wide"><span>其他费用说明</span><input aria-label="其他费用说明" value={order.otherCostNote ?? ''} onChange={(event) => onChange({ otherCostNote: event.target.value })} placeholder="如：报关、样板、平台佣金、手续费" /></label>
    </div>
    <label className="order-cost-confirm">
      <input type="checkbox" checked={Boolean(order.costConfirmed)} onChange={(event) => onChange({ costConfirmed: event.target.checked })} />
      <span>整单成本已核对，可以计入毛利</span>
    </label>
  </section>;
}

export function OrderProfitSummaryCard({
  order,
  onEdit,
}: {
  order: OrderDraft;
  onEdit?: () => void;
}) {
  const profit = calculateOrderProfit({
    amountCents: Math.round(Number(order.amount || 0) * 100),
    items: order.items,
    logisticsCostCents: order.logisticsCostCents,
    labelCostCents: order.labelCostCents,
    otherCostCents: order.otherCostCents,
    costConfirmed: order.costConfirmed,
  });
  return <section className={`order-profit-card${profit.costComplete ? '' : ' is-pending'}`}>
    <div className="order-profit-head">
      <div><strong><Calculator size={15} />利润核算</strong><span>收入按订单应收，不按已收款</span></div>
      {onEdit && <button type="button" onClick={onEdit}><PencilLine size={13} />{profit.costComplete ? '调整成本' : '补录成本'}</button>}
    </div>
    <div className="order-profit-metrics">
      <div><span>订单收入</span><strong>{money(Math.round(Number(order.amount || 0) * 100))}</strong></div>
      <div><span>成本合计</span><strong>{profit.costComplete ? money(profit.totalCostCents ?? 0) : '—'}</strong></div>
      <div><span>订单毛利</span><strong className={profit.costComplete && (profit.profitCents ?? 0) < 0 ? 'finance-warning' : 'finance-positive'}>{profit.costComplete ? money(profit.profitCents ?? 0) : '—'}</strong></div>
      <div><span>毛利率</span><strong>{profit.costComplete && profit.marginPercent != null ? `${profit.marginPercent}%` : '—'}</strong></div>
    </div>
    {!profit.costComplete && <div className="order-profit-pending">
      <CircleAlert size={14} />
      <span>还有 {profit.missingItemCount} 行产品未确认成本{order.costConfirmed ? '' : '，订单级费用也未确认'}。补齐后才计算完整毛利。</span>
    </div>}
  </section>;
}
