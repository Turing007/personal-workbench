import { afterEach, describe, expect, it, vi } from 'vitest';
import { bytesToBase64, fetchImageBase64, reportImageSaveFailure, saveStageText, startSaveImageToAlbum } from '../../src/client/image-save';

/** 1×1 PNG，68 字节，与服务端存图测试用的是同一份。 */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

type FakeWindow = Record<string, unknown> & { workbenchApp?: unknown };

function installWindow(fake: FakeWindow) {
  (globalThis as Record<string, unknown>).window = {
    location: { origin: 'https://workbench.example' },
    ...fake,
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  vi.unstubAllGlobals();
});

describe('bytesToBase64', () => {
  it('与 Buffer 的 base64 输出一致（含空串与不足 3 字节的尾巴）', () => {
    const cases = [Buffer.alloc(0), Buffer.from([0x89]), Buffer.from([0x89, 0x50]), Buffer.from([0x89, 0x50, 0x4e]), Buffer.from([0, 1, 2, 3]), PNG_BYTES];
    for (const buffer of cases) {
      expect(bytesToBase64(new Uint8Array(buffer))).toBe(buffer.toString('base64'));
    }
  });

  it('超过分块阈值的字节也编码正确（走多段拼接路径）', () => {
    const buffer = Buffer.alloc(20_003);
    for (let index = 0; index < buffer.length; index += 1) buffer[index] = (index * 7) % 256;
    expect(bytesToBase64(new Uint8Array(buffer))).toBe(buffer.toString('base64'));
  });
});

describe('fetchImageBase64', () => {
  it('取回图片字节并编码为 base64', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.length),
    })));
    expect(await fetchImageBase64('/files/product-images/a.png')).toBe(PNG_BYTES.toString('base64'));
  });

  it('HTTP 失败时抛错，带上状态码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(fetchImageBase64('/files/product-images/a.png')).rejects.toThrow('HTTP 404');
  });
});

describe('startSaveImageToAlbum', () => {
  it('1.18+ 壳：网页抓图后把 base64 交给 saveImageData，不再走壳的下载', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.length),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const calls: Array<{ base64: string; name?: string }> = [];
    const legacyUrls: string[] = [];
    installWindow({
      workbenchApp: {
        saveImage: (url: string) => { legacyUrls.push(url); },
        saveImageData: (base64: string, name?: string) => { calls.push({ base64, name }); },
      },
    });

    const result = await startSaveImageToAlbum('/files/product-images/a.png', '主图.png');
    expect(result).toEqual({ started: true });
    // 抓图的地址必须是完整地址：壳不再自己拼接，也避免壳在异常状态下取不到当前页地址。
    expect(fetchMock).toHaveBeenCalledWith('https://workbench.example/files/product-images/a.png');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('主图.png');
    expect(Buffer.from(calls[0]!.base64, 'base64').equals(PNG_BYTES)).toBe(true);
    // 新通道生效后旧通道不应再被调用。
    expect(legacyUrls).toHaveLength(0);
  });

  it('抓图失败：不启动保存，回报 fetch 环节', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to fetch'); }));
    installWindow({ workbenchApp: { saveImageData: () => {} } });
    const result = await startSaveImageToAlbum('/files/a.png');
    expect(result.started).toBe(false);
    expect(result.stage).toBe('fetch');
    expect(result.message).toContain('Failed to fetch');
  });

  it('旧壳（只有 saveImage）：退回原下载通道，但地址升级为完整地址', async () => {
    const legacyUrls: string[] = [];
    installWindow({ workbenchApp: { saveImage: (url: string) => { legacyUrls.push(url); } } });
    const result = await startSaveImageToAlbum('/files/product-images/a.png', '主图.png');
    expect(result).toEqual({ started: true });
    expect(legacyUrls).toEqual(['https://workbench.example/files/product-images/a.png']);
  });

  it('没有任何保存桥（浏览器）时返回未启动，由调用方兜底', async () => {
    installWindow({});
    const result = await startSaveImageToAlbum('/files/a.png');
    expect(result.started).toBe(false);
    expect(result.stage).toBe('bridge');
  });
});

describe('saveStageText', () => {
  it('已知环节翻译为中文，未知环节原样带出', () => {
    expect(saveStageText('write')).toBe('写入相册失败');
    expect(saveStageText('download')).toBe('图片下载失败');
    expect(saveStageText('mystery')).toBe('保存失败（mystery）');
    expect(saveStageText('')).toBe('保存失败');
  });
});

describe('reportImageSaveFailure', () => {
  it('把失败环节 POST 到服务端诊断接口，失败时静默不抛异常', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '{"ok":true,"data":{"received":true}}',
    }));
    vi.stubGlobal('fetch', fetchMock);
    installWindow({});
    reportImageSaveFailure('write', 'IOException: boom');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/client-diagnostics');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'image-save', stage: 'write', message: 'IOException: boom' });

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(() => reportImageSaveFailure('fetch', 'offline')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
