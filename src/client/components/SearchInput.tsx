import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { clearSearchHistory, loadSearchHistory, pushSearchHistory, removeSearchHistory } from '../search-history';
import PickerCurtain from './PickerCurtain';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  /** 额外类名拼在 .search-control 之后（悬浮隐藏态、页面变体等）。 */
  className?: string;
  /**
   * 打开后启用搜索历史幕布：聚焦时弹出最近搜过的关键词（胶囊按钮，点一下即搜）。
   * 词条存本机 localStorage，不影响服务端。
   */
  history?: boolean;
  /**
   * 当前搜索词的结果数（由调用方给出）。停顿结束时若为 0 就**不记入历史** ——
   * 搜不到东西的词记下来只会让人下次点到一次空结果。
   * 不传则不限制（任何词都记）。
   */
  resultCount?: number;
}

/** 输入停顿多久算「这一次搜索」，之后记入历史。产品库是即时筛选、没有搜索按钮，
 *  用停顿判定比要求按回车更贴合真实使用。 */
const HISTORY_COMMIT_DELAY_MS = 800;

/** 列表页统一的搜索框：右侧自带一键清空的小叉，有内容才出现。
 *  传 history 后聚焦时从下方拉出搜索历史幕布，点关键词直接填入并搜索。 */
export default function SearchInput({ value, onChange, placeholder, disabled = false, onFocus, onBlur, className, history = false, resultCount }: SearchInputProps) {
  const [historyItems, setHistoryItems] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const commitTimer = useRef<number | undefined>(undefined);
  const blurCloseTimer = useRef<number | undefined>(undefined);
  /** 最近一次在幕布内按下鼠标/手指的时间；点胶囊/删词时会先让输入框失焦，不能算「离开」。 */
  const curtainPointerDownAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  /** 点胶囊后自己调 focus 会触发 onFocus：这一跳不该重新拉开幕布，用标记让 onFocus 跳过。 */
  const suppressFocusOpen = useRef(false);
  /**
   * 最新的结果数。停顿回调是 800ms 后才跑的，直接读 props 会拿到打字那一刻的旧值；
   * 用 ref 每次渲染同步，回调里读到的才是「停下来那一刻」的结果数。
   */
  const resultCountRef = useRef(resultCount);
  resultCountRef.current = resultCount;

  const openHistory = () => {
    if (!history) return;
    setHistoryItems(loadSearchHistory());
    setHistoryOpen(true);
  };

  // 打开时读一次历史；localStorage 读失败按空列表处理，不弹幕布。
  useEffect(() => {
    if (!history) return;
    setHistoryItems(loadSearchHistory());
  }, [history]);

  // 卸载时清掉定时器，避免在已卸载组件上更新状态。
  useEffect(() => () => {
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    if (blurCloseTimer.current) window.clearTimeout(blurCloseTimer.current);
  }, []);

  /** 失焦后稍等再收：点幕布里的胶囊/删除会先让输入框失焦，留出这一下点击的时间。 */
  const closeHistoryAfterBlur = () => {
    if (!history) return;
    if (blurCloseTimer.current) window.clearTimeout(blurCloseTimer.current);
    blurCloseTimer.current = window.setTimeout(() => {
      const active = document.activeElement as HTMLElement | null;
      // 焦点回到输入框、仍在幕布内部，或刚点过幕布里的按钮：说明用户还在操作，不关。
      if (active === inputRef.current || active?.closest('.picker-curtain')) return;
      if (Date.now() - curtainPointerDownAt.current < 600) return;
      setHistoryOpen(false);
    }, 120);
  };

  const commit = (keyword: string) => {
    if (!history || !keyword.trim()) return;
    // 停下来时一条结果都没有：这个词不记 —— 记下来只会让下次点到空结果。
    if (resultCountRef.current === 0) return;
    setHistoryItems((current) => pushSearchHistory(keyword, current));
  };

  const handleChange = (next: string) => {
    onChange(next);
    if (!history) return;
    // 停顿判定：连续打字时不记，停下来才记一次，避免「无」「无刷」「无刷电」各记一条。
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => commit(next), HISTORY_COMMIT_DELAY_MS);
  };

  const pickKeyword = (keyword: string) => {
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    onChange(keyword);
    // 用户主动从历史里点的词：无条件提到最前，不受「无结果不记」约束 ——
    // 它在历史里说明以前搜到过东西，点了只是复现那次搜索。
    if (history && keyword.trim()) setHistoryItems((current) => pushSearchHistory(keyword, current));
    // 先标记「这次 focus 是我自己发的」，避免 focus 的 onFocus 把幕布又弹回来。
    suppressFocusOpen.current = true;
    setHistoryOpen(false);
    // 焦点回到输入框：光标停在词尾，方便继续改词再搜。
    inputRef.current?.focus();
  };

  const removeKeyword = (keyword: string) => {
    setHistoryItems((current) => removeSearchHistory(keyword, current));
  };

  const clearAll = () => {
    setHistoryItems(clearSearchHistory());
    setHistoryOpen(false);
  };

  const showCurtain = history && historyOpen && historyItems.length > 0;

  return (
    <div ref={controlRef} className={className ? `search-control ${className}` : 'search-control'}>
      <Search size={15} />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => {
          // 重新获得焦点就取消待关闭，避免刚点回来又被旧定时器收起。
          if (blurCloseTimer.current) window.clearTimeout(blurCloseTimer.current);
          // 点胶囊后由代码触发的 focus 不再重开幕布（见 pickKeyword 的标记）。
          if (suppressFocusOpen.current) {
            suppressFocusOpen.current = false;
          } else {
            openHistory();
          }
          onFocus?.();
        }}
        // 输入框已经处于焦点时再点它不会再触发 focus：用 click 兜底重开幕布，
        // 否则点完一个胶囊想换另一个词时，幕布打不开。
        onClick={openHistory}
        // 失焦收起幕布；延迟 120ms 是为了让「点胶囊/删词」的点击先落到幕布上。
        onBlur={() => { onBlur?.(); closeHistoryAfterBlur(); }}
      />
      {!!value && !disabled && (
        <button
          type="button"
          className="search-clear"
          aria-label="清空搜索内容"
          title="清空"
          // 不让按钮抢走焦点：手机上点完叉键盘保持收起/展开状态，光标也还在输入框里。
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange('')}
        >
          <X size={14} />
        </button>
      )}
      <PickerCurtain
        open={showCurtain}
        onClose={() => setHistoryOpen(false)}
        anchorRef={controlRef}
        matchAnchorWidth
        closeOnScroll
        ariaLabel="最近搜索"
        className="search-history-curtain"
        onPointerDownInside={() => { curtainPointerDownAt.current = Date.now(); }}
      >
        <div className="search-history-head">
          <span>最近搜索</span>
          <button type="button" className="search-history-clear" onClick={clearAll}>清空历史</button>
        </div>
        <div className="search-history-chips">
          {historyItems.map((keyword) => (
            <span className="search-history-chip" key={keyword}>
              <button type="button" className="search-history-chip-main" title={`搜索「${keyword}」`} onClick={() => pickKeyword(keyword)}>{keyword}</button>
              <button type="button" className="search-history-chip-remove" aria-label={`删除历史关键词 ${keyword}`} title="删除这条" onClick={() => removeKeyword(keyword)}><X size={11} /></button>
            </span>
          ))}
        </div>
      </PickerCurtain>
    </div>
  );
}
