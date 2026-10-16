// Página inicial do Inventário: resumo (emprestado, devoluções em atraso, em reparação,
// compras pendentes) e lista do material com pesquisa e filtros (tipo, local, armário,
// disponibilidade e conservação) guardados no endereço, para sobreviverem ao «voltar».
// Cada linha mostra só o essencial (material, quantidade, local curto e um estado);
// o tipo, a conservação e o local completo ficam na ficha do artigo.
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, MapPin, Plus, Search } from 'lucide-react';
import { Badge, Empty, ErrorBox, Filters, Loading, PageTitle } from '../../components/ui';
import type { Tone } from '../../lib/labels';
import { InvTabs, availabilityText } from './parts';
import {
  CONSERVATION_LABEL, STATE_LABEL, STATE_TONE, norm, placeParts, qty, useOverview,
  type Conservation, type Item, type ItemState, type Stock, type Summary,
} from './api';

export function Lista() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const cat = params.get('categoria') ?? '';
  const est = (params.get('estado') ?? '') as ItemState | '';
  const loc = params.get('local') ?? '';
  const cab = params.get('armario') ?? '';
  const cons = (params.get('conservacao') ?? '') as Conservation | '';
  const archived = params.get('arquivados') === '1';
  const ov = useOverview(archived);
  const set = (k: string, v: string, also?: string) => {
    // Parte do endereço atual: duas mudanças seguidas não se anulam.
    setParams(() => {
      const next = new URLSearchParams(window.location.search);
      if (v) next.set(k, v); else next.delete(k);
      if (also) next.delete(also);
      return next;
    }, { replace: true });
  };

  const items = (ov.data?.items ?? [])
    .filter((i) => !cat || (cat === 'sem' ? !i.category_id : i.category_id === cat))
    .filter((i) => !est || i.stock.states.includes(est))
    // «local»: a sala (ou, nos registos antigos sem local estruturado, o texto da localização).
    .filter((i) => !loc || (i.room ?? i.location) === loc)
    .filter((i) => !cab || i.cabinet === cab)
    .filter((i) => !cons || i.condition === cons)
    .filter((i) => !q.trim() || norm([i.name, i.description, i.category, i.location, i.notes].filter(Boolean).join(' ')).includes(norm(q.trim())));
  const filtered = !!(q || cat || est || loc || cab || cons);
  const cabinets = [...new Set((ov.data?.cabinets ?? []).filter((c) => !loc || c.room === loc).map((c) => c.cabinet))].sort((a, b) => a.localeCompare(b, 'pt'));

  const activeFilters = [cat, est, loc, cab, cons].filter(Boolean).length + (archived ? 1 : 0);
  const manage = !!ov.data?.can_manage;

  return (
    <div className="inv-page">
      <PageTitle title="Inventário"
        actions={manage ? <Link to="/inventario/novo" className="btn"><Plus size={16} aria-hidden="true" /> Novo artigo</Link> : undefined} />
      <InvTabs />
      {ov.data && !archived && <SummaryCards s={ov.data.summary} />}
      <Filters active={activeFilters}
        search={(
          <label className="search-field">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Pesquisar material</span>
            <input type="search" placeholder="Pesquisar material" value={q} onChange={(e) => set('q', e.target.value)} />
          </label>
        )}>
        <select aria-label="Filtrar por tipo" value={cat} onChange={(e) => set('categoria', e.target.value)}>
          <option value="">Todos os tipos</option>
          {(ov.data?.categories ?? []).filter((c) => !c.archived || c.id === cat).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="sem">Sem tipo</option>
        </select>
        <select aria-label="Filtrar por localização" value={loc} onChange={(e) => set('local', e.target.value, 'armario')}>
          <option value="">Todos os locais</option>
          {(ov.data?.rooms ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        {cabinets.length > 0 && (
          <select aria-label="Filtrar por armário" value={cab} onChange={(e) => set('armario', e.target.value)}>
            <option value="">Todos os armários</option>
            {cabinets.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select aria-label="Filtrar por estado" value={est} onChange={(e) => set('estado', e.target.value)}>
          <option value="">Todos os estados</option>
          {(Object.keys(STATE_LABEL) as ItemState[]).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
        </select>
        <select aria-label="Filtrar por conservação" value={cons} onChange={(e) => set('conservacao', e.target.value)}>
          <option value="">Qualquer conservação</option>
          {(Object.keys(CONSERVATION_LABEL) as Conservation[]).map((s) => <option key={s} value={s}>{CONSERVATION_LABEL[s]}</option>)}
        </select>
        <label className="checkbox inv-inline-check">
          <input type="checkbox" checked={archived} onChange={(e) => set('arquivados', e.target.checked ? '1' : '')} /> Ver arquivados
        </label>
      </Filters>

      {ov.isLoading ? <Loading /> : ov.error ? <ErrorBox error={ov.error} retry={() => ov.refetch()} /> : items.length === 0 ? (
        <div className="card">
          <Empty title={filtered ? 'Nenhum artigo com estes filtros.' : archived ? 'Não há artigos arquivados.' : 'Ainda não há material registado.'}>
            {filtered ? (
              <button type="button" className="btn secondary" onClick={() => setParams(archived ? { arquivados: '1' } : {}, { replace: true })}>Limpar filtros</button>
            ) : !archived && manage ? (
              <p className="faint">Começa por registar o primeiro artigo com «Novo artigo».</p>
            ) : !archived ? <p className="faint">Quando os responsáveis registarem material, aparece aqui.</p> : null}
          </Empty>
        </div>
      ) : (
        <>
          <p className="faint inv-count" aria-live="polite">{items.length} {items.length === 1 ? 'artigo' : 'artigos'}{archived ? ' arquivados' : ''}</p>
          <ul className="card list inv-list" aria-label="Material">
            {items.map((i) => {
              const place = shortPlace(i);
              const full = placeParts(i).map((p) => p.value).join(' · ');
              const st = mainState(i.stock, est);
              return (
                <li key={i.id}>
                  <Link to={`/inventario/artigo/${i.id}`} className="list-item inv-item">
                    <span className="inv-item-main">
                      <strong>{i.name}</strong>
                      <span className="faint inv-item-meta">
                        <span title={availabilityText(i.stock, i.unit)}>{i.stock.available} de {qty(i.stock.total, i.unit)}</span>
                        {place && <span className="inv-item-place" title={full}><MapPin size={13} aria-hidden="true" className="inv-pin" />{place}</span>}
                      </span>
                    </span>
                    <Badge label={st.label} tone={st.tone} />
                    <ChevronRight size={18} aria-hidden="true" className="row-arrow" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** Localização curta: a sala (ou o texto antigo da localização). O resto fica na ficha. */
function shortPlace(i: Item) {
  return i.room ?? (i.cabinet || i.shelf || i.box ? [i.cabinet, i.shelf, i.box].filter(Boolean)[0] : i.location) ?? null;
}

/** Um só estado por linha: o filtro escolhido; senão o que pede atenção; senão a disponibilidade. */
function mainState(s: Stock, filter: ItemState | ''): { label: string; tone: Tone } {
  if (filter && s.states.includes(filter)) return { label: STATE_LABEL[filter], tone: STATE_TONE[filter] };
  if (!s.states.length || s.total === 0) return { label: 'Sem unidades', tone: 'muted' };
  const pick = (['reparacao', 'danificado'] as ItemState[]).find((x) => s.states.includes(x))
    ?? (s.available > 0 ? 'disponivel' : (['emprestado', 'reservado'] as ItemState[]).find((x) => s.states.includes(x)) ?? s.states[0]);
  return { label: STATE_LABEL[pick], tone: STATE_TONE[pick] };
}

function SummaryCards({ s }: { s: Summary }) {
  return (
    <ul className="stats inv-stats inv-summary" aria-label="Resumo do inventário">
      <li>
        <Link className="stat stat-azul" to="/inventario/emprestimos?estado=ativo">
          <span className="stat-value">{s.lent_units}</span>
          <span className="stat-label">Emprestado</span>
          <span className="stat-hint">{s.lent_loans === 1 ? '1 empréstimo' : `${s.lent_loans} empréstimos`}</span>
        </Link>
      </li>
      <li>
        <Link className="stat stat-ambar" to="/inventario/emprestimos?estado=atrasado">
          <span className="stat-value">{s.overdue}</span>
          <span className="stat-label">Devoluções em atraso</span>
          <span className="stat-hint">{s.overdue === 0 ? 'Tudo em dia' : 'A resolver'}</span>
        </Link>
      </li>
      <li>
        <Link className="stat stat-lilas" to="/inventario?estado=reparacao">
          <span className="stat-value">{s.repair_units}</span>
          <span className="stat-label">Em reparação</span>
          <span className="stat-hint">{s.repair_items === 1 ? '1 artigo' : `${s.repair_items} artigos`}</span>
        </Link>
      </li>
      <li>
        <Link className="stat stat-verde" to="/inventario/comprar">
          <span className="stat-value">{s.purchases_pending}</span>
          <span className="stat-label">Compras pendentes</span>
          <span className="stat-hint">{s.purchases_high > 0 ? `${s.purchases_high} com prioridade alta` : 'Sem urgências'}</span>
        </Link>
      </li>
    </ul>
  );
}
