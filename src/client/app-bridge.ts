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
