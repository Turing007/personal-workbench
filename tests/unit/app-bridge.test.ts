import { afterEach, describe, expect, it } from 'vitest';
import { canPickFilesNatively, holdOverlayOpen, nativeFileToFile, pickFilesNatively, startUploadKeepAlive, stopUploadKeepAlive, updateUploadKeepAlive } from '../../src/client/app-bridge';

/** 1×1 PNG，68 字节。 */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

type FakeWindow = Record<string, unknown> & {
  workbenchApp?: unknown;
  __workbenchPickedFiles?: (id: string, files: unknown[]) => void;
  __workbenchPickedFile?: (id: string, file: unknown) => void;
  __workbenchPickedFilesDone?: (id: string) => void;
  __workbenchPickedFileBegin?: (id: string, name: string, type: string) => void;
  __workbenchPickedFileChunk?: (id: string, base64: string) => void;
  __workbenchPickedFileEnd?: (id: string) => void;
  __workbenchPickedFileAbort?: (id: string) => void;
};

function installWindow(fake: FakeWindow) {
  (globalThis as Record<string, unknown>).window = fake;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe('原生选文件桥（App 内上传通路）', () => {
  it('base64 回传能还原成 File，字节数与名称/类型一致', async () => {
    const file = nativeFileToFile({ name: 'IMG_001.jpg', type: 'image/jpeg', size: 68, data: PNG_BASE64 });
    expect(file).toBeDefined();
    expect(file?.name).toBe('IMG_001.jpg');
    expect(file?.type).toBe('image/jpeg');
    expect(file?.size).toBe(68);
    const bytes = new Uint8Array(await file!.arrayBuffer());
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
  });

  it('坏的 base64 返回 undefined 而不是抛异常打断上传链路', () => {
    expect(nativeFileToFile({ name: 'a.png', type: 'image/png', size: 1, data: '!!!不是base64!!!' })).toBeUndefined();
  });

  it('浏览器环境（没有 window.workbenchApp）安全降级为 undefined', () => {
    expect(canPickFilesNatively()).toBe(false);
    expect(pickFilesNatively(['image/*'], true, 9)).toBeUndefined();
  });

  it('桥存在且成功拉起时，等原生回传后 resolve 出 File 列表', async () => {
    const fake: FakeWindow = {};
    installWindow(fake);
    fake.workbenchApp = {
      pickFiles(_accept: string, _multiple: boolean, _max: number, requestId: string) {
        setTimeout(() => {
          fake.__workbenchPickedFiles?.(requestId, [
            { name: 'photo.jpg', type: 'image/jpeg', size: 68, data: PNG_BASE64 },
          ]);
        }, 0);
        return true;
      },
    };
    expect(canPickFilesNatively()).toBe(true);
    const pending = pickFilesNatively(['image/*'], true, 9);
    expect(pending).toBeDefined();
    const files = await pending!;
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('photo.jpg');
    expect(files[0].type).toBe('image/jpeg');
  });

  it('原生侧拉起失败（返回 false）时返回 undefined，让调用方退回 input 路径', () => {
    installWindow({ workbenchApp: { pickFiles: () => false } });
    expect(pickFilesNatively(['image/*'], true, 9)).toBeUndefined();
  });

  it('桥方法抛异常时同样安全降级', () => {
    installWindow({
      workbenchApp: {
        pickFiles: () => {
          throw new Error('dead bridge');
        },
      },
    });
    expect(pickFilesNatively(['image/*'], true, 9)).toBeUndefined();
  });

  it('用户取消选择时回传空数组，resolve 为空列表', async () => {
    const fake: FakeWindow = {};
    installWindow(fake);
    fake.workbenchApp = {
      pickFiles(_accept: string, _multiple: boolean, _max: number, requestId: string) {
        setTimeout(() => fake.__workbenchPickedFiles?.(requestId, []), 0);
        return true;
      },
    };
    const files = await pickFilesNatively(['image/*'], true, 9)!;
    expect(files).toEqual([]);
  });

  it('回执的 requestId 对不上时不误 resolve（防止串号）', async () => {
    const fake: FakeWindow = {};
    installWindow(fake);
    fake.workbenchApp = {
      pickFiles(_accept: string, _multiple: boolean, _max: number, requestId: string) {
        setTimeout(() => fake.__workbenchPickedFiles?.('别的请求', [
          { name: 'x.png', type: 'image/png', size: 68, data: PNG_BASE64 },
        ]), 0);
        setTimeout(() => fake.__workbenchPickedFiles?.(requestId, [
          { name: 'right.png', type: 'image/png', size: 68, data: PNG_BASE64 },
        ]), 10);
        return true;
      },
    };
    const files = await pickFilesNatively(['image/*'], true, 9)!;
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('right.png');
  });

  it('新版 App 逐张回传：Done 之前不 resolve，Done 后一次收齐并清理回调', async () => {
    const fake: FakeWindow = {};
    installWindow(fake);
    let doneSent = false;
    let earlyResolve = false;
    fake.workbenchApp = {
      pickFiles(_accept: string, _multiple: boolean, _max: number, requestId: string) {
        setTimeout(() => fake.__workbenchPickedFile?.(requestId, { name: 'a.jpg', type: 'image/jpeg', size: 68, data: PNG_BASE64 }), 0);
        setTimeout(() => fake.__workbenchPickedFile?.(requestId, { name: 'b.jpg', type: 'image/jpeg', size: 68, data: PNG_BASE64 }), 5);
        setTimeout(() => {
          doneSent = true;
          fake.__workbenchPickedFilesDone?.(requestId);
        }, 10);
        return true;
      },
    };
    const pending = pickFilesNatively(['image/*'], true, 9)!;
    void pending.then(() => {
      if (!doneSent) earlyResolve = true;
    });
    const files = await pending;
    expect(earlyResolve).toBe(false);
    expect(files.map((file) => file.name)).toEqual(['a.jpg', 'b.jpg']);
    // 收尾时把全局回调清掉，避免残留在页面上被下一次选图误用。
    expect(fake.__workbenchPickedFile).toBeUndefined();
    expect(fake.__workbenchPickedFilesDone).toBeUndefined();
    expect(fake.__workbenchPickedFiles).toBeUndefined();
  });

  it('新版 App 逐张回传：requestId 对不上的单张被忽略', async () => {
    const fake: FakeWindow = {};
    installWindow(fake);
    fake.workbenchApp = {
      pickFiles(_accept: string, _multiple: boolean, _max: number, requestId: string) {
        setTimeout(() => {
          fake.__workbenchPickedFile?.('别的请求', { name: 'x.jpg', type: 'image/jpeg', size: 68, data: PNG_BASE64 });
          fake.__workbenchPickedFile?.(requestId, { name: 'right.jpg', type: 'image/jpeg', size: 68, data: PNG_BASE64 });
          fake.__workbenchPickedFilesDone?.(requestId);
        }, 0);
        return true;
      },
    };
    const files = await pickFilesNatively(['image/*'], true, 9)!;
    expect(files.map((file) => file.name)).toEqual(['right.jpg']);
  });

  it('上传保活：桥有方法时按参数透传；旧壳没有时静默跳过', () => {
    const calls: Array<[string, number, number]> = [];
    let stopped = 0;
    const fake: FakeWindow = {};
    installWindow(fake);
    fake.workbenchApp = {
      startUploadKeepAlive: (text: string, done: number, total: number) => { calls.push([text, done, total]); },
      updateUploadKeepAlive: (text: string, done: number, total: number) => { calls.push([text, done, total]); },
      stopUploadKeepAlive: () => { stopped += 1; },
    };
    startUploadKeepAlive('正在后台上传 1/3 个文件', 1, 3);
    updateUploadKeepAlive('正在后台上传 2/3 个文件', 2, 3);
    stopUploadKeepAlive();
    expect(calls).toEqual([
      ['正在后台上传 1/3 个文件', 1, 3],
      ['正在后台上传 2/3 个文件', 2, 3],
    ]);
    expect(stopped).toBe(1);

    // 旧壳没有这些方法：静默跳过，不抛异常。
    installWindow({ workbenchApp: {} });
    expect(() => {
      startUploadKeepAlive('t', 0, 1);
      updateUploadKeepAlive('t', 0, 1);
      stopUploadKeepAlive();
    }).not.toThrow();
  });

  it('新版分块回传：Begin/Chunk/End 拼回完整文件（大视频走的就是这条路）', async () => {
    const fake: FakeWindow = {};
    installWindow(fake);
    const first = Buffer.from([1, 2, 3, 4, 5]);
    const second = Buffer.from([6, 7, 8]);
    fake.workbenchApp = {
      pickFiles(_accept: string, _multiple: boolean, _max: number, requestId: string) {
        setTimeout(() => {
          fake.__workbenchPickedFileBegin?.(requestId, '视频.mp4', 'video/mp4');
          fake.__workbenchPickedFileChunk?.(requestId, first.toString('base64'));
          fake.__workbenchPickedFileChunk?.(requestId, second.toString('base64'));
          fake.__workbenchPickedFileEnd?.(requestId);
          fake.__workbenchPickedFilesDone?.(requestId);
        }, 0);
        return true;
      },
    };
    const files = await pickFilesNatively(['.mp4'], true, 5)!;
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('视频.mp4');
    expect(files[0].type).toBe('video/mp4');
    expect(files[0].size).toBe(8);
    expect(Array.from(new Uint8Array(await files[0].arrayBuffer()))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // 收尾时把全局回调清掉
    expect(fake.__workbenchPickedFileBegin).toBeUndefined();
    expect(fake.__workbenchPickedFileChunk).toBeUndefined();
    expect(fake.__workbenchPickedFileAbort).toBeUndefined();
  });

  it('分块回传收到 Abort：半截文件被丢弃，后面完整的文件照常收下', async () => {
    const fake: FakeWindow = {};
    installWindow(fake);
    fake.workbenchApp = {
      pickFiles(_accept: string, _multiple: boolean, _max: number, requestId: string) {
        setTimeout(() => {
          fake.__workbenchPickedFileBegin?.(requestId, '超限.mp4', 'video/mp4');
          fake.__workbenchPickedFileChunk?.(requestId, Buffer.from([9, 9, 9]).toString('base64'));
          fake.__workbenchPickedFileAbort?.(requestId);
          fake.__workbenchPickedFileBegin?.(requestId, '好的.mp4', 'video/mp4');
          fake.__workbenchPickedFileChunk?.(requestId, Buffer.from([1, 2]).toString('base64'));
          fake.__workbenchPickedFileEnd?.(requestId);
          fake.__workbenchPickedFilesDone?.(requestId);
        }, 0);
        return true;
      },
    };
    const files = await pickFilesNatively(['.mp4'], true, 5)!;
    expect(files.map((file) => file.name)).toEqual(['好的.mp4']);
    expect(files[0].size).toBe(2);
  });
});

describe('覆盖层暂停 App 下拉刷新（弹窗 / 抽屉 / 幕布共用）', () => {
  it('计数式：两层同时打开，先关掉一层不会提前恢复刷新', () => {
    const calls: boolean[] = [];
    installWindow({ workbenchApp: { setOverlayOpen: (open: boolean) => calls.push(open) } });

    const releaseModal = holdOverlayOpen();
    const releaseCurtain = holdOverlayOpen();
    expect(calls).toEqual([true]);

    releaseCurtain();
    expect(calls).toEqual([true]); // 弹窗还开着，不能放开

    releaseModal();
    expect(calls).toEqual([true, false]);
  });

  it('重复调用同一个释放函数不会把计数减穿', () => {
    const calls: boolean[] = [];
    installWindow({ workbenchApp: { setOverlayOpen: (open: boolean) => calls.push(open) } });

    const releaseA = holdOverlayOpen();
    const releaseB = holdOverlayOpen();
    releaseA();
    releaseA(); // 重复释放忽略
    expect(calls).toEqual([true]);
    releaseB();
    expect(calls).toEqual([true, false]);
  });

  it('浏览器环境（没有桥）不抛异常', () => {
    installWindow({});
    expect(() => holdOverlayOpen()()).not.toThrow();
  });
});
