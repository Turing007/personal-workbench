import { ChevronLeft, Pencil, Plus, RotateCcw, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { SavedFilterView } from '../filter-views';

export interface FilterOption<T extends string | number> {
  value: T;
  label: string;
  count?: number;
}

export interface FilterCheckListProps<T extends string | number> {
  title: string;
  options: FilterOption<T>[];
  selected: readonly T[];
  onChange: (selected: T[]) => void;
  searchable?: boolean;
  emptyText?: string;
}

/** 左侧筛选栏里的多选列表；选项多时带搜索，避免客户/公司列表过长。 */
export function FilterCheckList<T extends string | number>({
  title,
  options,
  selected,
  onChange,
  searchable = true,
  emptyText = '暂无可选项',
}: FilterCheckListProps<T>) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () => needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options,
    [needle, options],
  );
  const selectedSet = new Set(selected);
  const toggle = (value: T) => {
    onChange(selectedSet.has(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };
  return <section className="filter-rail-section">
    <div className="filter-rail-section-head">
      <strong>{title}</strong>
      {selected.length > 0 && <button type="button" onClick={() => onChange([])}>清空</button>}
    </div>
    {searchable && options.length > 7 && <input className="filter-rail-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${title}`} aria-label={`搜索${title}`} />}
    <div className="filter-check-list">
      {visible.map((option) => <label key={String(option.value)} className={`filter-check-option${selectedSet.has(option.value) ? ' is-checked' : ''}`}>
        <input type="checkbox" checked={selectedSet.has(option.value)} onChange={() => toggle(option.value)} />
        <span>{option.label}</span>
        {option.count != null && <b>{option.count}</b>}
      </label>)}
      {!visible.length && <span className="filter-rail-empty">{emptyText}</span>}
    </div>
  </section>;
}

export interface FilterRailProps {
  open: boolean;
  onToggle: () => void;
  views: SavedFilterView<unknown>[];
  activeViewId?: string;
  modified: boolean;
  onApplyView: (viewId: string) => void;
  onClearActive: () => void;
  onSaveView: (name: string) => void;
  onUpdateView: () => void;
  onRenameView: (viewId: string, name: string) => void;
  onDeleteView: (viewId: string) => void;
  onReset: () => void;
  children: ReactNode;
}

/** 桌面端可折叠筛选栏；手机端由 CSS 隐藏，继续使用页面原有工具条。 */
export default function FilterRail({
  open,
  onToggle,
  views,
  activeViewId,
  modified,
  onApplyView,
  onClearActive,
  onSaveView,
  onUpdateView,
  onRenameView,
  onDeleteView,
  onReset,
  children,
}: FilterRailProps) {
  if (!open) {
    return <button type="button" className="filter-rail-collapsed" title="展开筛选" aria-label="展开筛选" onClick={onToggle}>
      <SlidersHorizontal size={16} />
      <span>筛选</span>
    </button>;
  }
  return <aside className="filter-rail" aria-label="筛选">
    <div className="filter-rail-head">
      <strong><SlidersHorizontal size={15} />筛选</strong>
      <button type="button" className="icon-button" title="收起筛选" aria-label="收起筛选" onClick={onToggle}><ChevronLeft size={15} /></button>
    </div>

    <section className="filter-rail-views">
      <div className="filter-rail-section-head"><strong>常用视图</strong>{modified && <span>已修改</span>}</div>
      <select className="toolbar-select" aria-label="常用视图" value={activeViewId ?? ''} onChange={(event) => { if (event.target.value) onApplyView(event.target.value); else onClearActive(); }}>
        <option value="">选择常用视图</option>
        {views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
      </select>
      <div className="filter-rail-view-actions">
        <button type="button" className="icon-button" title="保存当前筛选为常用视图" aria-label="保存当前筛选" onClick={() => {
          const name = window.prompt('给这个常用视图起个名字', '我的待处理');
          if (name?.trim()) onSaveView(name.trim());
        }}><Plus size={14} /></button>
        <button type="button" className="icon-button" title={modified ? '更新当前视图' : '当前视图未修改'} aria-label="更新当前视图" disabled={!activeViewId || !modified} onClick={onUpdateView}><Save size={14} /></button>
        <button type="button" className="icon-button" title="重命名当前视图" aria-label="重命名当前视图" disabled={!activeViewId} onClick={() => {
          const view = views.find((item) => item.id === activeViewId);
          const name = view ? window.prompt('新的视图名称', view.name) : null;
          if (view && name?.trim()) onRenameView(view.id, name.trim());
        }}><Pencil size={14} /></button>
        <button type="button" className="icon-button danger" title="删除当前视图" aria-label="删除当前视图" disabled={!activeViewId} onClick={() => {
          const view = views.find((item) => item.id === activeViewId);
          if (!view || !window.confirm(`删除常用视图“${view.name}”？`)) return;
          onDeleteView(view.id);
        }}><Trash2 size={14} /></button>
      </div>
    </section>

    <div className="filter-rail-body">{children}</div>
    <button type="button" className="filter-rail-reset" onClick={onReset}><RotateCcw size={13} />重置全部筛选</button>
  </aside>;
}
