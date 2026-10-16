// Reservas de material (ativas ou terminadas), ligadas a atividades do calendário.
import { useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, Loading, PageTitle } from '../../components/ui';
import { InvTabs, ReservationCard } from './parts';
import { useOverview, useReservations } from './api';

export function Reservas() {
  const [params, setParams] = useSearchParams();
  const past = params.get('ver') === 'terminadas';
  const ov = useOverview();
  const res = useReservations(past);
  return (
    <div className="inv-page">
      <PageTitle title="Reservas"
        info={ov.data?.can_manage ? 'Para reservar, abre o artigo e usa «Reservar» (no menu «Mais»). A reserva pode herdar o período de uma atividade do calendário.' : undefined} />
      <InvTabs />
      <div className="filter-chips" role="radiogroup" aria-label="Reservas">
        <label className="filter-chip"><input type="radio" name="inv-res" checked={!past} onChange={() => setParams({}, { replace: true })} /> Ativas</label>
        <label className="filter-chip"><input type="radio" name="inv-res" checked={past} onChange={() => setParams({ ver: 'terminadas' }, { replace: true })} /> Terminadas e canceladas</label>
      </div>
      {res.isLoading ? <Loading /> : res.error ? <ErrorBox error={res.error} retry={() => res.refetch()} /> : (res.data ?? []).length === 0 ? (
        <div className="card"><Empty title={past ? 'Sem reservas terminadas.' : 'Não há reservas ativas.'} /></div>
      ) : (
        <ul className="inv-cards" aria-label="Reservas">
          {res.data!.map((r) => <ReservationCard key={r.id} r={r} canManage={!!ov.data?.can_manage} />)}
        </ul>
      )}
    </div>
  );
}
