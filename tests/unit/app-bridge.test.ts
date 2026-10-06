import { afterEach, describe, expect, it } from 'vitest';
import { canPickFilesNatively, nativeFileToFile, pickFilesNatively } from '../../src/client/app-bridge';

/** 1×1 PNG，68 字节。 */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

type FakeWindow = Record<string, unknown> & {
  workbenchApp?: unknown;
  __workbenchPickedFiles?: (id: string, files: unknown[]) => void;
  __workbenchPickedFile?: (id: string, file: unknown) => void;
  __workbenchPickedFilesDone?: (id: string) => void;
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
});
