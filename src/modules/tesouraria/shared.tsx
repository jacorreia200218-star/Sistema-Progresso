// Peças partilhadas pelas páginas da Tesouraria.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useModuleCtx } from '../ModuleShell';
import { todayLisbon } from '../common';
import { filtersFrom, monthLabel, scoutMonths, scoutYearLabel, scoutYearOf, useActivities, useOptions } from './api';

/** Só mostra/esconde: o servidor exige sempre a permissão «tesouraria.gerir». */
export function useCanManage() {
  return useModuleCtx().can('tesouraria.gerir', false);
}

/** Atualiza parâmetros do URL a partir do endereço atual (sobrevivem ao «voltar»). */
export function useSetParam() {
  const [, setParams] = useSearchParams();
  return (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    setParams(next, { replace: true });
  };
}

/**
 * Filtros no URL: ano escutista (setembro–agosto), mês e atividade; na lista de movimentos
 * também categoria, estado e pesquisa.
 */
export function FiltersBar({ years = [], extended }: { years?: number[]; extended?: boolean }) {
  const [params, setParams] = useSearchParams();
  const f = filtersFrom(params);
  const set = useSetParam();
  const opts = useOptions();
  const acts = useActivities();
  const current = scoutYearOf(todayLisbon());
  const yearList = [...new Set([current, ...years, ...(f.ano === 'todos' ? [] : [f.ano])])].sort((a, b) => b - a);
  const [q, setQ] = useState(f.q ?? '');
  // Pesquisa: atualiza o URL pouco depois de parar de escrever.
  useEffect(() => {
    if (!extended) return;
    const t = window.setTimeout(() => { if ((f.q ?? '') !== q.trim()) set({ q: q.trim() || null }); }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const any = params.has('ano') || f.mes || f.atividade || (extended && (f.categoria || f.estado || f.q));

  return (
    <form className="card flat fin-filters" aria-label="Filtros" onSubmit={(e) => { e.preventDefault(); set({ q: q.trim() || null }); }}>
      {extended && (
        <label className="field fin-search">
          <span className="label">Pesquisar</span>
          <span className="fin-search-box">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={q} maxLength={100} placeholder="Descrição, categoria ou atividade" onChange={(e) => setQ(e.target.value)} />
          </span>
        </label>
      )}
      <div className={`fin-filter-grid${extended ? ' wide' : ''}`}>
        <label className="field">
          <span className="label">Ano escutista</span>
          <select value={String(f.ano)} onChange={(e) => set({ ano: e.target.value === String(current) ? null : e.target.value, mes: null })}>
            {yearList.map((y) => <option key={y} value={y}>{scoutYearLabel(y)}{y === current ? ' (atual)' : ''}</option>)}
            <option value="todos">Todo o período</option>
          </select>
        </label>
        <label className="field">
          <span className="label">Mês</span>
          <select value={f.mes ?? ''} disabled={f.ano === 'todos'} onChange={(e) => set({ mes: e.target.value || null })}>
            <option value="">Todos os meses</option>
            {f.ano !== 'todos' && scoutMonths(f.ano).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Atividade</span>
          <select value={f.atividade ?? ''} onChange={(e) => set({ atividade: e.target.value || null })}>
            <option value="">Todas</option>
            {(acts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </label>
        {extended && (
          <>
            <label className="field">
              <span className="label">Categoria</span>
              <select value={f.categoria ?? ''} onChange={(e) => set({ categoria: e.target.value || null })}>
                <option value="">Todas</option>
                {(opts.data?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="label">Estado</span>
              <select value={f.estado ?? ''} onChange={(e) => set({ estado: e.target.value || null })}>
                <option value="">Todos</option>
                <option value="efetivo">Efetivo</option>
                <option value="pendente">Pendente</option>
                <option value="previsto">Previsto</option>
              </select>
            </label>
          </>
        )}
      </div>
      {any && (
        <button type="button" className="btn ghost" onClick={() => { setQ(''); setParams(new URLSearchParams(), { replace: true }); }}>
          Limpar filtros
        </button>
      )}
    </form>
  );
}
