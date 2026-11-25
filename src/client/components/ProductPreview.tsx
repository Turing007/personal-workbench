import { useEffect, useState, type MouseEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { thumbUrl } from '../image-urls';

interface ProductPreviewState {
  url: string;
  name: string;
  left: number;
  top: number;
  size: number;
}

/**
 * 产品缩略图的桌面悬停大图：所有产品小图共用一套浮层。
 * 鼠标移入缩略图在右侧/左侧弹出 340px 大图，移开、点击、滚动或缩放窗口即关闭；触屏不会触发。
 */
export function useProductPreview() {
  const [preview, setPreview] = useState<ProductPreviewState | null>(null);

  useEffect(() => {
    if (!preview) return undefined;
    const close = () => setPreview(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [preview]);

  const hide = () => setPreview(null);

  /** 把事件挂到任意缩略图元素上；url 为原图路径（/files/...），空串表示无图不弹。 */
  const bind = (url: string, name: string) => (url ? {
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const size = Math.min(340, window.innerWidth - 24, window.innerHeight - 24);
      const gap = 12;
      const left = rect.right + gap + size <= window.innerWidth - gap
        ? rect.right + gap
        : Math.max(gap, rect.left - size - gap);
      const top = Math.min(Math.max(gap, rect.top), window.innerHeight - size - gap);
      setPreview({ url, name, left, top, size });
    },
    onMouseLeave: hide,
    onMouseDown: hide,
  } : {});

  const previewElement: ReactElement | null = preview ? createPortal(
    <div className="product-hover-preview" role="tooltip" style={{ left: preview.left, top: preview.top, width: preview.size, height: preview.size }}>
      <img src={thumbUrl(preview.url, 960)} alt={`${preview.name}大图`} decoding="async" />
    </div>,
    document.body,
  ) : null;

  return { bind, previewElement };
}
