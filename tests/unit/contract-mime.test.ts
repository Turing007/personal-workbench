import { describe, expect, it } from 'vitest';
import { CONTRACT_PICKER_ACCEPT, normalizeUploadContract, SUPPORTED_CONTRACT_HINT } from '../../src/client/contract-mime';

function file(name: string, type: string): File {
  return new File(['%PDF-1.7 placeholder bytes'], name, { type });
}

describe('订单附件的类型归一化', () => {
  it('application/octet-stream 的 pdf 按扩展名回写 MIME', () => {
    const result = normalizeUploadContract(file('吸尘器标签.pdf', 'application/octet-stream'));
    expect(result?.type).toBe('application/pdf');
    expect(result?.name).toBe('吸尘器标签.pdf');
  });

  it('file.type 为空时同样回写，否则 FormData 会带 octet-stream 被服务端拒', () => {
    expect(normalizeUploadContract(file('SCN_0001.PDF', ''))?.type).toBe('application/pdf');
  });

  it('个别厂商报的 image/jpg 按扩展名纠正为 image/jpeg', () => {
    expect(normalizeUploadContract(file('IMG_20260918.jpg', 'image/jpg'))?.type).toBe('image/jpeg');
  });

  it('docx/xlsx 回写成服务端登记的长 MIME', () => {
    expect(normalizeUploadContract(file('报价单.docx', 'application/octet-stream'))?.type)
      .toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(normalizeUploadContract(file('装箱清单.xlsx', ''))?.type)
      .toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('MIME 已经正确时原样返回同一个文件对象，不重新拷贝字节', () => {
    const source = file('a.pdf', 'application/pdf');
    expect(normalizeUploadContract(source)).toBe(source);
  });

  it('服务端存不下的文件返回 undefined，而不是静默通过', () => {
    expect(normalizeUploadContract(file('IMG_0001.heic', 'image/heic'))).toBeUndefined();
    expect(normalizeUploadContract(file('download', 'application/octet-stream'))).toBeUndefined();
  });

  it('原生桥回传没有扩展名的名字时，按 Provider 的 MIME 补齐扩展名，否则服务端配对校验必挂', () => {
    const result = normalizeUploadContract(file('file-1726666666666', 'application/pdf'));
    expect(result?.name).toBe('file-1726666666666.pdf');
    expect(result?.type).toBe('application/pdf');
  });

  it('提示文案与后端 file-store 一致', () => {
    expect(SUPPORTED_CONTRACT_HINT).toBe('合同仅支持 PDF、Word、Excel 或 PNG/JPEG/WebP 图片');
  });

  it('原生选文件桥的 accept 覆盖服务端全部合同类型且不重复', () => {
    expect([...CONTRACT_PICKER_ACCEPT].sort()).toEqual([
      'application/msword',
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });
});
