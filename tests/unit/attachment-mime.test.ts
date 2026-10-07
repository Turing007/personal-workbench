import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  ATTACHMENT_ACCEPT,
  attachmentFilesFromClipboard,
  isSupportedAttachmentName,
  normalizeUploadAttachment,
  SUPPORTED_ATTACHMENT_HINT,
} from '../../src/client/attachment-mime';

function file(name: string, type = ''): File {
  return new File(['placeholder bytes'], name, { type });
}

/** 用 DataTransfer 模拟剪贴板；node 环境没有该构造器，用最小替身。 */
function fakeClipboard(files: File[], items: File[] = []): DataTransfer {
  return {
    files,
    items: items.map((item) => ({ kind: 'file', type: item.type, getAsFile: () => item })),
  } as unknown as DataTransfer;
}

describe('附件粘贴的类型归一化', () => {
  it('没有 MIME 的压缩包按扩展名回写，否则存下来的类型与内容不符', () => {
    expect(normalizeUploadAttachment(file('包装图纸.zip', ''))?.type).toBe('application/zip');
    expect(normalizeUploadAttachment(file('模具.7Z', 'application/octet-stream'))?.type).toBe('application/x-7z-compressed');
  });

  it('粘贴来的图片附件回写为可内联预览的 MIME', () => {
    expect(normalizeUploadAttachment(file('刀模图.png', ''))?.type).toBe('image/png');
    expect(normalizeUploadAttachment(file('照片.JPEG', 'application/octet-stream'))?.type).toBe('image/jpeg');
  });

  it('设计源文件按扩展名识别，不因为 MIME 陌生被丢弃', () => {
    expect(normalizeUploadAttachment(file('面板.psd', 'application/octet-stream'))?.type).toBe('image/vnd.adobe.photoshop');
    expect(normalizeUploadAttachment(file('结构图.dwg', ''))?.type).toBe('application/acad');
  });

  it('MIME 已经正确时原样返回同一个文件对象，不重新拷贝字节', () => {
    const source = file('说明书.pdf', 'application/pdf');
    expect(normalizeUploadAttachment(source)).toBe(source);
  });

  it('服务端不支持的扩展名返回 undefined，交给调用方提示', () => {
    expect(normalizeUploadAttachment(file('实拍.heic', 'image/heic'))).toBeUndefined();
    expect(normalizeUploadAttachment(file('下载文件', 'application/pdf'))).toBeUndefined();
    expect(normalizeUploadAttachment(file('旧版附件.doc_', ''))).toBeUndefined();
  });

  it('扩展名大小写与路径都按服务端规则归一化', () => {
    expect(isSupportedAttachmentName('图纸.DXF')).toBe(true);
    expect(isSupportedAttachmentName('C:\\资料\\说明书.PDF')).toBe(true);
    expect(isSupportedAttachmentName('说明.pdf.exe')).toBe(false);
  });

  it('accept 属性覆盖服务端全部附件类型', () => {
    expect(ATTACHMENT_ACCEPT.split(',')).toEqual([...ALLOWED_ATTACHMENT_EXTENSIONS]);
    expect(ATTACHMENT_ACCEPT.split(',')).toContain('.dwg');
  });

  it('提示文案与后端 file-store 一致', () => {
    expect(SUPPORTED_ATTACHMENT_HINT).toBe('附件支持 PDF、Office、图片、压缩包及常见设计源文件');
  });
});

describe('从剪贴板取附件', () => {
  it('files 与 items 指向同一份数据时只保留一份', () => {
    const pdf = file('合同.pdf', 'application/pdf');
    expect(attachmentFilesFromClipboard(fakeClipboard([pdf], [pdf]))).toEqual([pdf]);
  });

  it('只填了 items 的浏览器也能取到文件', () => {
    const zip = file('图纸.zip', 'application/zip');
    expect(attachmentFilesFromClipboard(fakeClipboard([], [zip]))).toEqual([zip]);
  });

  it('忽略非文件类型的剪贴板项，纯文本粘贴不返回任何文件', () => {
    const clipboard = { files: [], items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] } as unknown as DataTransfer;
    expect(attachmentFilesFromClipboard(clipboard)).toEqual([]);
    expect(attachmentFilesFromClipboard(null)).toEqual([]);
  });
});
