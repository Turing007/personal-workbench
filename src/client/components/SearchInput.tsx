import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { clearSearchHistory, loadSearchHistory, pushSearchHistory, removeSearchHistory } from '../search-history';

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
}

/** 输入停顿多久算「这一次搜索」，之后记入历史。产品库是即时筛选、没有搜索按钮，
 *  用停顿判定比要求按回车更贴合真实使用。 */
const HISTORY_COMMIT_DELAY_MS = 800;

/** 列表页统一的搜索框：右侧自带一键清空的小叉，有内容才出现。
 *  传 history 后聚焦时从下方拉出搜索历史幕布，点关键词直接填入并搜索。 */
export default function SearchInput({ value, onChange, placeholder, disabled = false, onFocus, onBlur, className, history = false }: SearchInputProps) {
  const [historyItems, setHistoryItems] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const commitTimer = useRef<number | undefined>(undefined);
  const blurTimer = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // 卸载时清掉两个定时器，避免在已卸载组件上更新状态。
  useEffect(() => () => {
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    if (blurTimer.current) window.clearTimeout(blurTimer.current);
  }, []);

  const commit = (keyword: string) => {
    if (!history || !keyword.trim()) return;
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
    commit(keyword);
    setHistoryOpen(false);
    // 焦点回到输入框：点胶囊后光标停在词尾，方便继续改词再搜。
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
    <div className={className ? `search-control ${className}` : 'search-control'}>
      <Search size={15} />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => {
          if (blurTimer.current) window.clearTimeout(blurTimer.current);
          openHistory();
          onFocus?.();
        }}
        // 输入框已经处于焦点时再点它不会再触发 focus：用 click 兜底重开幕布，
        // 否则点完一个胶囊想换另一个词时，幕布打不开（capsule 点完焦点在输入框内）。
        onClick={openHistory}
        onBlur={() => {
          // 点胶囊时输入框会先失焦：延后关闭，让点击落地。150ms 足够覆盖一次点击。
          if (history) blurTimer.current = window.setTimeout(() => setHistoryOpen(false), 150);
          onBlur?.();
        }}
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
      {showCurtain && (
        // 幕布用 div 而非 list：胶囊要能换行排布，点空白处不关（靠输入框失焦关），
        // 避免误触。mousedown 阻止默认，防止点击时输入框失焦导致的竞态。
        <div className="search-history-curtain" role="listbox" aria-label="最近搜索" onMouseDown={(event) => event.preventDefault()}>
          <div className="search-history-head">
            <span>最近搜索</span>
            <button type="button" className="search-history-clear" onClick={clearAll}>清空历史</button>
          </div>
          <div className="search-history-chips">
            {historyItems.map((keyword) => (
              <span className="search-history-chip" key={keyword}>
                <button type="button" className="search-history-chip-main" role="option" aria-selected="false" title={`搜索「${keyword}」`} onClick={() => pickKeyword(keyword)}>{keyword}</button>
                <button type="button" className="search-history-chip-remove" aria-label={`删除历史关键词 ${keyword}`} title="删除这条" onClick={() => removeKeyword(keyword)}><X size={11} /></button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
