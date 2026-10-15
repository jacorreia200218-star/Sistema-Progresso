// Alertas: devoluções atrasadas e próximas, quantidade mínima, reparação, danificados,
// reservas sem material suficiente e pedidos por decidir.
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Loading, PageTitle } from '../../components/ui';
import { InvTabs, LoanCard, ReservationCard, Section, availabilityText } from './parts';
import { qty, useAlerts, useOverview, type Item } from './api';

export function Alertas() {
  const a = useAlerts();
  const ov = useOverview();
  if (a.isLoading || ov.isLoading) return <div className="inv-page"><PageTitle title="Alertas" /><InvTabs /><Loading /></div>;
  if (a.error) return <div className="inv-page"><PageTitle title="Alertas" /><InvTabs /><ErrorBox error={a.error} retry={() => a.refetch()} /></div>;
  const d = a.data!;
  const manage = !!ov.data?.can_manage;
  const me = ov.data?.me ?? '';
  const total = d.overdue.length + d.due_soon.length + d.low_stock.length + d.repair.length + d.damaged.length + d.at_risk.length + d.requests.length;
  const items = (list: Item[], line: (i: Item) => string) => (
    <ul className="card list">
      {list.map((i) => (
        <li key={i.id}><Link className="list-item inv-item" to={`/inventario/artigo/${i.id}`}><span className="inv-item-main"><strong>{i.name}</strong><span className="faint">{line(i)}</span></span></Link></li>
      ))}
    </ul>
  );
  return (
    <div className="inv-page">
      <PageTitle title="Alertas" subtitle="O que precisa de atenção no material." />
      <InvTabs />
      <ul className="stats inv-stats" aria-label="Resumo dos alertas">
        <li><div className="stat stat-ambar"><span className="stat-value">{d.overdue.length}</span><span className="stat-label">Devoluções em atraso</span></div></li>
        <li><div className="stat stat-azul"><span className="stat-value">{d.due_soon.length}</span><span className="stat-label">A devolver em 48 h</span></div></li>
        <li><div className="stat stat-lilas"><span className="stat-value">{d.low_stock.length}</span><span className="stat-label">Abaixo do mínimo</span></div></li>
        <li><div className="stat stat-verde"><span className="stat-value">{d.repair.length}</span><span className="stat-label">Artigos em reparação</span></div></li>
      </ul>
      {total === 0 && <div className="card"><Empty title="Sem alertas. Está tudo em ordem." /></div>}
      {d.requests.length > 0 && (
        <Section title="Pedidos por decidir" count={d.requests.length}>
          <ul className="inv-cards">{d.requests.map((l) => <LoanCard key={l.id} l={l} canManage={manage} me={me} />)}</ul>
        </Section>
      )}
      {d.overdue.length > 0 && (
        <Section title="Devoluções em atraso" count={d.overdue.length}>
          <ul className="inv-cards">{d.overdue.map((l) => <LoanCard key={l.id} l={l} canManage={manage} me={me} />)}</ul>
        </Section>
      )}
      {d.due_soon.length > 0 && (
        <Section title="A devolver nas próximas 48 horas" count={d.due_soon.length}>
          <ul className="inv-cards">{d.due_soon.map((l) => <LoanCard key={l.id} l={l} canManage={manage} me={me} />)}</ul>
        </Section>
      )}
      {d.low_stock.length > 0 && (
        <Section title="Abaixo da quantidade mínima" count={d.low_stock.length}>
          {items(d.low_stock, (i) => `${availabilityText(i.stock, i.unit)} · mínimo ${qty(i.min_quantity ?? 0, i.unit)}`)}
        </Section>
      )}
      {d.repair.length > 0 && (
        <Section title="Em reparação" count={d.repair.length}>
          {items(d.repair, (i) => `${qty(i.stock.repair, i.unit)} em reparação`)}
        </Section>
      )}
      {d.damaged.length > 0 && (
        <Section title="Danificado" count={d.damaged.length}>
          {items(d.damaged, (i) => `${qty(i.stock.damaged, i.unit)} danificado(s)`)}
        </Section>
      )}
      {d.at_risk.length > 0 && (
        <Section title="Reservas sem material suficiente" count={d.at_risk.length}>
          <ul className="inv-cards">{d.at_risk.map((r) => <ReservationCard key={r.id} r={r} canManage={manage} />)}</ul>
        </Section>
      )}
    </div>
  );
}
