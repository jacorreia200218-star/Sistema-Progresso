// Navegação contextual e blocos compactos partilhados: migalhas (Início › Progresso
// › Área › Trilho), cartões-resumo com hiperligação e painel lateral/folha.
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, X } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;
}

/** Migalhas de navegação; o último elemento é a página atual. */
export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Estás em" className="crumbs">
      <ol>
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`}>
            {i > 0 && <ChevronRight size={14} aria-hidden="true" />}
            {c.to && i < items.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export type StatTone = 'azul' | 'verde' | 'ambar' | 'lilas';

export interface Stat {
  label: string;
  value: ReactNode;
  hint?: string;
  to: string;
  tone: StatTone;
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>;
}

/** Cartões-resumo: cada um é uma hiperligação real para a vista já filtrada. */
export function StatCards({ items, label }: { items: Stat[]; label: string }) {
  return (
    <ul className="stats" aria-label={label}>
      {items.map((s) => (
        <li key={s.label}>
          <Link to={s.to} className={`stat stat-${s.tone}`}>
            <span className="stat-icon"><s.icon size={20} aria-hidden="true" /></span>
            <span className="stat-value">{s.value}</span>
            <span className="stat-label">{s.label}</span>
            {s.hint && <span className="stat-hint">{s.hint}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Painel de detalhe: lateral no computador, folha inferior no telemóvel.
 * Fecha com Esc, com o botão ou tocando fora (telemóvel); devolve o foco a quem o abriu.
 */
export function SidePanel({ title, onClose, children, labelledBy }: { title: string; onClose: () => void; children: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [onClose]);
  const id = labelledBy ?? 'painel-titulo';
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="side-panel" ref={ref} tabIndex={-1} role="dialog" aria-labelledby={id}>
        <div className="side-panel-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="btn ghost icon-btn" aria-label="Fechar" onClick={onClose}><X size={20} aria-hidden="true" /></button>
        </div>
        <div className="side-panel-body">{children}</div>
      </aside>
    </>
  );
}
