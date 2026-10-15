// Peças partilhadas pelas páginas da Tesouraria.
import { useSearchParams } from 'react-router-dom';
import { useModuleCtx } from '../ModuleShell';
import { filtersFrom, useActivities, useOptions } from './api';

/** Só mostra/esconde: o servidor exige sempre a permissão «tesouraria.gerir». */
export function useCanManage() {
  return useModuleCtx().can('tesouraria.gerir', false);
}

/** Filtros no URL (sobrevivem ao «voltar»). */
export function FiltersBar({ withState }: { withState?: boolean }) {
  const [params, setParams] = useSearchParams();
  const f = filtersFrom(params);
  const opts = useOptions();
  const acts = useActivities();
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(window.location.search);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  const any = f.de || f.ate || f.categoria || f.atividade || (withState && f.estado);
  return (
    <form className="card flat fin-filters" aria-label="Filtros" onSubmit={(e) => e.preventDefault()}>
      <div className="fin-filter-grid">
        <label className="field">
          <span className="label">De</span>
          <input type="date" value={f.de ?? ''} onChange={(e) => set('de', e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Até</span>
          <input type="date" value={f.ate ?? ''} onChange={(e) => set('ate', e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Categoria</span>
          <select value={f.categoria ?? ''} onChange={(e) => set('categoria', e.target.value)}>
            <option value="">Todas</option>
            {(opts.data?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Atividade</span>
          <select value={f.atividade ?? ''} onChange={(e) => set('atividade', e.target.value)}>
            <option value="">Todas</option>
            {(acts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </label>
        {withState && (
          <label className="field">
            <span className="label">Estado</span>
            <select value={f.estado ?? ''} onChange={(e) => set('estado', e.target.value)}>
              <option value="">Todos</option>
              <option value="efetivo">Efetivo</option>
              <option value="pendente">Pendente</option>
              <option value="previsto">Previsto</option>
            </select>
          </label>
        )}
      </div>
      {any && (
        <button type="button" className="btn ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
          Limpar filtros
        </button>
      )}
    </form>
  );
}
