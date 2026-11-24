// Menu de comandos: Ctrl+K (ou ⌘K no Mac) abre uma caixa para saltar para qualquer página.
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Search, User } from 'lucide-react';

export interface CommandItem {
  key: string;
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const SHORTCUT_LABEL = isMac ? '⌘K' : 'Ctrl K';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function CommandMenu({ items }: { items: CommandItem[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();

  const all = useMemo<CommandItem[]>(() => [
    ...items,
    { key: 'notificacoes', to: '/notificacoes', label: 'Notificações', icon: Bell },
    { key: 'perfil', to: '/perfil', label: 'Perfil', icon: User },
  ], [items]);
  const results = useMemo(() => {
    const t = norm(q.trim());
    return t ? all.filter((i) => norm(i.label).includes(t)) : all;
  }, [all, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setQ('');
      setActive(0);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const go = (i?: CommandItem) => {
    if (!i) return;
    setOpen(false);
    navigate(i.to, { viewTransition: true });
  };

  return (
    <>
      <button type="button" className="cmd-trigger" onClick={() => setOpen(true)} aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}>
        <Search size={16} aria-hidden="true" />
        <span className="cmd-trigger-label">Ir para…</span>
        <kbd className="kbd">{SHORTCUT_LABEL}</kbd>
      </button>
      <dialog ref={dialog} className="cmd-dialog" aria-label="Ir para" onClose={() => setOpen(false)} onCancel={(e) => { e.preventDefault(); setOpen(false); }}
        onClick={(e) => { if (e.target === dialog.current) setOpen(false); }}>
        <div className="cmd-box">
          <div className="cmd-search">
            <Search size={18} aria-hidden="true" />
            <input type="search" autoFocus aria-label="Procurar página" placeholder="Procurar página" value={q}
              role="combobox" aria-expanded="true" aria-controls="cmd-list" aria-activedescendant={results[active] ? `cmd-${results[active].key}` : undefined}
              onChange={(e) => { setQ(e.target.value); setActive(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
                else if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
                else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
              }} />
            <kbd className="kbd">Esc</kbd>
          </div>
          <ul id="cmd-list" role="listbox" className="cmd-list" aria-label="Páginas">
            {results.map((i, n) => (
              <li key={i.key} id={`cmd-${i.key}`} role="option" aria-selected={n === active}
                onMouseMove={() => setActive(n)} onClick={() => go(i)}>
                <i.icon size={18} aria-hidden="true" /> {i.label}
              </li>
            ))}
            {results.length === 0 && <li className="cmd-empty" role="option" aria-selected={false} aria-disabled="true">Nada encontrado.</li>}
          </ul>
        </div>
      </dialog>
    </>
  );
}
