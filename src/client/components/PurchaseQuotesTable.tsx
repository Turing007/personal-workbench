import { Plus, Trash2 } from 'lucide-react';
import {
  PURCHASE_QUOTE_LIMIT,
  blankPurchaseQuote,
  purchaseQuoteLabel,
  type ProductPurchaseQuote,
} from '../../shared/product-purchase-quotes';

export interface PurchaseQuotesTableProps {
  value: ProductPurchaseQuote[];
  onChange: (next: ProductPurchaseQuote[]) => void;
  /** 候选来自库里已用过的供应商 / 名目，也允许直接新填。 */
  supplierOptions: string[];
  variantOptions: string[];
}

/**
 * 产品的多档采购报价。数组里只有一份事实：默认档的供应商与价格会写回
 * products.supplier / purchase_price，产品库列表价格与客户产品成本价都取它。
 */
export default function PurchaseQuotesTable({ value, onChange, supplierOptions, variantOptions }: PurchaseQuotesTableProps) {
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
          <thead><tr>{['供应商', '名目 / 款式', '采购价', '默认档', ''].map((title) => <th key={title}>{title}</th>)}</tr></thead>
          <tbody>{value.map((row) => <tr key={row.id}>
            <td className="packaging-table-col-size">
              <input className="input packaging-table-input" aria-label="报价供应商" list="purchase-quote-suppliers" value={row.supplier} onChange={(event) => update(row.id, { supplier: event.target.value })} placeholder="德艺堡" />
            </td>
            <td className="packaging-table-col-size">
              <input className="input packaging-table-input" aria-label="报价名目" list="purchase-quote-variants" value={row.variant} onChange={(event) => update(row.id, { variant: event.target.value })} placeholder="含配件 / 无刷款" />
            </td>
            <td className="packaging-table-col-price">
              <input className="input packaging-table-input" type="number" min={0} step="0.01" aria-label="报价采购价" value={row.price} onChange={(event) => update(row.id, { price: event.target.value })} placeholder="元" />
            </td>
            <td>
              <button
                className={row.isDefault ? 'purchase-quote-default is-on' : 'purchase-quote-default'}
                type="button"
                aria-pressed={row.isDefault}
                title={row.isDefault ? '当前是默认档' : `把「${purchaseQuoteLabel(row)}」设为默认档`}
                onClick={() => setDefault(row.id)}
              >{row.isDefault ? '默认档' : '设为默认'}</button>
            </td>
            <td className="packaging-table-col-actions">
              <button className="icon-button danger" type="button" title="删除这条报价" onClick={() => onChange(value.filter((entry) => entry.id !== row.id))}><Trash2 size={14} /></button>
            </td>
          </tr>)}</tbody>
        </table>
        <datalist id="purchase-quote-suppliers">{supplierOptions.map((option) => <option key={option} value={option} />)}</datalist>
        <datalist id="purchase-quote-variants">{variantOptions.map((option) => <option key={option} value={option} />)}</datalist>
      </div> : <div className="empty-state">还没有采购报价。填一条即可，第一行会自动作为默认档。</div>}
      <p className="purchase-quotes-hint">默认档就是产品库列表上的价格，也是新建客户产品时带过去的成本价；其余档在详情里按供应商分组查看。</p>
    </div>
  );
}
