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
}

export function getAppBridge(): WorkbenchAppBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { workbenchApp?: WorkbenchAppBridge }).workbenchApp;
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
