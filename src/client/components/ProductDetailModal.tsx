import { Check, Copy, Download, ExternalLink, FileText, Image, Package } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import Modal from './Modal';
import ProductImagesModal from './ProductImagesModal';
import type { ProductRecord } from './ProductEditor';
import { packagingDisplay } from '../packaging-display';
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
  onClose: () => void;
  onOpenImages: (product: ProductRecord) => void;
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

export default function ProductDetailModal({ open, product, showSensitive = false, onClose, onOpenImages, onUpdateSaleStatus, onDelete }: ProductDetailModalProps) {
  const [copied, setCopied] = useState(false);
  const [copiedPackagingId, setCopiedPackagingId] = useState<string>();
  const [packagingImages, setPackagingImages] = useState<{ name: string; images: ProductRecord['packaging'][number]['images'] }>();
  if (!product) return null;

  const parameters = product.parameters ?? '';
  const image = product.images[0];
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
          {showSensitive && <DetailItem label="供应商">{product.supplier || '—'}</DetailItem>}
          {showSensitive && <DetailItem label="价格">{product.purchasePrice ? `¥${product.purchasePrice}` : '—'}</DetailItem>}
          <DetailItem label="颜色">{product.colors.join('、') || '—'}</DetailItem>
          <DetailItem label="插脚">{product.batteryPlugs.join('、') || '—'}</DetailItem>
          <DetailItem label="配件" fullWidth>{product.accessories || '—'}</DetailItem>
          <DetailItem label="备注" fullWidth>{product.remark || '—'}</DetailItem>
          <DetailItem label="图片" fullWidth>
            {image ? (
              <div className="product-detail-images">
                <button className="product-detail-images-button" type="button" onClick={() => onOpenImages(product)}>
                  <img src={thumbUrl(image.url, 240)} alt={image.name} loading="lazy" decoding="async" />
                  <span><Image size={13} />查看全部 {product.images.length} 张图片</span>
                </button>
                {imageCategorySummary.length > 1 && <span className="product-detail-images-summary">{imageCategorySummary.join(' · ')}</span>}
              </div>
            ) : <span>暂无图片</span>}
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
    </Modal>
  );
}
