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
  /** 删除一条已保存的网络（1.13 之前的 App 没有该方法）。 */
  removeNetwork?(url: string): void;
  /** 弹窗等覆盖层打开时暂停下拉刷新（1.6 之前的 App 没有该方法）。 */
  setOverlayOpen?(open: boolean): void;
  /** 由原生把图片写进系统相册（1.8 之前的 App 没有该方法）。 */
  saveImage?(url: string, fileName?: string): void;
  /**
   * 由网页端抓好的图片字节（base64）直接交给原生写进相册（1.18 之前的 App 没有该方法）。
   * 个别机型上壳自己下载图片会静默失败，1.18 起改由网页负责抓图、壳只负责落盘。
   */
  saveImageData?(base64: string, fileName?: string): void;
  /**
   * 由原生拉起系统选图/选文件（1.12 之前的 App 没有该方法）。
   * 返回 true 表示已拉起，结果经 window.__workbenchPickedFiles(requestId, files) 异步回传。
   */
  pickFiles?(acceptJson: string, multiple: boolean, maxCount: number, requestId: string): boolean;
  /**
   * 导出文件（PDF/Excel）保存到手机「下载」并弹分享（1.19 之前的 App 没有这些方法）。
   * 协议仿照选文件的分块回传：Begin 返回 true 表示开始接收；Chunk 逐块传 base64；
   * End 落盘并弹系统分享面板；Abort 丢弃半截文件。WebView 会静默忽略 blob 下载，App 内只能走这条。
   */
  saveFileBegin?(requestId: string, fileName: string, mimeType: string): boolean;
  saveFileChunk?(requestId: string, base64: string): void;
  saveFileEnd?(requestId: string): void;
  saveFileAbort?(requestId: string): void;
  /** 上传期间保活（前台服务 + 通知栏进度；1.16 之前的 App 没有这些方法）。 */
  startUploadKeepAlive?(text: string, done: number, total: number): void;
  updateUploadKeepAlive?(text: string, done: number, total: number): void;
  stopUploadKeepAlive?(): void;
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

/** 把网页抓好的 base64 字节交给壳写相册（1.18+）；返回 false 表示壳还没有这个能力。 */
export function saveImageDataNatively(base64: string, fileName?: string): boolean {
  try {
    const bridge = getAppBridge();
    if (typeof bridge?.saveImageData !== 'function') return false;
    bridge.saveImageData(base64, fileName);
    return true;
  } catch {
    return false;
  }
}

/** 保存失败环节的回报：原生通过 window.__workbenchSaveFailed(stage, message) 通知网页（1.18+）。 */
export type ImageSaveFailureHandler = (stage: string, message: string) => void;

/** 注册保存失败回报，返回注销函数；旧版本 App 不会回报，注销可避免弹窗关掉后仍写状态。 */
export function registerImageSaveFailureHandler(handler: ImageSaveFailureHandler): () => void {
  if (typeof window === 'undefined') return () => {};
  const target = window as unknown as { __workbenchSaveFailed?: ImageSaveFailureHandler };
  target.__workbenchSaveFailed = handler;
  return () => {
    if (target.__workbenchSaveFailed === handler) delete target.__workbenchSaveFailed;
  };
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

/** 导出文件保存失败的回执：原生通过 window.__workbenchFileSaveFailed(stage, message) 通知网页（1.19+）。 */
export type FileSaveFailureHandler = (stage: string, message: string) => void;

export function registerFileSaveFailureHandler(handler: FileSaveFailureHandler): () => void {
  if (typeof window === 'undefined') return () => {};
  const target = window as unknown as { __workbenchFileSaveFailed?: FileSaveFailureHandler };
  target.__workbenchFileSaveFailed = handler;
  return () => {
    if (target.__workbenchFileSaveFailed === handler) delete target.__workbenchFileSaveFailed;
  };
}

/**
 * 覆盖层（弹窗 / 抽屉 / 幕布）打开期间暂停 App 的下拉刷新。
 * 壳只看整页是否在顶部，看不到弹窗或幕布内部的滚动区；不暂停的话，内部往下滑
 * 会被壳当成下拉刷新抢走，表现为内容滑不动、反而刷新了页面。
 *
 * 用计数而不是布尔：可能同时有多个覆盖层（幕布上面再开弹窗），
 * 先关掉的那个不能把仍在打开的那个的保护一并撤掉。返回释放函数，可安全重复调用。
 */
let overlayHoldCount = 0;

export function holdOverlayOpen(): () => void {
  overlayHoldCount += 1;
  if (overlayHoldCount === 1) {
    try {
      getAppBridge()?.setOverlayOpen?.(true);
    } catch {
      /* 旧版本 App 没有该方法时忽略 */
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    overlayHoldCount = Math.max(0, overlayHoldCount - 1);
    if (overlayHoldCount > 0) return;
    try {
      getAppBridge()?.setOverlayOpen?.(false);
    } catch {
      /* 旧版本 App 没有该方法时忽略 */
    }
  };
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
 * 上传期间请壳把 App 保活（前台服务 + 通知栏进度）。
 * 安卓在 App 退到后台后会把整个应用冻结、上传随之停住，挂着前台服务就能继续传；
 * 旧壳没有这些方法时静默跳过，网页版不受影响。
 */
export function startUploadKeepAlive(text: string, done: number, total: number): void {
  try { getAppBridge()?.startUploadKeepAlive?.(text, done, total); } catch { /* 旧壳忽略 */ }
}

export function updateUploadKeepAlive(text: string, done: number, total: number): void {
  try { getAppBridge()?.updateUploadKeepAlive?.(text, done, total); } catch { /* 旧壳忽略 */ }
}

export function stopUploadKeepAlive(): void {
  try { getAppBridge()?.stopUploadKeepAlive?.(); } catch { /* 旧壳忽略 */ }
}

/**
 * App 内选文件的原生通道。
 * 部分 ROM 的 WebView 里 <input type=file> 的点击激活链整条失效（点了连系统选择器都不弹），
 * 只能由原生拉起系统选择器，再把文件字节以 base64 回传。
 *
 * 回传协议有三版，用户装的新旧 App 都可能遇到：
 *  - 新版（App 1.17+）：分块回传 __workbenchPickedFileBegin/Chunk/End（+ Abort 中止单个文件），
 *    原生按 2MB 一块边读边发 —— 视频这类大文件里外内存都只占一块；
 *  - App 1.15/1.16：逐张调用 __workbenchPickedFile，最后 __workbenchPickedFilesDone 收尾；
 *  - 更旧：一次性调用 __workbenchPickedFiles 回传整个数组。
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
      const target = window as unknown as {
        __workbenchPickedFiles?: (id: string, files: PickedNativeFile[]) => void;
        __workbenchPickedFile?: (id: string, file: PickedNativeFile) => void;
        __workbenchPickedFilesDone?: (id: string) => void;
        __workbenchPickedFileBegin?: (id: string, name: string, type: string) => void;
        __workbenchPickedFileChunk?: (id: string, base64: string) => void;
        __workbenchPickedFileEnd?: (id: string) => void;
        __workbenchPickedFileAbort?: (id: string) => void;
      };
      const collected: File[] = [];
      const finish = () => {
        delete target.__workbenchPickedFiles;
        delete target.__workbenchPickedFile;
        delete target.__workbenchPickedFilesDone;
        delete target.__workbenchPickedFileBegin;
        delete target.__workbenchPickedFileChunk;
        delete target.__workbenchPickedFileEnd;
        delete target.__workbenchPickedFileAbort;
        resolve(collected.slice());
      };
      // 分块协议（1.17+）：与原生侧的能力探测对应。每个分块解码后立刻放进 Blob，
      // 大文件的数据经浏览器 Blob 存储（可落盘）承载，渲染进程内存只占一块的量级。
      let pendingParts: Blob[] | null = null;
      let pendingName = '';
      let pendingType = '';
      target.__workbenchPickedFileBegin = (id, name, type) => {
        if (id !== requestId) return;
        pendingParts = [];
        pendingName = name || '';
        pendingType = type || '';
      };
      target.__workbenchPickedFileChunk = (id, base64) => {
        if (id !== requestId || !pendingParts) return;
        try {
          const binary = atob(base64 || '');
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
          pendingParts.push(new Blob([bytes]));
        } catch {
          pendingParts = null;
        }
      };
      target.__workbenchPickedFileEnd = (id) => {
        if (id !== requestId || !pendingParts) return;
        const parts = pendingParts;
        pendingParts = null;
        if (!parts.length) return;
        collected.push(new File(parts, pendingName || `文件-${Date.now()}`, { type: pendingType || 'application/octet-stream' }));
      };
      target.__workbenchPickedFileAbort = (id) => {
        if (id !== requestId) return;
        pendingParts = null; // 半截文件直接丢弃，不算一张
      };
      // 与原生侧的能力探测对应：__workbenchPickedFile 存在 = 支持逐张回传。
      target.__workbenchPickedFile = (id, picked) => {
        if (id !== requestId) return; // 不是本次调用的回执，忽略
        const file = nativeFileToFile(picked);
        if (file) collected.push(file);
      };
      target.__workbenchPickedFilesDone = (id) => {
        if (id !== requestId) return;
        finish();
      };
      target.__workbenchPickedFiles = (id, files) => {
        if (id !== requestId) return;
        const list = Array.isArray(files) ? files : [];
        for (const picked of list) {
          const file = nativeFileToFile(picked);
          if (file) collected.push(file);
        }
        finish();
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
