export type ThumbnailSize = 240 | 480 | 960;

const IMAGE_FILE_PATTERN = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;
const FILES_PATH_PATTERN = /^\/files\/(.+)$/;

/**
 * 列表与缩略图使用服务端生成的小图（WebP），点开大图/下载时仍用原图。
 * 非图片附件或外部地址原样返回，保证行为安全。
 */
export function thumbUrl(url: string | null | undefined, size: ThumbnailSize = 480): string {
  if (!url) return '';
  const match = url.match(FILES_PATH_PATTERN);
  if (!match) return url;
  const relativePath = match[1];
  if (!IMAGE_FILE_PATTERN.test(relativePath)) return url;
  return `/api/thumbs/${size}/${relativePath}`;
}
