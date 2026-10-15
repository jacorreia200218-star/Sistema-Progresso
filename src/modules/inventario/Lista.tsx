// Lista do material com pesquisa e filtros (categoria, estado, localização, texto)
// guardados no endereço, para sobreviverem ao «voltar».
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, MapPin, Plus, Search } from 'lucide-react';
import { Empty, ErrorBox, Loading, PageTitle } from '../../components/ui';
import { InvTabs, StateBadges, availabilityText } from './parts';
import { STATE_LABEL, norm, useOverview, type ItemState } from './api';

export function Lista() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const cat = params.get('categoria') ?? '';
  const est = (params.get('estado') ?? '') as ItemState | '';
  const loc = params.get('local') ?? '';
  const archived = params.get('arquivados') === '1';
  const ov = useOverview(archived);
  const set = (k: string, v: string) => {
    // Parte do endereço atual: duas mudanças seguidas não se anulam.
    setParams(() => {
      const next = new URLSearchParams(window.location.search);
      if (v) next.set(k, v); else next.delete(k);
      return next;
    }, { replace: true });
  };

  const items = (ov.data?.items ?? [])
    .filter((i) => !cat || (cat === 'sem' ? !i.category_id : i.category_id === cat))
    .filter((i) => !est || i.stock.states.includes(est))
    .filter((i) => !loc || i.location === loc)
    .filter((i) => !q.trim() || norm([i.name, i.description, i.category, i.location].filter(Boolean).join(' ')).includes(norm(q.trim())));
  const filtered = !!(q || cat || est || loc);

  return (
    <div className="inv-page">
      <PageTitle title="Inventário" subtitle="Material da secção, empréstimos e reservas." />
      <InvTabs />
      <div className="grid-filters inv-filters">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Pesquisar material</span>
          <input type="search" placeholder="Pesquisar material" value={q} onChange={(e) => set('q', e.target.value)} />
        </label>
        <select aria-label="Filtrar por categoria" value={cat} onChange={(e) => set('categoria', e.target.value)}>
          <option value="">Todas as categorias</option>
          {(ov.data?.categories ?? []).filter((c) => !c.archived || c.id === cat).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="sem">Sem categoria</option>
        </select>
        <select aria-label="Filtrar por estado" value={est} onChange={(e) => set('estado', e.target.value)}>
          <option value="">Todos os estados</option>
          {(Object.keys(STATE_LABEL) as ItemState[]).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
        </select>
        <select aria-label="Filtrar por localização" value={loc} onChange={(e) => set('local', e.target.value)}>
          <option value="">Todas as localizações</option>
          {(ov.data?.locations ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <div className="row between inv-listbar">
        <label className="checkbox inv-inline-check">
          <input type="checkbox" checked={archived} onChange={(e) => set('arquivados', e.target.checked ? '1' : '')} /> Ver arquivados
        </label>
        <span className="faint" aria-live="polite">{items.length} {items.length === 1 ? 'artigo' : 'artigos'}</span>
        {ov.data?.can_manage && (
          <Link to="/inventario/novo" className="btn"><Plus size={16} aria-hidden="true" /> Novo artigo</Link>
        )}
      </div>

      {ov.isLoading ? <Loading /> : ov.error ? <ErrorBox error={ov.error} retry={() => ov.refetch()} /> : items.length === 0 ? (
        <div className="card">
          <Empty title={filtered ? 'Nenhum artigo com estes filtros.' : archived ? 'Não há artigos arquivados.' : 'Ainda não há material registado.'}>
            {filtered ? (
              <button type="button" className="btn secondary" onClick={() => setParams(archived ? { arquivados: '1' } : {}, { replace: true })}>Limpar filtros</button>
            ) : !archived && ov.data?.can_manage ? (
              <p className="faint">Começa por registar o primeiro artigo com «Novo artigo».</p>
            ) : !archived ? <p className="faint">Quando os responsáveis registarem material, aparece aqui.</p> : null}
          </Empty>
        </div>
      ) : (
        <ul className="card list inv-list" aria-label="Material">
          {items.map((i) => (
            <li key={i.id}>
              <Link to={`/inventario/artigo/${i.id}`} className="list-item inv-item">
                <span className="inv-item-main">
                  <strong>{i.name}</strong>
                  <span className="faint">
                    {[i.category ?? 'Sem categoria', i.tracking === 'pecas' ? 'peças identificadas' : null].filter(Boolean).join(' · ')}
                    {i.location && <> · <MapPin size={13} aria-hidden="true" className="inv-pin" />{i.location}</>}
                  </span>
                  <span className="inv-item-stock">{availabilityText(i.stock, i.unit)}</span>
                </span>
                <span className="inv-badges"><StateBadges states={i.stock.states} /></span>
                <ChevronRight size={18} aria-hidden="true" className="row-arrow" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
