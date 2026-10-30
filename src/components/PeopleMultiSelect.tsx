// Escolha de várias pessoas numa lista pesquisável (combobox acessível, como o SearchSelect):
// pesquisa por nome ou equipa, os escolhidos em etiquetas removíveis e «Juntar a equipa»
// para acrescentar uma equipa inteira. Guarda sempre ids, nunca texto livre.
// Teclado: setas para percorrer, Enter para escolher ou tirar, Escape para fechar e
// Backspace (com a pesquisa vazia) para tirar a última etiqueta.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

export interface PersonOption { id: string; label: string; team?: string | null; detail?: string; disabled?: boolean; disabledNote?: string }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function PeopleMultiSelect({ id, value, onChange, options, loading, placeholder = 'Procurar pelo nome ou equipa', listLabel = 'Pessoas' }: {
  id: string;
  value: string[];
  onChange: (ids: string[]) => void;
  options: PersonOption[];
  loading?: boolean;
  placeholder?: string;
  listLabel?: string;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const chosen = new Set(value);
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);

  useEffect(() => {
    const close = (e: MouseEvent | TouchEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, []);

  const shown = useMemo(() => {
    const q = norm(text.trim());
    return q ? options.filter((o) => norm(`${o.label} ${o.team ?? ''}`).includes(q)) : options;
  }, [options, text]);

  const teams = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const o of options) if (o.team && !o.disabled) out.set(o.team, [...(out.get(o.team) ?? []), o.id]);
    return [...out].sort(([a], [b]) => a.localeCompare(b, 'pt'));
  }, [options]);

  const toggle = (o: PersonOption) => {
    if (o.disabled) return;
    onChange(chosen.has(o.id) ? value.filter((x) => x !== o.id) : [...value, o.id]);
  };
  const addTeam = (name: string) => {
    const ids = teams.find(([t]) => t === name)?.[1] ?? [];
    onChange([...value, ...ids.filter((x) => !chosen.has(x))]);
  };

  return (
    <div className="multi-select" ref={box}>
      {value.length > 0 && (
        <ul className="multi-select-tags" aria-label="Escolhidos">
          {value.map((v) => {
            const o = byId.get(v);
            const name = o?.label ?? 'Pessoa';
            return (
              <li key={v} className="multi-select-tag">
                <span>{name}{o?.team ? <span className="faint"> · {o.team}</span> : null}</span>
                <button type="button" className="multi-select-remove" aria-label={`Tirar ${name}`}
                  onClick={() => { onChange(value.filter((x) => x !== v)); input.current?.focus(); }}>
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="search-select">
        <div className="search-select-input">
          <input ref={input} id={id} type="text" role="combobox" autoComplete="off" aria-expanded={open} aria-controls={listId}
            aria-autocomplete="list" aria-activedescendant={open && shown[active] ? `${listId}-${shown[active].id}` : undefined}
            placeholder={loading ? 'A carregar…' : placeholder} value={text}
            onFocus={() => { setOpen(true); setActive(0); }}
            onClick={() => setOpen(true)}
            onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter') { if (open && shown[active]) { e.preventDefault(); toggle(shown[active]); } }
              else if (e.key === 'Escape') { if (open) { e.preventDefault(); setOpen(false); } }
              else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
            }} />
          <ChevronDown size={16} aria-hidden="true" />
        </div>
        {open && (
          <ul className="search-select-list multi-select-list" id={listId} role="listbox" aria-label={listLabel} aria-multiselectable="true">
            {shown.map((o, i) => {
              const on = chosen.has(o.id);
              return (
                <li key={o.id} id={`${listId}-${o.id}`} role="option" aria-selected={on} aria-disabled={o.disabled || undefined}
                  className={`${i === active ? 'is-active' : ''}${o.disabled ? ' is-disabled' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); toggle(o); }} onMouseEnter={() => setActive(i)}>
                  <span className="multi-select-check" aria-hidden="true">{on && <Check size={14} />}</span>
                  <span className="multi-select-text">
                    <span>{o.label}</span>
                    {(o.disabled && o.disabledNote) || o.team || o.detail
                      ? <span className="faint">{[o.disabled ? o.disabledNote : null, o.team, o.detail].filter(Boolean).join(' · ')}</span>
                      : null}
                  </span>
                </li>
              );
            })}
            {shown.length === 0 && <li className="faint search-select-none">Ninguém com esse nome.</li>}
          </ul>
        )}
      </div>
      {teams.length > 0 && (
        <div className="multi-select-team">
          <label className="sr-only" htmlFor={`${id}-team`}>Juntar uma equipa inteira</label>
          <select id={`${id}-team`} value="" onChange={(e) => { if (e.target.value) addTeam(e.target.value); }}>
            <option value="">Juntar uma equipa inteira…</option>
            {teams.map(([t, ids]) => (
              <option key={t} value={t} disabled={ids.every((x) => chosen.has(x))}>{t} ({ids.length})</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
