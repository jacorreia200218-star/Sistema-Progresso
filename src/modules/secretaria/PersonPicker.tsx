// Seletor pesquisável de uma pessoa da secção (guarda o id do utilizador, nunca texto livre).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { functionLabel } from '../../lib/labels';
import type { MemberFunction } from '../../lib/types';
import { usePeople, type Person } from './api';

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function PersonPicker({ id, value, onChange, invalid }: { id: string; value: string; onChange: (id: string) => void; invalid?: boolean }) {
  const people = usePeople();
  const list = people.data ?? [];
  const chosen = list.find((p) => p.id === value) ?? null;
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => { if (!open) setText(chosen?.name ?? ''); }, [open, chosen?.name]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const shown = useMemo(() => {
    const q = norm(text.trim());
    if (!q || (chosen && text === chosen.name)) return list;
    return list.filter((p) => norm(`${p.name} ${p.team_name ?? ''}`).includes(q));
  }, [list, text, chosen]);

  const pick = (p: Person) => { onChange(p.id); setText(p.name); setOpen(false); };
  const detail = (p: Person) => [p.function && functionLabel[p.function as MemberFunction], p.team_name].filter(Boolean).join(' · ');

  return (
    <div className="person-picker" ref={box}>
      <div className="person-picker-input">
        <input id={id} type="text" role="combobox" autoComplete="off" aria-expanded={open} aria-controls={listId} aria-invalid={invalid || undefined}
          aria-activedescendant={open && shown[active] ? `${listId}-${shown[active].id}` : undefined}
          placeholder={people.isLoading ? 'A carregar…' : 'Procurar pelo nome'} value={text}
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
        <ul className="person-picker-list" id={listId} role="listbox" aria-label="Pessoas da secção">
          {shown.map((p, i) => (
            <li key={p.id} id={`${listId}-${p.id}`} role="option" aria-selected={p.id === value}
              className={i === active ? 'is-active' : undefined}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setActive(i)}>
              <span>{p.name}</span>
              {detail(p) && <span className="faint">{detail(p)}</span>}
            </li>
          ))}
          {shown.length === 0 && <li className="faint person-picker-none">Ninguém com esse nome.</li>}
        </ul>
      )}
    </div>
  );
}
