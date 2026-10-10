import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from './connection.js';
import type { PricePlanItem } from '../../shared/price-calculator.js';

/** 算价方案：每次保存新增一条历史；明细行为快照，回看不受后续产品资料变化影响。 */
export interface PricePlanRecord {
  id: number;
  productId: number;
  name: string;
  markupPercent: number;
  totalCost: number;
  salePrice: number;
  targetPrice: number | null;
  createdAt: string;
  items: Array<{ id: number; name: string; qty: number; unitPrice: number; amount: number }>;
}

export class PricePlanRepository {
  constructor(private readonly database: DatabaseSync) {}

  /** 某产品的全部方案，按保存时间倒序（最新在前）。 */
  listForProduct(productId: number): PricePlanRecord[] {
    const plans = this.database
      .prepare(
        `SELECT id, product_id, name, markup_percent, total_cost, sale_price, target_price, created_at
         FROM product_price_plans WHERE product_id = ? ORDER BY created_at DESC, id DESC`,
      )
      .all(productId) as Array<Record<string, unknown>>;
    if (!plans.length) return [];
    const planIds = plans.map((plan) => Number(plan.id));
    const rows = this.database
      .prepare(
        `SELECT id, plan_id, name, qty, unit_price, amount FROM product_price_plan_items
         WHERE plan_id IN (${planIds.map(() => '?').join(', ')}) ORDER BY sort_order, id`,
      )
      .all(...planIds) as Array<Record<string, unknown>>;
    const itemsByPlan = new Map<number, PricePlanRecord['items']>();
    for (const row of rows) {
      const planId = Number(row.plan_id);
      const list = itemsByPlan.get(planId) ?? [];
      list.push({
        id: Number(row.id),
        name: String(row.name),
        qty: Number(row.qty),
        unitPrice: Number(row.unit_price),
        amount: Number(row.amount),
      });
      itemsByPlan.set(planId, list);
    }
    return plans.map((plan) => ({
      id: Number(plan.id),
      productId: Number(plan.product_id),
      name: String(plan.name ?? ''),
      markupPercent: Number(plan.markup_percent ?? 0),
      totalCost: Number(plan.total_cost ?? 0),
      salePrice: Number(plan.sale_price ?? 0),
      targetPrice: plan.target_price == null ? null : Number(plan.target_price),
      createdAt: String(plan.created_at),
      items: itemsByPlan.get(Number(plan.id)) ?? [],
    }));
  }

  create(input: {
    productId: number;
    name: string;
    markupPercent: number;
    totalCost: number;
    salePrice: number;
    targetPrice: number | null;
    items: PricePlanItem[];
    createdAt: string;
  }): PricePlanRecord {
    return withTransaction(this.database, (database) => {
      const result = database
        .prepare(
          `INSERT INTO product_price_plans (product_id, name, markup_percent, total_cost, sale_price, target_price, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.productId, input.name, input.markupPercent, input.totalCost, input.salePrice, input.targetPrice, input.createdAt);
      const planId = Number(result.lastInsertRowid);
      const insertItem = database.prepare(
        `INSERT INTO product_price_plan_items (plan_id, name, qty, unit_price, amount, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      input.items.forEach((item, index) => insertItem.run(planId, item.name, item.qty, item.unitPrice, item.amount, index));
      return this.listForProduct(input.productId).find((plan) => plan.id === planId)!;
    });
  }

  /** 只允许删本产品的方案；返回是否真的删掉了。 */
  delete(id: number, productId: number): boolean {
    const result = this.database.prepare('DELETE FROM product_price_plans WHERE id = ? AND product_id = ?').run(id, productId);
    return Number(result.changes ?? 0) > 0;
  }
}
