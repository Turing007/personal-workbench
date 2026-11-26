import { useEffect, useRef, useState } from 'react';
import type { CustomerProduct } from '../../../shared/customers';
import { updateCustomerProductStickerSettings } from '../../api';
import Modal from '../Modal';
import type { ToastKind } from '../OrderForm';
import CustomerStickerSection from './CustomerStickerSection';

export interface CustomerProductStickerModalProps {
  open: boolean;
  product?: CustomerProduct;
  onClose: () => void;
  /** 设置或库存变化后刷新页面列表。 */
  onChanged: () => void;
  onNotify: (message: string, kind?: ToastKind) => void;
}

/** 标贴管理弹窗：开关、每张数量即时保存；库存流水沿用编辑页的标贴区。 */
export default function CustomerProductStickerModal({ open, product, onClose, onChanged, onNotify }: CustomerProductStickerModalProps) {
  const [enabled, setEnabled] = useState(false);
  const [perSheet, setPerSheet] = useState(0);
  // 连续输入/连点时按顺序写，避免慢请求用旧值覆盖新值。
  const queue = useRef(Promise.resolve());

  useEffect(() => {
    if (!open || !product) return;
    setEnabled(Boolean(product.stickerEnabled));
    setPerSheet(product.stickerPerSheet ?? 0);
    // 只在打开或换产品时回填，保存后的刷新不打断正在输入的值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  const persist = (nextEnabled: boolean, nextPerSheet: number) => {
    if (!product) return;
    queue.current = queue.current
      .then(() => updateCustomerProductStickerSettings(product.id, { stickerEnabled: nextEnabled, stickerPerSheet: nextPerSheet }))
      .then(() => onChanged())
      .catch((error) => onNotify(error instanceof Error ? error.message : '标贴设置保存失败', 'error'));
  };

  return <Modal
    open={open}
    title={product ? `标贴管理 · ${product.name}` : '标贴管理'}
    width={760}
    compact
    onClose={() => { onChanged(); onClose(); }}
  >
    {product && <div className="cpe-quick-modal">
      <CustomerStickerSection
        key={product.id}
        product={product}
        enabled={enabled}
        perSheet={perSheet}
        onEnabledChange={(next) => { setEnabled(next); persist(next, perSheet); }}
        onPerSheetChange={(next) => { setPerSheet(next); persist(enabled, next); }}
      />
      <p className="cpe-modal-hint">开关和每张数量即时保存；打印入库、手动调整立即影响库存。关闭后列表数字自动刷新。</p>
    </div>}
  </Modal>;
}
