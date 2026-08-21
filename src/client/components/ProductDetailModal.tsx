import { Check, Copy, Download, ExternalLink, FileText, Image, Package } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import Modal from './Modal';
import ProductImagesModal from './ProductImagesModal';
import type { ProductRecord } from './ProductEditor';
import { packagingDisplay } from '../packaging-display';

export interface ProductDetailModalProps {
  open: boolean;
  product?: ProductRecord;
  onClose: () => void;
  onOpenImages: (product: ProductRecord) => void;
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

export default function ProductDetailModal({ open, product, onClose, onOpenImages }: ProductDetailModalProps) {
  const [copied, setCopied] = useState(false);
  const [copiedPackagingId, setCopiedPackagingId] = useState<string>();
  const [packagingImages, setPackagingImages] = useState<{ name: string; images: ProductRecord['packaging'][number]['images'] }>();
  if (!product) return null;

  const parameters = product.parameters ?? '';
  const image = product.images[0];
  const copyParameters = async () => {
    if (!parameters.trim()) return;
    try {
      await navigator.clipboard.writeText(parameters);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

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
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPackagingId(item.id);
      window.setTimeout(() => setCopiedPackagingId((current) => current === item.id ? undefined : current), 1600);
    } catch {
      setCopiedPackagingId(undefined);
    }
  };

  return (
    <Modal open={open} title={`产品详情 · ${product.sku || product.name || '未命名产品'}`} onClose={onClose} width={760}>
      <div className="product-detail-content">
        <div className="product-detail-grid kv-grid">
          <DetailItem label="SKU"><span className="product-detail-emphasis kv-value is-accent">{product.sku || '—'}</span></DetailItem>
          <DetailItem label="品名">{product.name || '—'}</DetailItem>
          <DetailItem label="供应商">{product.supplier || '—'}</DetailItem>
          <DetailItem label="颜色">{product.colors.join('、') || '—'}</DetailItem>
          <DetailItem label="插脚">{product.batteryPlugs.join('、') || '—'}</DetailItem>
          <DetailItem label="价格">{product.purchasePrice ? `¥${product.purchasePrice}` : '—'}</DetailItem>
          <DetailItem label="配件" fullWidth>{product.accessories || '—'}</DetailItem>
          <DetailItem label="备注" fullWidth>{product.remark || '—'}</DetailItem>
          <DetailItem label="图片">
            {image ? (
              <button className="product-detail-images-button" type="button" onClick={() => onOpenImages(product)}>
                <img src={image.url} alt={image.name} />
                <span><Image size={13} />查看全部 {product.images.length} 张图片</span>
              </button>
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
        <div className="product-detail-hint"><Package size={14} />产品详情为只读信息，编辑请使用操作栏中的编辑按钮。</div>
      </div>
      <ProductImagesModal open={Boolean(packagingImages)} productName={packagingImages?.name ?? '包装'} images={packagingImages?.images ?? []} onClose={() => setPackagingImages(undefined)} />
    </Modal>
  );
}
