import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useIsNarrow } from '../use-is-narrow';

export interface CollapsibleSectionProps {
  title: string;
  /** 折叠状态下显示的摘要（例如已填内容提示）。 */
  summary?: string;
  /** 手机端默认是否展开；桌面端始终展开、不显示折叠按钮。 */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * 表单分区：手机端可折叠，减少长表单的滚动距离；桌面端保持原样（始终展开）。
 */
export default function CollapsibleSection({ title, summary, defaultOpen = false, children }: CollapsibleSectionProps) {
  const isNarrow = useIsNarrow();
  const [open, setOpen] = useState(defaultOpen);

  if (!isNarrow) {
    return <section className="form-section">
      <h3 className="form-section-heading">{title}</h3>
      {children}
    </section>;
  }

  return <section className={`form-section${open ? ' is-open' : ''}`}>
    <button
      type="button"
      className="form-section-toggle"
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
    >
      <span className="form-section-title">{title}</span>
      {!open && summary && <em className="form-section-summary">{summary}</em>}
      <ChevronDown size={16} className="form-section-chevron" />
    </button>
    {open && <div className="form-section-body">{children}</div>}
  </section>;
}
