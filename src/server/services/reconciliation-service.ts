import type { DatabaseRepositories } from '../db/repositories.js';
import { daysUntilDue, paymentDueDate } from '../../shared/payment-policy.js';

export interface ReconciliationAging {
  /** 未到期金额。 */
  notDueCents: number;
  /** 逾期 1–30 天。 */
  overdue30Cents: number;
  /** 逾期 31–60 天。 */
  overdue60Cents: number;
  /** 逾期 61–90 天。 */
  overdue90Cents: number;
  /** 逾期 90 天以上。 */
  overdue90PlusCents: number;
}

export interface CustomerReconciliation extends ReconciliationAging {
  customerId: number | null;
  customerName: string;
  creditLimitCents: number;
  outstandingCents: number;
  overdueCents: number;
  /** 最早一笔逾期天数，没有逾期为 0。 */
  oldestOverdueDays: number;
  lastReceiptAt: string;
  orderCount: number;
}

export interface StatementOrderRow {
  orderId: number;
  orderNo: string;
  lastShippedAt: string;
  dueDate: string;
  overdueDays: number;
  receivableCents: number;
  receivedCents: number;
  outstandingCents: number;
}

export interface StatementReceiptRow {
  orderId: number;
  orderNo: string;
  receivedAt: string;
  amountCents: number;
  paymentMethod: string;
  note: string;
  /** 收款为正数，退款为负数；旧接口调用方可忽略。 */
  kind: 'receipt' | 'refund';
}

export interface CustomerStatement {
  customerId: number;
  customerName: string;
  creditLimitCents: number;
  from: string;
  to: string;
  openingCents: number;
  periodReceivableCents: number;
  periodReceiptCents: number;
  closingCents: number;
  overdueCents: number;
  orders: StatementOrderRow[];
  receipts: StatementReceiptRow[];
}

/** 按「距到期还有几天」分桶：正数未到期，负数逾期。 */
function bucketOf(daysUntil: number): keyof ReconciliationAging {
  if (daysUntil >= 0) return 'notDueCents';
  const overdueDays = -daysUntil;
  if (overdueDays <= 30) return 'overdue30Cents';
  if (overdueDays <= 60) return 'overdue60Cents';
  if (overdueDays <= 90) return 'overdue90Cents';
  return 'overdue90PlusCents';
}

/** 账期对账：按客户汇总未收与账龄，并生成单客户对账单。数字来自订单财务快照，与财务列表同源。 */
export class ReconciliationService {
  constructor(private readonly options: { repositories: DatabaseRepositories }) {}

  list(): { items: CustomerReconciliation[]; totals: Omit<CustomerReconciliation, 'customerId' | 'customerName' | 'creditLimitCents' | 'lastReceiptAt' | 'orderCount'> } {
    const balances = this.options.repositories.listCreditOrderBalances();
    const groups = new Map<string, CustomerReconciliation>();
    for (const row of balances) {
      // 对账只看已经发过货的账期订单；还没发的订单不算应收到期。
      if (!row.lastShippedAt) continue;
      const key = row.customerId == null ? `name:${row.customerName}` : `id:${row.customerId}`;
      const item = groups.get(key) ?? {
        customerId: row.customerId,
        customerName: row.customerName,
        creditLimitCents: row.creditLimitCents,
        outstandingCents: 0,
        overdueCents: 0,
        notDueCents: 0,
        overdue30Cents: 0,
        overdue60Cents: 0,
        overdue90Cents: 0,
        overdue90PlusCents: 0,
        oldestOverdueDays: 0,
        lastReceiptAt: '',
        orderCount: 0,
      };
      if (row.lastReceiptAt > item.lastReceiptAt) item.lastReceiptAt = row.lastReceiptAt;
      if (row.outstandingCents > 0) {
        item.orderCount += 1;
        item.outstandingCents += row.outstandingCents;
        const dueDate = paymentDueDate(row.lastShippedAt, row.creditDays);
        const overdueDays = daysUntilDue(dueDate) ?? 0;
        item[bucketOf(overdueDays)] += row.outstandingCents;
        if (overdueDays < 0) {
          item.overdueCents += row.outstandingCents;
          item.oldestOverdueDays = Math.max(item.oldestOverdueDays, -overdueDays);
        }
      }
      groups.set(key, item);
    }
    const items = [...groups.values()].filter((item) => item.orderCount > 0).sort((left, right) => right.overdueCents - left.overdueCents || right.outstandingCents - left.outstandingCents);
    const totals = items.reduce((sum, item) => ({
      outstandingCents: sum.outstandingCents + item.outstandingCents,
      overdueCents: sum.overdueCents + item.overdueCents,
      notDueCents: sum.notDueCents + item.notDueCents,
      overdue30Cents: sum.overdue30Cents + item.overdue30Cents,
      overdue60Cents: sum.overdue60Cents + item.overdue60Cents,
      overdue90Cents: sum.overdue90Cents + item.overdue90Cents,
      overdue90PlusCents: sum.overdue90PlusCents + item.overdue90PlusCents,
      oldestOverdueDays: Math.max(sum.oldestOverdueDays, item.oldestOverdueDays),
    }), { outstandingCents: 0, overdueCents: 0, notDueCents: 0, overdue30Cents: 0, overdue60Cents: 0, overdue90Cents: 0, overdue90PlusCents: 0, oldestOverdueDays: 0 });
    return { items, totals };
  }

  statement(customerId: number, from: string, to: string): CustomerStatement {
    const balances = this.options.repositories.listCreditOrderBalances().filter((row) => row.customerId === customerId);
    const allReceipts = this.options.repositories.listCreditReceipts(customerId, '0000-01-01', '9999-12-31');
    const periodReceipts = allReceipts.filter((receipt) => receipt.receivedAt >= from && receipt.receivedAt <= to);
    const receiptsBefore = new Map<number, number>();
    for (const receipt of allReceipts) {
      if (receipt.receivedAt >= from) continue;
      receiptsBefore.set(receipt.orderId, (receiptsBefore.get(receipt.orderId) ?? 0) + receipt.amountCents);
    }

    let openingCents = 0;
    let overdueCents = 0;
    const orders: StatementOrderRow[] = [];
    let periodReceivableCents = 0;
    for (const row of balances) {
      const shippedDate = row.lastShippedAt.slice(0, 10);
      const dueDate = paymentDueDate(row.lastShippedAt, row.creditDays);
      const overdueDays = daysUntilDue(dueDate) ?? 0;
      if (row.outstandingCents > 0 && overdueDays < 0) overdueCents += row.outstandingCents;
      if (!shippedDate) continue;
      if (shippedDate < from) {
        // 账期前多收的钱是客户预存余额，期初应为负数并结转到本期；
        // 若在这里截断为 0，本期退还超收的负数收款会让期末未收虚增。
        openingCents += row.receivableCents - (receiptsBefore.get(row.orderId) ?? 0);
      } else if (shippedDate <= to) {
        periodReceivableCents += row.receivableCents;
        orders.push({
          orderId: row.orderId,
          orderNo: row.orderNo,
          lastShippedAt: row.lastShippedAt,
          dueDate,
          overdueDays: row.outstandingCents > 0 ? overdueDays : 0,
          receivableCents: row.receivableCents,
          receivedCents: row.receivedCents,
          outstandingCents: row.outstandingCents,
        });
      }
    }
    const periodReceiptCents = periodReceipts.reduce((sum, receipt) => sum + receipt.amountCents, 0);
    const customer = balances[0];
    return {
      customerId,
      customerName: customer?.customerName ?? '',
      creditLimitCents: customer?.creditLimitCents ?? 0,
      from,
      to,
      openingCents,
      periodReceivableCents,
      periodReceiptCents,
      closingCents: openingCents + periodReceivableCents - periodReceiptCents,
      overdueCents,
      orders,
      receipts: periodReceipts,
    };
  }
}
