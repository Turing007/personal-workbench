import type { DatabaseSync } from 'node:sqlite';

export interface StockPreparationRow extends Record<string, unknown> {
  order_id: number;
  order_no: string;
  customer_name: string;
  ordered_at: string;
  order_item_id: number;
  quantity: number;
  item_remark: string;
  item_name: string;
  item_specification: string;
  customer_product_id: number | null;
  supplier_product_name: string | null;
  product_id: number | null;
  product_name: string | null;
  product_supplier: string | null;
}

export class StockRepository {
  constructor(private readonly database: DatabaseSync) {}

  /** 待备货订单的全部明细行（含未关联客户产品的行），date 为 YYYY-MM-DD 时按下单日期过滤。 */
  listPendingStockItems(date?: string): StockPreparationRow[] {
    const clauses = ["o.status = 'pending_stock'"];
    const parameters: Array<string | number> = [];
    if (date) {
      clauses.push('substr(o.ordered_at, 1, 10) = ?');
      parameters.push(date);
    }
    return this.database.prepare(`
      SELECT
        o.id AS order_id,
        o.order_no AS order_no,
        o.customer_name AS customer_name,
        o.ordered_at AS ordered_at,
        oi.id AS order_item_id,
        oi.quantity AS quantity,
        oi.remark AS item_remark,
        oi.name AS item_name,
        oi.specification AS item_specification,
        cp.id AS customer_product_id,
        cp.supplier_product_name AS supplier_product_name,
        p.id AS product_id,
        p.name AS product_name,
        p.supplier AS product_supplier
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN customer_products cp ON cp.id = oi.customer_product_id
      LEFT JOIN products p ON p.id = cp.system_product_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY o.ordered_at, o.id, oi.sort_order, oi.id
    `).all(...parameters) as StockPreparationRow[];
  }
}
