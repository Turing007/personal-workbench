/** 安卓壳（App）注入的原生桥接对象；网页版浏览器里为 undefined。 */
export interface WorkbenchAppNetwork {
  label: string;
  url: string;
  active: boolean;
}

export interface WorkbenchAppBridge {
  /** 已保存网络列表，JSON 字符串 [{label, url, active}]。 */
  getNetworks(): string;
  switchNetwork(url: string): void;
  openAddressEditor(): void;
  /** 弹窗等覆盖层打开时暂停下拉刷新（1.6 之前的 App 没有该方法）。 */
  setOverlayOpen?(open: boolean): void;
  /** 由原生把图片写进系统相册（1.8 之前的 App 没有该方法）。 */
  saveImage?(url: string, fileName?: string): void;
  /**
   * 由原生拉起系统选图/选文件（1.12 之前的 App 没有该方法）。
   * 返回 true 表示已拉起，结果经 window.__workbenchPickedFiles(requestId, files) 异步回传。
   */
  pickFiles?(acceptJson: string, multiple: boolean, maxCount: number, requestId: string): boolean;
}

/** 原生选文件回传的单条数据；data 为 base64 编码的文件字节。 */
export interface PickedNativeFile {
  name: string;
  type: string;
  size: number;
  data: string;
}

/** App 保存结束后的回执：原生通过 window.__workbenchImageSaved(ok) 通知网页。 */
export type ImageSavedHandler = (ok: boolean) => void;

export function getAppBridge(): WorkbenchAppBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { workbenchApp?: WorkbenchAppBridge }).workbenchApp;
}

/**
 * 当前是否跑在自带保存能力的安卓壳里。
 * WebView 既不弹桌面 Chrome 的「保存图片」菜单，也会静默忽略 blob + <a download>，
 * 所以只有走壳里的原生保存，手机相册才真的会出现图片。
 */
export function canSaveImageNatively(): boolean {
  try {
    return typeof getAppBridge()?.saveImage === 'function';
  } catch {
    return false;
  }
}

/** 交给安卓壳原生保存；返回 false 表示当前环境没有该能力，调用方需回退到浏览器方案。 */
export function saveImageNatively(url: string, fileName?: string): boolean {
  try {
    const bridge = getAppBridge();
    if (typeof bridge?.saveImage !== 'function') return false;
    bridge.saveImage(url, fileName);
    return true;
  } catch {
    return false;
  }
}

/** 注册原生保存结果回调，返回注销函数；旧版本 App 不会回调，注销可避免弹窗关掉后仍写状态。 */
export function registerImageSavedHandler(handler: ImageSavedHandler): () => void {
  if (typeof window === 'undefined') return () => {};
  const target = window as unknown as { __workbenchImageSaved?: ImageSavedHandler };
  target.__workbenchImageSaved = handler;
  return () => {
    if (target.__workbenchImageSaved === handler) delete target.__workbenchImageSaved;
  };
}

/**
 * 通知 App 是否有弹窗打开。
 * 弹窗内部是独立滚动容器（文档本身不滚动），若不禁用下拉刷新，弹窗里的下滑手势
 * 会被当成「刷新页面」抢走，表现为弹窗内容滑不动。
 */
export function notifyOverlayOpen(open: boolean): void {
  try {
    getAppBridge()?.setOverlayOpen?.(open);
  } catch {
    /* 旧版本 App 没有该方法时忽略 */
  }
}

/** 当前是否跑在自带原生选文件能力的安卓壳里（1.12 起）。 */
export function canPickFilesNatively(): boolean {
  try {
    return typeof getAppBridge()?.pickFiles === 'function';
  } catch {
    return false;
  }
}

/**
 * App 内选文件的原生通道。
 * 部分 ROM 的 WebView 里 <input type=file> 的点击激活链整条失效（点了连系统选择器都不弹），
 * 只能由原生拉起系统选择器，再把文件字节以 base64 回传。
 * 返回 undefined 表示当前环境没有该能力或拉起失败，调用方应退回 <input type=file> 路径；
 * 用户取消选择时 Promise resolve 为空数组。
 */
export function pickFilesNatively(accept: string[], multiple: boolean, maxCount: number): Promise<File[]> | undefined {
  try {
    const bridge = getAppBridge();
    if (typeof bridge?.pickFiles !== 'function') return undefined;
    const requestId = `pick-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let launched = false;
    try {
      launched = bridge.pickFiles(JSON.stringify(accept), multiple, Math.max(1, maxCount), requestId) === true;
    } catch {
      return undefined;
    }
    if (!launched) return undefined;
    return new Promise<File[]>((resolve) => {
      const target = window as unknown as { __workbenchPickedFiles?: (id: string, files: PickedNativeFile[]) => void };
      target.__workbenchPickedFiles = (id, files) => {
        if (id !== requestId) return; // 不是本次调用的回执，忽略
        delete target.__workbenchPickedFiles;
        const list = Array.isArray(files) ? files : [];
        resolve(list.map(nativeFileToFile).filter((file): file is File => Boolean(file)));
      };
    });
  } catch {
    return undefined;
  }
}

/** 原生回传的 base64 → File。只用 atob/Uint8Array 这些老 WebView 内核也支持的 API。 */
export function nativeFileToFile(picked: PickedNativeFile): File | undefined {
  try {
    const binary = atob(picked.data || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], picked.name || `文件-${Date.now()}`, { type: picked.type || 'application/octet-stream' });
  } catch {
    return undefined;
  }
}
