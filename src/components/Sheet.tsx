import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function Sheet({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className={`sheet ${className}`} role="dialog" aria-label={title} onClick={event => event.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}

export function Toggle({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </label>
  );
}

export function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div className="segmented-row">
      <strong>{label}</strong>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map(option => (
          <button key={String(option.value)} role="radio" aria-checked={option.value === value} className={option.value === value ? 'active' : ''} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
