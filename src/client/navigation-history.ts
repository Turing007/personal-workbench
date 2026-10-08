/**
 * 应用内导航历史：让安卓壳的返回键（= 浏览器后退）逐级返回，而不是一点就收起 App。
 *
 * 规则：
 * - 页面切换时压一格历史（wbNav），返回键回到上一级菜单；
 * - 弹窗 /「更多」抽屉打开时也压一格（wbLayer），返回键先关最上面那层，
 *   关完再逐格回页面；UI 主动关层时把这一格退掉（back + suppress），两侧不打架；
 * - 历史退到底（登录后的第一页）时，壳里 canGoBack 为 false，会走 moveTaskToBack
 *   收起 App —— 这正是「首页再按返回才退出」的预期行为。
 */

interface CloseLayer {
  id: symbol;
  close: () => void;
}

const closeLayers: CloseLayer[] = [];
/** UI 主动关层时自己触发的 history.back() 数量；这些 popstate 不能再拿去关别的层。 */
let suppressPop = 0;
let currentPageKey: string | null = null;

/** 登记一个可被返回键关闭的层（弹窗 / 抽屉），同时压一格历史。重复登记同一个 id 时忽略。 */
export function registerCloseLayer(id: symbol, close: () => void): void {
  if (closeLayers.some((layer) => layer.id === id)) return;
  closeLayers.push({ id, close });
  try {
    window.history.pushState({ wbLayer: true }, '');
  } catch {
    /* 非浏览器环境忽略 */
  }
}

/** UI 主动关闭层时调用：把历史里那一格退掉。返回键已经关过它时这里找不到，直接忽略。 */
export function unregisterCloseLayer(id: symbol): void {
  const index = closeLayers.findIndex((layer) => layer.id === id);
  if (index < 0) return;
  closeLayers.splice(index, 1);
  suppressPop += 1;
  try {
    window.history.back();
  } catch {
    suppressPop -= 1;
  }
}

/** 由返回键触发页面切换后，同步当前页标记（用于去重，避免同一页重复压格）。 */
export function setCurrentPageKey(key: string): void {
  currentPageKey = key;
}

/** 页面切换时压一格历史；与当前页相同则不重复压。 */
export function pushPageKey(key: string): void {
  if (key === currentPageKey) return;
  currentPageKey = key;
  try {
    window.history.pushState({ wbNav: key }, '');
  } catch {
    /* 非浏览器环境忽略 */
  }
}

export interface NavigationHistoryOptions {
  initialKey: string;
  /** 返回键落回某个页面格时回调（调用方不要再次 push）。 */
  onNavigate: (key: string) => void;
}

export function initNavigationHistory(options: NavigationHistoryOptions): () => void {
  currentPageKey = options.initialKey;
  try {
    window.history.replaceState({ wbNav: options.initialKey }, '');
  } catch {
    /* 非浏览器环境忽略 */
  }

  const onPopState = () => {
    if (suppressPop > 0) {
      suppressPop -= 1;
      return;
    }
    const layer = closeLayers.pop();
    if (layer) {
      layer.close();
      return;
    }
    const key = (window.history.state as { wbNav?: unknown } | null)?.wbNav;
    if (typeof key === 'string' && key) options.onNavigate(key);
  };

  window.addEventListener('popstate', onPopState);
  return () => window.removeEventListener('popstate', onPopState);
}
