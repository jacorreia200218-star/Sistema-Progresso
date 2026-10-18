// Empréstimos e reservas na mesma entrada, separados por «Empréstimos | Reservas» (no endereço,
// com o estado, «só os meus» e os filtros vindos dos indicadores: a devolver em 48 h, reservas
// sem material suficiente).
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, Layers, X } from 'lucide-react';
import { Badge, Empty, ErrorBox, Loading, PageTitle } from '../../components/ui';
import { InvTabs, LoanCard, ReservationCard } from './parts';
import { useLoans, useOverview, useReservations } from './api';

const FILTERS: [string, string][] = [['', 'Em curso'], ['ativo', 'Emprestados'], ['pedido', 'Pedidos'], ['atrasado', 'Em atraso'], ['fechado', 'Terminados'], ['todos', 'Histórico']];

export function Emprestimos() {
  const [params, setParams] = useSearchParams();
  const reservas = params.get('ver') === 'reservas';
  const ov = useOverview();
  const manage = !!ov.data?.can_manage;
  const view = (v: 'emprestimos' | 'reservas') => setParams(v === 'reservas' ? { ver: 'reservas' } : {}, { replace: true });
  return (
    <div className="inv-page">
      <PageTitle title="Empréstimos"
        info={reservas
          ? (manage ? 'Para reservar, abre o artigo e usa «Reservar» (no menu «Mais»). A reserva pode herdar o período de uma atividade do calendário.' : undefined)
          : (!manage ? 'Para pedir material, abre o artigo na lista e usa «Pedir empréstimo». Os pedidos ficam a aguardar aprovação.' : undefined)} />
      <InvTabs />
      <div className="segmented inv-view" role="radiogroup" aria-label="Ver">
        <label className="segment"><input type="radio" name="inv-view" checked={!reservas} onChange={() => view('emprestimos')} /><Layers size={16} aria-hidden="true" /> Empréstimos</label>
        <label className="segment"><input type="radio" name="inv-view" checked={reservas} onChange={() => view('reservas')} /><CalendarClock size={16} aria-hidden="true" /> Reservas</label>
      </div>
      {reservas ? <ReservasView /> : <LoansView />}
    </div>
  );
}

function useSet() {
  const [, setParams] = useSearchParams();
  return (k: string, v: string, also?: string) => setParams(() => {
    const next = new URLSearchParams(window.location.search);
    if (v) next.set(k, v); else next.delete(k);
    if (also) next.delete(also);
    return next;
  }, { replace: true });
}

function LoansView() {
  const [params] = useSearchParams();
  const set = useSet();
  const estado = params.get('estado') ?? '';
  const mine = params.get('meus') === '1';
  const soon = params.get('prazo') === '48h';
  const ov = useOverview();
  const loans = useLoans(estado, mine);
  const limit = Date.now() + 48 * 3600e3;
  const rows = (loans.data ?? []).filter((l) => !soon || (l.status === 'ativo' && !l.overdue && l.returned_qty < l.quantity && new Date(l.due_at).getTime() < limit));
  const empty = soon ? 'Nada a devolver nas próximas 48 horas.'
    : estado === 'pedido' ? 'Não há pedidos por decidir.' : estado === 'atrasado' ? 'Não há devoluções em atraso.'
    : estado === 'fechado' ? 'Ainda não há empréstimos terminados.' : estado === 'ativo' ? 'Não há material emprestado.'
    : estado === 'todos' ? 'Ainda não há empréstimos registados.' : 'Não há material emprestado nem pedidos em curso.';
  return (
    <section aria-label="Lista de empréstimos">
      <div className="filter-chips" role="radiogroup" aria-label="Estado dos empréstimos">
        {FILTERS.map(([k, l]) => (
          <label key={k} className="filter-chip">
            <input type="radio" name="inv-estado" checked={estado === k} onChange={() => set('estado', k, 'prazo')} /> {l}
          </label>
        ))}
        <label className="filter-chip">
          <input type="checkbox" checked={mine} onChange={(e) => set('meus', e.target.checked ? '1' : '')} /> Só os meus
        </label>
      </div>
      {soon && <FromIndicator label="A devolver em 48 h" clear={() => set('prazo', '')} />}
      {loans.isLoading || ov.isLoading ? <Loading /> : loans.error ? <ErrorBox error={loans.error} retry={() => loans.refetch()} /> : rows.length === 0 ? (
        <div className="card"><Empty title={empty} /></div>
      ) : (
        <ul className="inv-cards" aria-label="Empréstimos">
          {rows.map((l) => <LoanCard key={l.id} l={l} canManage={!!ov.data?.can_manage} me={ov.data?.me ?? ''} />)}
        </ul>
      )}
    </section>
  );
}

function ReservasView() {
  const [params] = useSearchParams();
  const set = useSet();
  const past = params.get('reservas') === 'terminadas';
  const risk = params.get('risco') === '1';
  const ov = useOverview();
  const res = useReservations(past);
  const rows = (res.data ?? []).filter((r) => !risk || r.at_risk);
  return (
    <section aria-label="Lista de reservas">
      <div className="filter-chips" role="radiogroup" aria-label="Estado das reservas">
        <label className="filter-chip"><input type="radio" name="inv-res" checked={!past} onChange={() => set('reservas', '')} /> Ativas</label>
        <label className="filter-chip"><input type="radio" name="inv-res" checked={past} onChange={() => set('reservas', 'terminadas', 'risco')} /> Terminadas e canceladas</label>
      </div>
      {risk && <FromIndicator label="Sem material suficiente" clear={() => set('risco', '')} />}
      {res.isLoading ? <Loading /> : res.error ? <ErrorBox error={res.error} retry={() => res.refetch()} /> : rows.length === 0 ? (
        <div className="card">
          <Empty title={risk ? 'Todas as reservas têm material suficiente.' : past ? 'Sem reservas terminadas.' : 'Não há reservas ativas.'}>
            {!risk && !past && ov.data?.can_manage && <p className="faint">Reserva a partir da ficha de um artigo, na <Link to="/inventario">lista do material</Link>.</p>}
          </Empty>
        </div>
      ) : (
        <ul className="inv-cards" aria-label="Reservas">
          {rows.map((r) => <ReservationCard key={r.id} r={r} canManage={!!ov.data?.can_manage} />)}
        </ul>
      )}
    </section>
  );
}

/** Filtro vindo de um indicador do resumo, com forma de o tirar. */
function FromIndicator({ label, clear }: { label: string; clear: () => void }) {
  return (
    <p className="inv-alert-filter">
      <Badge label={label} tone="attention" />
      <button type="button" className="btn ghost" onClick={clear}><X size={15} aria-hidden="true" /> Ver todos</button>
    </p>
  );
}
