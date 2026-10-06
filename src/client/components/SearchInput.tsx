import { Search, X } from 'lucide-react';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  /** 额外类名拼在 .search-control 之后（悬浮隐藏态、页面变体等）。 */
  className?: string;
}

/** 列表页统一的搜索框：右侧自带一键清空的小叉，有内容才出现。 */
export default function SearchInput({ value, onChange, placeholder, disabled = false, onFocus, onBlur, className }: SearchInputProps) {
  return (
    <div className={className ? `search-control ${className}` : 'search-control'}>
      <Search size={15} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={onFocus}
        onBlur={onBlur}
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
    </div>
  );
}
