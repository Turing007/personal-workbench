import { extensionOf } from './image-mime';

/**
 * 附件（产品/客户产品/订单附件）支持的扩展名，与服务端 ALLOWED_PRODUCT_ATTACHMENT_EXTENSIONS 对齐。
 * 服务端只按扩展名判定，不看 MIME，所以这里同样以扩展名为准。
 */
export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.webp',
  '.txt', '.zip', '.rar', '.7z', '.ai', '.psd', '.cdr', '.dwg', '.dxf',
] as const;

/** 与 file input 的 accept 属性一致，供原生选择器与 input 共用。 */
export const ATTACHMENT_ACCEPT = ALLOWED_ATTACHMENT_EXTENSIONS.join(',');

/** 与服务端报错文案一致，避免前后端提示不一样。 */
export const SUPPORTED_ATTACHMENT_HINT = '附件支持 PDF、Office、图片、压缩包及常见设计源文件';

const ATTACHMENT_EXTENSION_SET = new Set<string>(ALLOWED_ATTACHMENT_EXTENSIONS);

export function isSupportedAttachmentName(fileName: string): boolean {
  const extension = extensionOf(fileName || '');
  return extension ? ATTACHMENT_EXTENSION_SET.has(`.${extension}`) : false;
}

/**
 * 附件 MIME 推断：只认扩展名，不信任 file.type —— 手机/桌面从聊天工具或压缩包拖来的文件
 * 常报 application/octet-stream 或空类型，服务端虽然只按扩展名校验，但存下来的 MIME
 * 会影响后续预览（图片附件要能内联打开）。
 */
const MIME_BY_ATTACHMENT_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  ai: 'application/postscript',
  psd: 'image/vnd.adobe.photoshop',
  cdr: 'application/cdr',
  dwg: 'application/acad',
  dxf: 'application/dxf',
};

/**
 * 归一化待上传的附件：扩展名不受支持时返回 undefined（提示用），否则按扩展名回写 MIME。
 * 剪贴板里的文件尤其需要这一步 —— 复制粘贴过来的文件常常没有类型，直接上传会出现
 * 「文件明明支持却被拒」或存下来的 MIME 与内容不符。
 */
export function normalizeUploadAttachment(file: File): File | undefined {
  if (!isSupportedAttachmentName(file.name || '')) return undefined;
  const extension = extensionOf(file.name);
  const mime = MIME_BY_ATTACHMENT_EXTENSION[extension];
  if (!mime || file.type === mime) return file;
  return new File([file], file.name, { type: mime, lastModified: file.lastModified });
}

/**
 * 从剪贴板事件里取出可作为附件的文件。
 * 桌面端复制文件后粘贴会出现在 clipboardData.files；部分浏览器/WebView 只填 items，
 * 两者都取一遍再去重（同一文件可能同时出现在两处）。
 */
export function attachmentFilesFromClipboard(clipboard: DataTransfer | null): File[] {
  return filesFromClipboard(clipboard);
}

/**
 * 剪贴板取文件的通用实现：不过滤扩展名，由调用方按各自的白名单筛。
 * 视频区块与附件区块共用 —— 桌面端复制文件后粘贴的落点行为必须一致，
 * 否则同一份剪贴板数据在附件区能粘、视频区不能粘，用户只会以为是 bug。
 */
export function filesFromClipboard(clipboard: DataTransfer | null): File[] {
  if (!clipboard) return [];
  const files: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null) => {
    if (!file) return;
    const key = `${file.name}|${file.size}|${file.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };
  for (const file of Array.from(clipboard.files ?? [])) push(file);
  for (const item of Array.from(clipboard.items ?? [])) {
    if (item.kind !== 'file') continue;
    push(item.getAsFile());
  }
  return files;
}
