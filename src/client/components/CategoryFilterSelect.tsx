import { ChevronDown, X } from 'lucide-react';
import { useRef, useState } from 'react';
import PickerCurtain from './PickerCurtain';

export interface CategoryOption {
  value: string;
  label: string;
  /** 该分类下的产品数；「全部分类」不显示数量。 */
  count?: number;
}

export interface CategoryFilterSelectProps {
  value: string;
  options: CategoryOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * 分类筛选：外观是工具条按钮（显示当前选中项），点开拉出幕布，分类以胶囊排布、
 * 点一下即筛选 —— 与搜索历史的幕布同一套交互。不用原生 select：手机端原生选择器
 * 与页面风格割裂，也没法像胶囊那样一眼看全。
 */
export default function CategoryFilterSelect({ value, options, onChange, ariaLabel = '分类筛选', className, disabled = false }: CategoryFilterSelectProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value) ?? options[0];

  return (
    <div ref={anchorRef} className={className ? `category-filter ${className}` : 'category-filter'}>
      <button
        type="button"
        className="toolbar-select category-filter-trigger products-category-filter"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="category-filter-label">{current?.label ?? '全部分类'}</span>
        <ChevronDown size={13} />
      </button>
      <PickerCurtain
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        wide
        ariaLabel={ariaLabel}
        className="category-filter-curtain"
      >
        <div className="search-history-head">
          <span>按分类筛选</span>
          {value !== options[0]?.value && (
            <button
              type="button"
              className="search-history-clear"
              title="清除分类筛选"
              onClick={() => { onChange(options[0]?.value ?? ''); setOpen(false); }}
            ><X size={11} />清除</button>
          )}
        </div>
        <div className="search-history-chips">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`category-chip${option.value === value ? ' is-selected' : ''}`}
              aria-pressed={option.value === value}
              onClick={() => { onChange(option.value); setOpen(false); }}
            >
              {option.label}
              {option.count != null && <em>{option.count}</em>}
            </button>
          ))}
        </div>
      </PickerCurtain>
    </div>
  );
}
