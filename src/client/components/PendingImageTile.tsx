import { Image as ImageIcon, RefreshCw } from 'lucide-react';
import type { UploadFileSnapshot } from '../product-upload-queue';
import { PRODUCT_IMAGE_CATEGORY_LABELS, normalizeProductImageCategory } from '../../shared/product-image-categories';

export interface PendingImageTileProps {
  item: UploadFileSnapshot;
  /** 卡片 / 详情里的小尺寸：只留预览图和进度条。 */
  compact?: boolean;
  /** 单项重试入口（图片弹窗里的失败项才给按钮）。 */
  onRetry?: (taskId: string) => void;
}

function statusLabel(item: UploadFileSnapshot): string {
  if (item.status === 'queued') return '排队中';
  if (item.status === 'uploading') return item.progress === undefined ? '上传中' : `${item.progress}%`;
  if (item.status === 'done') return '已完成';
  return '失败';
}

/**
 * 图下一条进度：正常走 0-100% 宽度，总大小未知或排队中走流动动画。
 * 失败标红、完成标绿 —— 颜色跟着状态走，不用再看文字确认。
 */
function UploadBar({ item }: { item: UploadFileSnapshot }) {
  const indeterminate = item.progress === undefined && (item.status === 'queued' || item.status === 'uploading');
  const width = item.status === 'done' || item.status === 'failed' ? 100 : item.progress ?? 0;
  return (
    <span
      className={`upload-tile-bar is-${item.status}${indeterminate ? ' is-indeterminate' : ''}`}
      role="progressbar"
      aria-label="上传进度"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(indeterminate ? {} : { 'aria-valuenow': width })}
    >
      <span className="upload-tile-bar-fill" style={indeterminate ? undefined : { width: `${width}%` }} />
    </span>
  );
}

/** 后台上传中的图片占位：本地预览 + 图下进度条，传完由正式图片顶掉。 */
export default function PendingImageTile({ item, compact = false, onRetry }: PendingImageTileProps) {
  const failed = item.status === 'failed';
  return (
    <div className={`product-upload-tile is-${item.status}${compact ? ' is-compact' : ''}`}>
      <span className="product-upload-tile-image">
        {item.previewUrl
          ? <img src={item.previewUrl} alt="" />
          : <span className="product-upload-tile-placeholder"><ImageIcon size={18} /></span>}
        {!compact && <span className="product-upload-tile-category">{PRODUCT_IMAGE_CATEGORY_LABELS[normalizeProductImageCategory(item.category)]}</span>}
      </span>
      <UploadBar item={item} />
      {!compact && (failed ? (
        <span className="product-upload-tile-error">
          <span className="product-upload-tile-error-text" title={item.message ?? '上传失败'}>失败：{item.message ?? '上传失败'}</span>
          {onRetry && <button type="button" className="button button-secondary button-sm product-upload-tile-retry" onClick={() => onRetry(item.id)}><RefreshCw size={12} />重试</button>}
        </span>
      ) : (
        <span className="product-upload-tile-meta">
          <span className="product-upload-tile-name" title={item.fileName}>{item.fileName}</span>
          <span className="product-upload-tile-status">{statusLabel(item)}</span>
        </span>
      ))}
      {compact && failed && <span className="product-upload-tile-compact-error">上传失败</span>}
    </div>
  );
}
