import { Plus, Trash2 } from 'lucide-react';
import {
  PURCHASE_QUOTE_LIMIT,
  blankPurchaseQuote,
  type ProductPurchaseQuote,
} from '../../shared/product-purchase-quotes';

export interface PurchaseQuotesTableProps {
  value: ProductPurchaseQuote[];
  onChange: (next: ProductPurchaseQuote[]) => void;
}

/**
 * 产品的多档采购报价。数组里只有一份事实：默认档的供应商与价格会写回
 * products.supplier / purchase_price，产品库列表价格与客户产品成本价都取它。
 */
export default function PurchaseQuotesTable({ value, onChange }: PurchaseQuotesTableProps) {
  const update = (id: string, patch: Partial<ProductPurchaseQuote>) =>
    onChange(value.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const setDefault = (id: string) => onChange(value.map((row) => ({ ...row, isDefault: row.id === id })));
  const add = () => {
    const fresh = blankPurchaseQuote();
    // 第一条自动当默认档，避免出现「有报价但没有默认价」。
    onChange([...value, { ...fresh, isDefault: !value.length }]);
  };
  const atLimit = value.length >= PURCHASE_QUOTE_LIMIT;

  return (
    <div className="packaging-table-section purchase-quotes-section">
      <div className="section-box-header">
        <span className="section-box-title">采购报价</span>
        <button className="link-button packaging-table-add" type="button" disabled={atLimit} title={atLimit ? `最多 ${PURCHASE_QUOTE_LIMIT} 条报价` : '添加一条采购报价'} onClick={add}>
          <Plus size={14} />添加报价
        </button>
      </div>
      {value.length ? <div className="packaging-table-shell">
        <table className="packaging-table purchase-quotes-table">
          <thead><tr>{['供应商', '名目 / 款式', '采购价', ''].map((title, index) => <th key={index}>{title}</th>)}</tr></thead>
          <tbody>{value.map((row) => <tr key={row.id}>
            <td className="packaging-table-col-size">
              {/* 点供应商输入框即把该档设为默认（高亮那格）；替代原来的「默认档」按钮列。 */}
              <input
                className={`input packaging-table-input${row.isDefault ? ' is-default-quote' : ''}`}
                aria-label="报价供应商"
                value={row.supplier}
                placeholder="德艺堡"
                title={row.isDefault ? '当前是默认档：产品库列表价取这一档' : '点一下设为默认档'}
                onChange={(event) => update(row.id, { supplier: event.target.value })}
                onClick={() => setDefault(row.id)}
              />
            </td>
            <td className="packaging-table-col-size">
              <input className="input packaging-table-input" aria-label="报价名目" value={row.variant} onChange={(event) => update(row.id, { variant: event.target.value })} placeholder="含配件 / 无刷款" />
            </td>
            <td className="packaging-table-col-price">
              <input className="input packaging-table-input" type="number" min={0} step="0.01" aria-label="报价采购价" value={row.price} onChange={(event) => update(row.id, { price: event.target.value })} placeholder="元" />
            </td>
            <td className="packaging-table-col-actions">
              <button className="icon-button danger" type="button" title="删除这条报价" onClick={() => onChange(value.filter((entry) => entry.id !== row.id))}><Trash2 size={14} /></button>
            </td>
          </tr>)}</tbody>
        </table>
      </div> : <div className="empty-state">还没有采购报价。填一条即可，第一行会自动作为默认档。</div>}
      <p className="purchase-quotes-hint">点供应商输入框把该档设为默认（高亮那格）；默认档就是产品库列表上的价格，也是新建客户产品时带过去的成本价；其余档在详情里按供应商分组查看。</p>
    </div>
  );
}
