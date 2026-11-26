import { useEffect, useRef, useState, type CSSProperties } from 'react';

export interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** 只允许整数（装箱数、数量等）。 */
  integer?: boolean;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
}

/**
 * 数字输入：编辑时允许清空，失焦才收敛到合法值。
 * 直接绑定 number 的输入在删掉最后一位时会立刻被最小值填回，手机软键盘上表现为「数字删不掉」。
 */
export default function NumberField({ value, onChange, min = 0, max, step, integer = false, className, style, ariaLabel, placeholder, title, disabled = false }: NumberFieldProps) {
  const [text, setText] = useState(() => String(value));
  const lastValue = useRef(value);

  useEffect(() => {
    if (value === lastValue.current) return;
    lastValue.current = value;
    setText((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  const clamp = (raw: number) => {
    let next = Number.isFinite(raw) ? raw : min;
    if (integer) next = Math.trunc(next);
    if (max != null) next = Math.min(max, next);
    return Math.max(min, next);
  };

  return <input
    type="number"
    inputMode={integer ? 'numeric' : 'decimal'}
    min={min}
    max={max}
    step={step}
    className={className}
    style={style}
    aria-label={ariaLabel}
    disabled={disabled}
    placeholder={placeholder}
    title={title}
    value={text}
    onChange={(event) => {
      const raw = event.target.value;
      setText(raw);
      if (raw === '') return;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      onChange(clamp(parsed));
    }}
    onBlur={() => {
      const next = clamp(Number(text));
      lastValue.current = next;
      setText(String(next));
      if (next !== value) onChange(next);
    }}
  />;
}
