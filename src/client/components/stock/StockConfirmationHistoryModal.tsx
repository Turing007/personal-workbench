import { History, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { StockConfirmation } from '../../../shared/stock';
import { getStockConfirmations } from '../../api';
import Modal from '../Modal';

export interface StockConfirmationHistoryModalProps {
  open: boolean;
  onClose: () => void;
}

function errorText(error: unknown, fallback: string): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : fallback;
}

function scopeLabel(scope: string): string {
  return scope === 'all' ? '全部待备货' : scope;
}

function channelLabel(channel: string): string {
  if (channel === 'online') return '线上';
  if (channel === 'offline') return '线下';
  return '全部渠道';
}

function formatTime(value: string): string {
  return value.replace('T', ' ').slice(0, 16);
}

function itemLine(item: StockConfirmation['items'][number]): string {
  const specs = item.specs.length
    ? item.specs.map((spec) => `${spec.specification ? `${spec.specification} × ` : '× '}${spec.quantity}`).join('，')
    : `× ${item.quantity}`;
  return `${item.displayName}（${specs}）`;
}

/** 备货确认历史：订单推进到已备货后，仍可查看当时由谁、何时、确认了哪些产品和订单。 */
export default function StockConfirmationHistoryModal({ open, onClose }: StockConfirmationHistoryModalProps) {
  const [items, setItems] = useState<StockConfirmation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await getStockConfirmations({ limit: 100 }));
    } catch (reason) {
      setError(errorText(reason, '读取确认记录失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return <Modal open={open} title="备货确认记录" onClose={onClose} width={820}>
    <div className="stock-confirm-history">
      <div className="stock-confirm-history-head">
        <div>
          <strong>供应商确认留痕</strong>
          <span>记录确认人、时间、备货范围与当时的产品和订单；只追加，不会随订单推进而消失。</span>
        </div>
        <button className="button button-secondary button-sm" type="button" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2 size={14} /> : <RefreshCw size={14} />}
          {loading ? '读取中…' : '刷新'}
        </button>
      </div>

      {error && <div className="notice notice-danger">{error}</div>}
      {loading && !items.length && <div className="table-state"><Loader2 size={15} />正在读取确认记录…</div>}
      {!loading && !items.length && !error && <div className="table-state">暂无供应商确认记录。在备货表点供应商卡片上的「确认备货」后会在这里留下记录。</div>}

      {items.map((item) => <article key={item.id} className="stock-confirm-record">
        <header>
          <div>
            <strong>{item.supplier}</strong>
            <span>{formatTime(item.confirmedAt)}{item.confirmedBy ? ` · ${item.confirmedBy}` : ''}</span>
          </div>
          <span className="badge badge-neutral">{scopeLabel(item.scope)} · {channelLabel(item.channel)}</span>
        </header>
        <p>
          产品 {item.itemCount} 项 · 合计 {item.totalQuantity} 件 · 涉及订单 {item.orders.length} 张
          {item.note ? ` · 备注：${item.note}` : ''}
        </p>
        <details>
          <summary><History size={13} />查看明细</summary>
          <div className="stock-confirm-record-lines">
            {item.items.map((entry, index) => <span key={`${entry.displayName}-${index}`}>{itemLine(entry)}</span>)}
            {!item.items.length && <span>未保存产品明细</span>}
          </div>
          <div className="stock-confirm-record-orders">
            {item.orders.map((order) => <span key={order.orderId}>
              {order.orderNo || `订单 #${order.orderId}`}{order.advanced ? '' : '（未推进）'}
            </span>)}
            {!item.orders.length && <span>未保存订单明细</span>}
          </div>
        </details>
      </article>)}
    </div>
  </Modal>;
}
