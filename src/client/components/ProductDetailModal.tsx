import { Calculator, Check, Copy, Download, ExternalLink, FileText, Image, Package, Play, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import Modal from './Modal';
import { getCategoryAccessoryPrices } from '../api';
import type { AccessoryPrice } from '../../shared/accessory-prices';
import PendingImageTile from './PendingImageTile';
import ProductImagesModal from './ProductImagesModal';
import VideoPlayerModal from './VideoPlayerModal';
import { formatFileSize, type ProductRecord, type ProductVideo } from './ProductEditor';
import type { UploadFileSnapshot } from '../product-upload-queue';
import { packagingDisplay } from '../packaging-display';
import { groupPurchaseQuotesBySupplier, purchaseQuoteLabel } from '../../shared/product-purchase-quotes';
import { copyText } from '../copy-text';
import { thumbUrl } from '../image-urls';
import {
  PRODUCT_IMAGE_CATEGORY_LABELS,
  PRODUCT_IMAGE_CATEGORY_SEQUENCE,
  normalizeProductImageCategory,
  type ProductImageCategory,
} from '../../shared/product-image-categories';

export interface ProductDetailModalProps {
  open: boolean;
  product?: ProductRecord;
  /** 供应商与采购价默认隐藏，跟随产品库工具条上的小眼睛按钮。 */
  showSensitive?: boolean;
  /** 还在后台上传的图：详情里先给预览和进度，点开看全部图片时逐张可见。 */
  pendingImages?: UploadFileSnapshot[];
  onClose: () => void;
  onOpenImages: (product: ProductRecord) => void;
  /** 售价计算入口（看详情时顺手算）；未传则不显示按钮。 */
  onOpenCalculator?: (product: ProductRecord) => void;
  /** 停售 / 恢复在售；未传则不显示按钮。 */
  onUpdateSaleStatus?: (product: ProductRecord, next: 'active' | 'discontinued') => void;
  /** 删除产品入口从列表挪到了这里，属于不可逆操作，未传则不显示。 */
  onDelete?: (product: ProductRecord) => void;
}

function packagingDetails(item: ProductRecord['packaging'][number]) {
  const display = packagingDisplay(item);
  return {
    ...display,
  };
}

const attachmentCategoryLabels: Record<ProductRecord['attachments'][number]['category'], string> = {
  manual: '电子说明书',
  'packaging-design': '包装设计图',
  'label-dieline': '标贴刀模',
  other: '其他附件',
};

function DetailItem({ label, children, fullWidth = false }: { label: string; children: ReactNode; fullWidth?: boolean }) {
  return (
    <div className={fullWidth ? 'product-detail-item product-detail-item-wide kv-item' : 'product-detail-item kv-item'}>
      <span className="product-detail-label kv-label">{label}</span>
      <div className="product-detail-value">{children}</div>
    </div>
  );
}

export default function ProductDetailModal({ open, product, showSensitive = false, pendingImages = [], onClose, onOpenImages, onOpenCalculator, onUpdateSaleStatus, onDelete }: ProductDetailModalProps) {
  const [copied, setCopied] = useState(false);
  const [copiedPackagingId, setCopiedPackagingId] = useState<string>();
  const [packagingImages, setPackagingImages] = useState<{ name: string; images: ProductRecord['packaging'][number]['images'] }>();
  const [playingVideo, setPlayingVideo] = useState<ProductVideo>();
  const [categoryAccessories, setCategoryAccessories] = useState<AccessoryPrice[]>([]);
  const detailCategory = (product?.category ?? '').trim();
  // 「配件」行显示本类目配件清单（同类目共用，编辑器里维护）。
  useEffect(() => {
    if (!open || !detailCategory) {
      setCategoryAccessories([]);
      return;
    }
    let cancelled = false;
    getCategoryAccessoryPrices(detailCategory)
      .then((items) => { if (!cancelled) setCategoryAccessories(items.filter((item) => item.name.trim())); })
      .catch(() => { if (!cancelled) setCategoryAccessories([]); });
    return () => { cancelled = true; };
  }, [open, detailCategory]);
  if (!product) return null;

  const parameters = product.parameters ?? '';
  const purchaseQuotes = product.purchaseQuotes ?? [];
  const image = product.images[0];
  const pendingFailedCount = pendingImages.filter((item) => item.status === 'failed').length;
  // 按分类汇总图片数量，方便一眼看出这个产品有没有尺寸图/客拍图可复用。
  const imageCategoryCounts = product.images.reduce((counts, item) => {
    const category = normalizeProductImageCategory(item.category);
    counts.set(category, (counts.get(category) ?? 0) + 1);
    return counts;
  }, new Map<ProductImageCategory, number>());
  const imageCategorySummary = PRODUCT_IMAGE_CATEGORY_SEQUENCE
    .filter((category) => imageCategoryCounts.has(category))
    .map((category) => `${PRODUCT_IMAGE_CATEGORY_LABELS[category]} ${imageCategoryCounts.get(category) ?? 0}`);
  const copyParameters = async () => {
    if (!parameters.trim()) return;
    if (!await copyText(parameters)) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  // 停售与删除只放在详情弹窗里：列表点开的概率高，误操作的机会也多。
  const detailTitle = product.name || product.sku || '未命名产品';
  const footer = <>
    {onOpenCalculator && <button className="button button-secondary" type="button" title="算这款产品的成本与建议售价" onClick={() => onOpenCalculator(product)}><Calculator size={14} />售价计算</button>}
    {product.status === 'discontinued'
      ? onUpdateSaleStatus && <button className="button button-primary" type="button" onClick={() => { onUpdateSaleStatus(product, 'active'); onClose(); }}>恢复在售</button>
      : onUpdateSaleStatus && product.status !== 'draft' && <button className="button button-secondary" type="button" title="停售后不再出现在新建报价与销售开单的产品选择里" onClick={() => { if (window.confirm(`确定把「${detailTitle}」标为停售吗？资料与图片都保留，随时可以恢复在售。`)) { onUpdateSaleStatus(product, 'discontinued'); onClose(); } }}>停售</button>}
    {onDelete && <button className="button button-danger" type="button" onClick={() => { if (window.confirm(`确定删除产品「${detailTitle}」吗？图片、包装与附件会一并删除，不能恢复。`)) { onDelete(product); onClose(); } }}>删除产品</button>}
  </>;
  const copyPackaging = async (item: ProductRecord['packaging'][number]) => {
    const details = packagingDetails(item);
    const text = [
      `名称：${details.name}`,
      `内盒尺寸：${details.innerSize}`,
      `内盒重量：${details.innerWeight}`,
      `外箱尺寸：${details.outerSize}`,
      `外箱重量：${details.outerWeight}`,
      `装箱数量：${details.count}`,
    ].join('\n');
    const copied = await copyText(text);
    setCopiedPackagingId(copied ? item.id : undefined);
    if (copied) window.setTimeout(() => setCopiedPackagingId((current) => current === item.id ? undefined : current), 1600);
  };

  return (
    <Modal open={open} className="product-detail-modal" title={`产品详情 · ${product.sku || product.name || '未命名产品'}`} onClose={onClose} width={760} footer={footer}>
      <div className="product-detail-content">
        <div className="product-detail-grid kv-grid">
          <DetailItem label="SKU"><span className="product-detail-emphasis kv-value is-accent">{product.sku || '—'}</span></DetailItem>
          <DetailItem label="品名">{product.name || '—'}</DetailItem>
          <DetailItem label="颜色">{product.colors.join('、') || '—'}</DetailItem>
          <DetailItem label="插脚">{product.batteryPlugs.join('、') || '—'}</DetailItem>
          {showSensitive && !!purchaseQuotes.length && <DetailItem label="采购报价" fullWidth>
            <div className="product-detail-quotes">
              {groupPurchaseQuotesBySupplier(purchaseQuotes).map((group) => <div className="product-detail-quote-group" key={group.supplier}>
                <span className="product-detail-quote-supplier">{group.supplier}</span>
                <span className="product-detail-quote-items">{group.quotes.map((quote) => <span className={quote.isDefault ? 'product-detail-quote is-default' : 'product-detail-quote'} key={quote.id}>
                  <b>{purchaseQuoteLabel(quote)}</b>
                  <span>{quote.price ? `¥${quote.price}` : '未定价'}</span>
                  {quote.isDefault && <em>默认</em>}
                </span>)}</span>
              </div>)}
            </div>
          </DetailItem>}
          <DetailItem label={`配件${detailCategory ? `（${detailCategory} · 同类目共用）` : ''}`} fullWidth>
            {categoryAccessories.length
              ? <div className="product-detail-accessory-lines">{categoryAccessories.map((item) => (
                <span key={item.id}>{item.name}{item.price > 0 ? ` ¥${item.price.toFixed(2)}` : ''}</span>
              ))}</div>
              : '—'}
          </DetailItem>
          <DetailItem label="备注" fullWidth>{product.remark || '—'}</DetailItem>
          <DetailItem label="图片" fullWidth>
            {image || pendingImages.length ? (
              <div className="product-detail-images">
                <button className="product-detail-images-button" type="button" onClick={() => onOpenImages(product)}>
                  {image
                    ? <img src={thumbUrl(image.url, 240)} alt={image.name} loading="lazy" decoding="async" />
                    : <PendingImageTile item={pendingImages[0]} compact />}
                  <span><Image size={13} />查看全部 {product.images.length + pendingImages.length} 张图片{pendingImages.length ? `（${pendingImages.length} 张上传中${pendingFailedCount ? `，${pendingFailedCount} 张失败` : ''}）` : ''}</span>
                </button>
                {imageCategorySummary.length > 1 && <span className="product-detail-images-summary">{imageCategorySummary.join(' · ')}</span>}
              </div>
            ) : <span>暂无图片</span>}
          </DetailItem>
          <DetailItem label="产品视频" fullWidth>
            {product.videos?.length ? <div className="product-video-list">{product.videos.map((video) => (
              <div className="product-video-row" key={video.id}>
                <Video size={15} />
                <span className="product-video-name" title={video.name}>{video.name}</span>
                <span className="product-video-size">{formatFileSize(video.size)}</span>
                <button type="button" className="icon-button" title="播放视频" aria-label={`播放 ${video.name}`} onClick={() => setPlayingVideo(video)}><Play size={14} /></button>
              </div>
            ))}</div> : <div className="product-detail-muted">暂无视频</div>}
          </DetailItem>
          <DetailItem label="参数" fullWidth>
            <div className="product-detail-parameter-wrap">
              <div className={parameters ? 'product-detail-parameters' : 'product-detail-muted'}>{parameters || '暂无参数'}</div>
              {parameters && <button className="icon-button product-copy-button" type="button" title={copied ? '已复制参数' : '复制参数'} onClick={() => void copyParameters()}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>}
            </div>
          </DetailItem>
          <DetailItem label="包装信息" fullWidth>
            {product.packaging.length ? <div className="product-detail-packaging-list">{product.packaging.map((item) => {
              const details = packagingDetails(item);
              return <div className="product-detail-packaging-row" key={item.id}>
                <strong>{details.name}{details.price ? `--${details.price}` : ''}<button className="icon-button product-packaging-copy-button" type="button" title={copiedPackagingId === item.id ? '已复制包装详情' : '复制包装详情'} onClick={() => void copyPackaging(item)}>{copiedPackagingId === item.id ? <Check size={13} /> : <Copy size={13} />}</button></strong>
                <span>内盒：{details.innerSize} {details.innerWeight}</span><span>外箱：{details.outerSize} {details.outerWeight}</span><span>装箱：{details.count}</span>
                {!!item.images?.length && <button className="product-packaging-image-link" type="button" onClick={() => setPackagingImages({ name: item.name || '包装', images: item.images ?? [] })}><Image size={13} />查看图片 {item.images.length} 张</button>}
              </div>;
            })}</div> : <div className="product-detail-muted">暂无包装信息</div>}
          </DetailItem>
          <DetailItem label="产品附件" fullWidth>
            {product.attachments.length ? <div className="product-detail-attachments">{product.attachments.map((attachment) => <div className="product-detail-attachment-row" key={attachment.id}>
              <FileText size={15} />
              <span className="product-detail-attachment-name" title={attachment.name}>{attachment.name}</span>
              <span className="product-detail-attachment-category">{attachmentCategoryLabels[attachment.category]}</span>
              {attachment.url && <><a href={attachment.url} target="_blank" rel="noreferrer" title="打开附件"><ExternalLink size={14} /></a><a href={attachment.url} download={attachment.name} title="下载附件"><Download size={14} /></a></>}
            </div>)}</div> : <div className="product-detail-muted">暂无附件</div>}
          </DetailItem>
        </div>
        <div className="product-detail-hint"><Package size={14} />这里可以查看资料、停售或恢复在售；要改内容请用编辑按钮。</div>
      </div>
      <ProductImagesModal open={Boolean(packagingImages)} productName={packagingImages?.name ?? '包装'} images={packagingImages?.images ?? []} onClose={() => setPackagingImages(undefined)} />
      <VideoPlayerModal open={Boolean(playingVideo)} title={playingVideo?.name} src={playingVideo?.url} onClose={() => setPlayingVideo(undefined)} />
    </Modal>
  );
}
