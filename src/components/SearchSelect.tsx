// Escolha de uma opção numa lista pesquisável (combobox acessível). Guarda sempre o id da
// opção, nunca o texto escrito. Com poucas opções usa um <select> simples.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SearchOption { id: string; label: string; detail?: string; disabled?: boolean }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function SearchSelect({ id, value, onChange, options, placeholder = 'Procurar', empty, invalid, loading, listLabel = 'Opções', minSearch = 12, none = 'Sem resultados.' }: {
  id: string;
  value: string;
  onChange: (id: string) => void;
  options: SearchOption[];
  placeholder?: string;
  /** Primeira opção vazia (ex.: «Nenhuma»); sem ela, não há como limpar a escolha. */
  empty?: string;
  invalid?: boolean;
  loading?: boolean;
  listLabel?: string;
  /** A partir de quantas opções passa a ter pesquisa. */
  minSearch?: number;
  none?: string;
}) {
  const chosen = options.find((o) => o.id === value) ?? null;
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => { if (!open) setText(chosen?.label ?? ''); }, [open, chosen?.label]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const shown = useMemo(() => {
    const q = norm(text.trim());
    const all = options.filter((o) => !o.disabled || o.id === value);
    if (!q || (chosen && text === chosen.label)) return all;
    return all.filter((o) => norm(`${o.label} ${o.detail ?? ''}`).includes(q));
  }, [options, text, chosen, value]);

  if (options.length < minSearch) {
    return (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} disabled={loading}>
        <option value="">{loading ? 'A carregar…' : empty ?? placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id} disabled={o.disabled && o.id !== value}>{o.label}{o.detail ? ` · ${o.detail}` : ''}</option>
        ))}
      </select>
    );
  }

  const pick = (o: SearchOption | null) => { onChange(o?.id ?? ''); setText(o?.label ?? ''); setOpen(false); };
  return (
    <div className="search-select" ref={box}>
      <div className="search-select-input">
        <input id={id} type="text" role="combobox" autoComplete="off" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          aria-activedescendant={open && shown[active] ? `${listId}-${shown[active].id}` : undefined}
          placeholder={loading ? 'A carregar…' : placeholder} value={text}
          onFocus={(e) => { setOpen(true); setActive(0); e.target.select(); }}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); if (value) onChange(''); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' && open && shown[active]) { e.preventDefault(); pick(shown[active]); }
            else if (e.key === 'Escape') setOpen(false);
          }} />
        <ChevronDown size={16} aria-hidden="true" />
      </div>
      {open && (
        <ul className="search-select-list" id={listId} role="listbox" aria-label={listLabel}>
          {empty && value && (
            <li role="option" aria-selected={false} className="faint" onMouseDown={(e) => { e.preventDefault(); pick(null); }}>{empty}</li>
          )}
          {shown.map((o, i) => (
            <li key={o.id} id={`${listId}-${o.id}`} role="option" aria-selected={o.id === value}
              className={i === active ? 'is-active' : undefined}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setActive(i)}>
              <span>{o.label}</span>
              {o.detail && <span className="faint">{o.detail}</span>}
            </li>
          ))}
          {shown.length === 0 && <li className="faint search-select-none">{none}</li>}
        </ul>
      )}
    </div>
  );
}
