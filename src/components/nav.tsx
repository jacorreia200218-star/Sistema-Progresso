// Navegação contextual e blocos compactos partilhados: migalhas (Início › Progresso
// › Área › Trilho), cartões-resumo com hiperligação e painel lateral/folha.
import React, { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
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

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Número que conta até ao valor (meio segundo); sem animação se o sistema pedir menos movimento. */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  const from = useRef(shown);
  useEffect(() => {
    if (reducedMotion() || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 500);
      const eased = 1 - (1 - k) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown}</>;
}

/** Cartões-resumo: cada um é uma hiperligação real para a vista já filtrada. */
export function StatCards({ items, label }: { items: Stat[]; label: string }) {
  return (
    <ul className="stats" aria-label={label}>
      {items.map((s) => (
        <li key={s.label}>
          <Link to={s.to} className={`stat stat-${s.tone}`}>
            <span className="stat-icon"><s.icon size={20} aria-hidden="true" /></span>
            {/* Valores em texto (ex.: nome da etapa) usam letra menor e nunca partem a palavra. */}
            <span className={`stat-value${typeof s.value === 'string' && Number.isNaN(Number(s.value)) ? ' is-text' : ''}`}>
              {typeof s.value === 'number' && Number.isInteger(s.value) && s.value >= 0 ? <CountUp value={s.value} /> : s.value}
            </span>
            <span className="stat-label">{s.label}</span>
            {s.hint && <span className="stat-hint">{s.hint}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Folha do telemóvel: arrastar para baixo fecha (mais de 90 px ou um gesto rápido);
 * a meio do gesto pode-se voltar atrás e a folha regressa ao lugar.
 */
function useSwipeDown(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const start = useRef<{ y: number; t: number; id: number } | null>(null);
  const isSheet = () => typeof window !== 'undefined' && !window.matchMedia('(min-width: 960px)').matches;
  const set = (dy: number, animate: boolean) => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1)' : 'none';
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (!isSheet() || (e.target as Element).closest('button, a, input, select, textarea')) return;
      start.current = { y: e.clientY, t: performance.now(), id: e.pointerId };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!start.current || e.pointerId !== start.current.id) return;
      set(Math.max(0, e.clientY - start.current.y), false);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s0 = start.current;
      if (!s0 || e.pointerId !== s0.id) return;
      start.current = null;
      const dy = e.clientY - s0.y;
      const speed = dy / Math.max(1, performance.now() - s0.t);
      if (dy > 90 || (dy > 30 && speed > 0.6)) onClose();
      else set(0, true);
    },
    onPointerCancel: () => { start.current = null; set(0, true); },
  };
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
  const drag = useSwipeDown(ref, onClose);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="side-panel" ref={ref} tabIndex={-1} role="dialog" aria-labelledby={id}>
        <div className="sheet-grip" aria-hidden="true" {...drag} />
        <div className="side-panel-head" {...drag}>
          <h2 id={id}>{title}</h2>
          <button type="button" className="btn ghost icon-btn" aria-label="Fechar" onClick={onClose}><X size={20} aria-hidden="true" /></button>
        </div>
        <div className="side-panel-body">{children}</div>
      </aside>
    </>
  );
}
