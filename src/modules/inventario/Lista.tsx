// Página inicial do Inventário: indicadores (emprestado, em atraso, stock baixo, avariado) que
// levam aos alertas correspondentes, e a lista do material com pesquisa, tipo e estado à vista;
// localização, armário, conservação e arquivados ficam em «Mais filtros». Tudo no endereço,
// para sobreviver ao «voltar». Cada linha mostra só o essencial; o resto fica na ficha.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, MapPin, Plus, Search, Tags, X } from 'lucide-react';
import { Badge, Empty, ErrorBox, Filters, Loading, MoreMenu, MoreOptions, PageTitle } from '../../components/ui';
import type { Tone } from '../../lib/labels';
import { InvTabs, availabilityText } from './parts';
import {
  CONSERVATION_LABEL, STATE_LABEL, STATE_TONE, isBroken, isLowStock, norm, placeParts, qty, useAlerts, useOverview,
  type Conservation, type Item, type ItemState, type Overview, type Stock,
} from './api';

type Alerta = 'stock' | 'avaria';
const ALERTA_LABEL: Record<Alerta, string> = { stock: 'Stock baixo', avaria: 'Danificado ou em reparação' };

export function Lista() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const cat = params.get('categoria') ?? '';
  const est = (params.get('estado') ?? '') as ItemState | '';
  const loc = params.get('local') ?? '';
  const cab = params.get('armario') ?? '';
  const cons = (params.get('conservacao') ?? '') as Conservation | '';
  const archived = params.get('arquivados') === '1';
  const alerta = (['stock', 'avaria'].includes(params.get('alerta') ?? '') ? params.get('alerta') : '') as Alerta | '';
  const ov = useOverview(archived);
  // «Mais filtros» abre sozinho quando um deles já está escolhido (ex.: ao voltar à página).
  const [moreOpen] = useState(() => !!(loc || cab || cons || archived));
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
    .filter((i) => alerta !== 'stock' || isLowStock(i))
    .filter((i) => alerta !== 'avaria' || isBroken(i))
    .filter((i) => !cat || (cat === 'sem' ? !i.category_id : i.category_id === cat))
    .filter((i) => !est || i.stock.states.includes(est))
    // «local»: a sala (ou, nos registos antigos sem local estruturado, o texto da localização).
    .filter((i) => !loc || (i.room ?? i.location) === loc)
    .filter((i) => !cab || i.cabinet === cab)
    .filter((i) => !cons || i.condition === cons)
    .filter((i) => !q.trim() || norm([i.name, i.description, i.category, i.location, i.notes].filter(Boolean).join(' ')).includes(norm(q.trim())));
  const filtered = !!(q || cat || est || loc || cab || cons || alerta);
  const cabinets = [...new Set((ov.data?.cabinets ?? []).filter((c) => !loc || c.room === loc).map((c) => c.cabinet))].sort((a, b) => a.localeCompare(b, 'pt'));

  const activeFilters = [cat, est, loc, cab, cons].filter(Boolean).length + (archived ? 1 : 0);
  const manage = !!ov.data?.can_manage;

  return (
    <div className="inv-page">
      <PageTitle title="Inventário"
        actions={manage ? (
          <>
            <Link to="/inventario/novo" className="btn"><Plus size={16} aria-hidden="true" /> Novo artigo</Link>
            <MoreMenu label="Configurar">
              <Link to="/inventario/categorias" className="btn"><Tags size={16} aria-hidden="true" /> Tipos de material</Link>
            </MoreMenu>
          </>
        ) : undefined} />
      <InvTabs />
      {ov.data && !archived && <Indicators ov={ov.data} alerta={alerta} />}
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
        <select aria-label="Filtrar por estado" value={est} onChange={(e) => set('estado', e.target.value)}>
          <option value="">Todos os estados</option>
          {(Object.keys(STATE_LABEL) as ItemState[]).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
        </select>
        <MoreOptions label="Mais filtros" open={moreOpen}>
          <div className="inv-more-filters">
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
            <select aria-label="Filtrar por conservação" value={cons} onChange={(e) => set('conservacao', e.target.value)}>
              <option value="">Qualquer conservação</option>
              {(Object.keys(CONSERVATION_LABEL) as Conservation[]).map((s) => <option key={s} value={s}>{CONSERVATION_LABEL[s]}</option>)}
            </select>
            <label className="checkbox inv-inline-check">
              <input type="checkbox" checked={archived} onChange={(e) => set('arquivados', e.target.checked ? '1' : '', 'alerta')} /> Ver arquivados
            </label>
          </div>
        </MoreOptions>
      </Filters>
      {alerta && (
        <p className="inv-alert-filter">
          <Badge label={ALERTA_LABEL[alerta]} tone="attention" />
          <button type="button" className="btn ghost" onClick={() => set('alerta', '')}><X size={15} aria-hidden="true" /> Ver todo o material</button>
        </p>
      )}

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
              const st = alerta === 'stock' ? { label: `Mínimo ${qty(i.min_quantity ?? 0, i.unit)}`, tone: 'attention' as Tone } : mainState(i.stock, est);
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

/** Indicadores do resumo: cada um abre o alerta correspondente (empréstimos ou a lista filtrada). */
function Indicators({ ov, alerta }: { ov: Overview; alerta: Alerta | '' }) {
  const s = ov.summary;
  const alerts = useAlerts();
  const low = ov.items.filter(isLowStock).length;
  const broken = ov.items.filter(isBroken).length;
  const toggle = (a: Alerta) => (alerta === a ? '/inventario' : `/inventario?alerta=${a}`);
  const a = alerts.data;
  const extra: { label: string; to: string }[] = [];
  if (ov.can_manage && ov.pending_requests > 0) {
    extra.push({ label: ov.pending_requests === 1 ? '1 pedido por decidir' : `${ov.pending_requests} pedidos por decidir`, to: '/inventario/emprestimos?estado=pedido' });
  }
  if (a && a.due_soon.length > 0) extra.push({ label: `${a.due_soon.length} a devolver em 48 h`, to: '/inventario/emprestimos?estado=ativo&prazo=48h' });
  if (a && a.at_risk.length > 0) {
    extra.push({ label: a.at_risk.length === 1 ? '1 reserva sem material suficiente' : `${a.at_risk.length} reservas sem material suficiente`, to: '/inventario/emprestimos?ver=reservas&risco=1' });
  }
  return (
    <>
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
            <span className="stat-label">Em atraso</span>
            <span className="stat-hint">{s.overdue === 0 ? 'Tudo em dia' : 'Devoluções a resolver'}</span>
          </Link>
        </li>
        <li>
          <Link className={`stat stat-verde${alerta === 'stock' ? ' is-current' : ''}`} to={toggle('stock')} aria-current={alerta === 'stock' ? 'true' : undefined}>
            <span className="stat-value">{low}</span>
            <span className="stat-label">Stock baixo</span>
            <span className="stat-hint">{low === 0 ? 'Nada abaixo do mínimo' : 'Abaixo do mínimo'}</span>
          </Link>
        </li>
        <li>
          <Link className={`stat stat-lilas${alerta === 'avaria' ? ' is-current' : ''}`} to={toggle('avaria')} aria-current={alerta === 'avaria' ? 'true' : undefined}>
            <span className="stat-value">{broken}</span>
            <span className="stat-label">Avariado</span>
            <span className="stat-hint">{s.repair_items === 0 ? 'Nada em reparação' : s.repair_items === 1 ? '1 em reparação' : `${s.repair_items} em reparação`}</span>
          </Link>
        </li>
      </ul>
      {extra.length > 0 && (
        <ul className="inv-attention" aria-label="Também a ver">
          {extra.map((x) => <li key={x.to}><Link to={x.to}>{x.label}</Link></li>)}
        </ul>
      )}
    </>
  );
}
