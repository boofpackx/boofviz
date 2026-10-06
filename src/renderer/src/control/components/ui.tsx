import { useId, type ReactNode } from 'react';

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-ink-700/70 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold tracking-[0.14em] text-ink-400 uppercase">{title}</h3>
        {right}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  defaultValue?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

/** Dense labelled slider. Double-click resets to the default. */
export function Slider({ label, value, min, max, step = 0.01, unit = '', defaultValue, format, onChange }: SliderProps) {
  const id = useId();
  const text = format ? format(value) : `${Number.isInteger(step) ? value.toFixed(0) : value.toFixed(2)}${unit}`;
  return (
    <div className="grid grid-cols-[84px_1fr_52px] items-center gap-2" onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}>
      <label htmlFor={id} className="truncate text-ink-300">
        {label}
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="text-right font-mono text-[11px] text-ink-200 tabular-nums">{text}</span>
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button
      type="button"
      title={hint}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded px-0 py-0.5 text-left text-ink-300 hover:text-ink-100"
    >
      <span>{label}</span>
      <span className={`relative h-3.5 w-7 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-ink-600'}`}>
        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${checked ? 'left-4' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string; disabled?: boolean; title?: string }>; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded border border-ink-600 bg-ink-850 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-sm px-2 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
            o.value === value ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Button({ children, onClick, active, title, tone = 'default', className = '' }: { children: ReactNode; onClick: () => void; active?: boolean; title?: string; tone?: 'default' | 'accent' | 'danger'; className?: string }) {
  const tones = {
    default: active ? 'border-ink-400 bg-ink-600 text-ink-100' : 'border-ink-600 bg-ink-800 text-ink-200 hover:bg-ink-700',
    accent: 'border-accent/60 bg-accent/15 text-ink-100 hover:bg-accent/25',
    danger: active ? 'border-bad bg-bad/80 text-white' : 'border-ink-600 bg-ink-800 text-ink-200 hover:border-bad/70',
  };
  return (
    <button type="button" title={title} onClick={onClick} className={`rounded border px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${tones[tone]} ${className}`}>
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-ink-600 bg-ink-800 px-1 font-mono text-[10px] text-ink-300">{children}</kbd>;
}
