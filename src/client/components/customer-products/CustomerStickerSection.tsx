import { useEffect, useState } from 'react';
import { FileDown } from 'lucide-react';
import {
  addStickerTransaction,
  getStickerLedger,
  type StickerLedger,
} from '../../api';
import type { CustomerProduct } from '../../../shared/customers';
import NumberField from '../NumberField';

export interface CustomerStickerSectionProps {
  product?: CustomerProduct | null;
  enabled: boolean;
  perSheet: number;
  onEnabledChange: (next: boolean) => void;
  onPerSheetChange: (next: number) => void;
  disabled?: boolean;
  /** 尚未保存的标贴附件：新建产品时刚添加的「标贴文件」PDF。 */
  pendingStickerFile?: { name: string; url: string } | null;
}

/** 客户产品的标贴设置：打印文件取自附件，设置每张数量、打印入库与手动调整；库存不足在备货页提醒。 */
export default function CustomerStickerSection({ product, enabled, perSheet, onEnabledChange, onPerSheetChange, disabled = false, pendingStickerFile = null }: CustomerStickerSectionProps) {
  const [ledger, setLedger] = useState<StickerLedger>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sheets, setSheets] = useState('');
  const [adjust, setAdjust] = useState('');
  const [note, setNote] = useState('');
  const productId = product?.id && product.id > 0 ? product.id : undefined;
  const savedPath = productId ? product?.stickerFileRelativePath ?? null : null;
  const savedAttachment = savedPath ? product?.attachments.find((attachment) => attachment.relativePath === savedPath) : undefined;
  const savedFile = savedPath ? { name: savedAttachment?.originalName || savedPath.split('/').pop() || '标贴 PDF', url: `/files/${savedPath}` } : null;
  const file = pendingStickerFile ?? savedFile;

  useEffect(() => {
    if (productId && enabled) void refreshLedger();
    // 打开编辑器就显示真实库存，切换贴标开关时也刷新一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, enabled]);

  const refreshLedger = async () => {
    if (!productId || !enabled) return;
    try {
      setLedger(await getStickerLedger(productId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '标贴库存加载失败');
    }
  };

  const register = async (kind: 'print' | 'adjust') => {
    if (!productId) return;
    setBusy(true);
    setError('');
    try {
      const next = kind === 'print'
        ? await addStickerTransaction(productId, { kind, sheets: Number(sheets) || 0, note: note.trim() })
        : await addStickerTransaction(productId, { kind, quantity: Number(adjust) || 0, note: note.trim() });
      setLedger(next);
      if (kind === 'print') setSheets('');
      else setAdjust('');
      setNote('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登记失败');
    } finally {
      setBusy(false);
    }
  };

  return <section className="cpe-sticker">
    <div className="cpe-sticker-head">
      <strong>标贴（机器商标）</strong>
      <label className="cpe-sticker-switch"><input type="checkbox" checked={enabled} disabled={disabled} onChange={(event) => { onEnabledChange(event.target.checked); if (event.target.checked) void refreshLedger(); }} />该产品需要贴标</label>
    </div>
    {error && <div className="cpe-sticker-error" role="alert">{error}</div>}
    {enabled && <>
      <div className="cpe-sticker-row">
        <label>每张标贴数量<NumberField min={0} integer ariaLabel="每张标贴数量" value={perSheet} onChange={onPerSheetChange} disabled={disabled} /></label>
        <div className="cpe-sticker-file">
          <span>标贴 PDF</span>
          {file ? <a href={file.url} target="_blank" rel="noreferrer" title="查看/下载标贴 PDF"><FileDown size={14} />{file.name}</a> : <em>未找到标贴附件</em>}
          {pendingStickerFile && <span className="cpe-sticker-badge">保存后生效</span>}
        </div>
      </div>
      <p className="cpe-sticker-file-note">标贴打印使用附件中最新上传的「标贴文件」PDF；没有标贴附件时继续使用历史单独上传的文件，更换请到附件管理。</p>
      {productId && <>
        <div className="cpe-sticker-stock">
          库存剩余
          <strong className={(ledger?.remaining ?? product?.stickerRemaining ?? 0) < 0 ? 'is-negative' : undefined}>{ledger?.remaining ?? product?.stickerRemaining ?? 0}</strong>
          张
          <span>已打 {ledger?.printed ?? 0} · 已用 {ledger?.consumed ?? 0}</span>
          <button type="button" className="link-button muted" onClick={() => void refreshLedger()}>刷新</button>
        </div>
        <div className="cpe-sticker-inline">
          <label>打印入库（张）<input className="input" type="text" inputMode="numeric" value={sheets} onChange={(event) => setSheets(event.target.value)} placeholder="本次打印几张" /></label>
          <label>手动调整（张，可负数）<input className="input" type="text" inputMode="numeric" value={adjust} onChange={(event) => setAdjust(event.target.value)} placeholder="如 -5" /></label>
          <label>备注<input className="input" type="text" value={note} onChange={(event) => setNote(event.target.value)} placeholder="选填" /></label>
          <button type="button" className="button button-secondary button-sm" disabled={busy || !sheets.trim()} onClick={() => void register('print')}>登记入库</button>
          <button type="button" className="button button-ghost button-sm" disabled={busy || !adjust.trim()} onClick={() => void register('adjust')}>调整库存</button>
        </div>
        {!!ledger?.transactions.length && <div className="cpe-sticker-history">
          {ledger.transactions.slice(0, 6).map((row) => <div key={row.id}>
            <span>{row.createdAt.replace('T', ' ').slice(0, 16)}</span>
            <span className={row.quantity < 0 ? 'is-negative' : 'is-positive'}>{row.quantity > 0 ? `+${row.quantity}` : row.quantity} 张</span>
            <span>{row.kind === 'print' ? `打印 ${row.sheets ?? '—'} 张 × ${row.perSheet ?? '—'}` : row.kind === 'consume' ? '完成打包扣减' : '手动调整'}</span>
            <span title={row.note}>{row.note || ''}</span>
          </div>)}
        </div>}
      </>}
    </>}
  </section>;
}
