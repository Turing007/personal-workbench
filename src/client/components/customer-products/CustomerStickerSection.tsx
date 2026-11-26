import { useEffect, useState } from 'react';
import { FileDown, Loader2, Upload } from 'lucide-react';
import {
  addStickerTransaction,
  deleteCustomerProductSticker,
  getStickerLedger,
  uploadCustomerProductSticker,
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
}

/** 客户产品的标贴设置：PDF 原始文件、每张数量、打印入库与手动调整；库存不足在备货页提醒。 */
export default function CustomerStickerSection({ product, enabled, perSheet, onEnabledChange, onPerSheetChange, disabled = false }: CustomerStickerSectionProps) {
  const [ledger, setLedger] = useState<StickerLedger>();
  const [filePath, setFilePath] = useState<string | null>(product?.stickerFileRelativePath ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sheets, setSheets] = useState('');
  const [adjust, setAdjust] = useState('');
  const [note, setNote] = useState('');
  const productId = product?.id;

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

  const upload = async (file: File | undefined) => {
    if (!file || !productId) return;
    setBusy(true);
    setError('');
    try {
      const saved = await uploadCustomerProductSticker(productId, file);
      setFilePath(saved.stickerFileRelativePath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '标贴 PDF 上传失败');
    } finally {
      setBusy(false);
    }
  };

  const removeFile = async () => {
    if (!productId || !window.confirm('确定删除该产品的标贴 PDF 吗？库存记录会保留。')) return;
    setBusy(true);
    try {
      const saved = await deleteCustomerProductSticker(productId);
      setFilePath(saved.stickerFileRelativePath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败');
    } finally {
      setBusy(false);
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
          {filePath ? <a href={`/files/${filePath}`} target="_blank" rel="noreferrer" title="下载原始打印文件"><FileDown size={14} />下载 / {filePath.split('/').pop()}</a> : <em>未上传</em>}
          {productId ? <label className="button button-secondary button-sm cpe-sticker-upload">
            {busy ? <Loader2 size={13} className="spin" /> : <Upload size={13} />}{filePath ? '替换 PDF' : '上传 PDF'}
            <input type="file" accept="application/pdf" hidden disabled={busy} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
          </label> : <em>保存产品后可上传</em>}
          {filePath && productId && <button type="button" className="link-button muted" disabled={busy} onClick={() => void removeFile()}>删除 PDF</button>}
        </div>
      </div>
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
