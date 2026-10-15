// Vista individual: equipa atual, cargos atuais, histórico de cargos e de equipas.
import { Link, useParams } from 'react-router-dom';
import { Badge, Empty, ErrorBox, Loading, Notice, PageTitle } from '../../components/ui';
import { formatDay } from '../common';
import { appointmentState, functionName, scoutYear, sortAppointments, useEquipas } from './data';
import { AppointForm, AppointmentList, BASE, Emblem, MoveForm, teamLabel } from './parts';

export default function PersonPage() {
  const { id } = useParams();
  const q = useEquipas();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const o = q.data;
  const m = o.members.find((x) => x.membership_id === id);
  if (!m) return <><PageTitle title="Pessoa" back={BASE} /><Empty title="Pessoa não encontrada ou sem acesso." /></>;
  const team = o.teams.find((t) => t.id === m.team_id);
  const all = sortAppointments(o.appointments.filter((a) => a.membership_id === m.membership_id), o.today);
  const currentRoles = all.filter((a) => ['ativo', 'futuro'].includes(appointmentState(a, o.today)));
  const past = all.filter((a) => !['ativo', 'futuro'].includes(appointmentState(a, o.today)));
  const moves = o.moves.filter((x) => x.membership_id === m.membership_id && x.from_team_id);
  const isMe = o.me === m.membership_id;
  const canSeeMoves = o.can_manage || isMe;
  const movable = o.can_manage && m.status === 'ativo' && (m.function === 'pioneiro' || m.function === 'guia');

  // Histórico de cargos agrupado por ano escutista (do início de cada nomeação).
  const byYear = new Map<string, typeof past>();
  for (const a of past) byYear.set(scoutYear(a.starts_on), [...(byYear.get(scoutYear(a.starts_on)) ?? []), a]);

  return (
    <>
      <PageTitle title={m.full_name || 'Pessoa'} subtitle={m.totem ?? undefined} back={BASE} />
      <section className="card eq-person-head" style={{ ['--team' as string]: team?.color ?? 'var(--line)' }}>
        {team ? <Emblem team={team} size={48} /> : null}
        <div className="grow">
          <div className="faint">Equipa {o.space === 'teste' ? '(ambiente de teste)' : 'atual'}</div>
          {team ? <Link to={`${BASE}/equipa/${team.id}`}><strong>{teamLabel(team)}</strong></Link> : <strong>Sem equipa</strong>}
          <div className="faint">{functionName(m.function)}{m.status !== 'ativo' ? ` · ${m.status}` : ''}{m.since ? ` · na secção desde ${formatDay(m.since)}` : ''}</div>
        </div>
        <div className="eq-badges">
          {currentRoles.filter((a) => appointmentState(a, o.today) === 'ativo').map((a) => (
            <Badge key={a.id} label={o.roles.find((r) => r.id === a.role_id)?.name ?? 'Cargo'} tone="progress" />
          ))}
        </div>
      </section>

      <h2 className="section-title">Cargos atuais</h2>
      <div className="card">
        <AppointmentList list={currentRoles} o={o} show="pessoa" empty={<Empty title="Sem cargos atuais." />} />
      </div>
      {o.can_manage && team && m.status === 'ativo' && !team.archived_at && (
        <details className="card eq-panel">
          <summary>Nomear para um cargo</summary>
          <AppointForm o={o} team={team} member={m} />
        </details>
      )}

      <h2 className="section-title">Histórico de cargos</h2>
      <div className="card">
        {byYear.size ? [...byYear.entries()].map(([y, list]) => (
          <div key={y} className="eq-year-group">
            <h3 className="faint-title">{y}</h3>
            <AppointmentList list={list} o={o} show="pessoa" empty={null} />
          </div>
        )) : <Empty title="Ainda sem cargos terminados." />}
      </div>

      {canSeeMoves && (
        <>
          <h2 className="section-title">Histórico de equipas</h2>
          <div className="card">
            {moves.length ? (
              <ul className="list">
                {moves.map((x) => (
                  <li key={`${x.source}-${x.id}`} className="list-item">
                    <span className="grow">
                      {teamLabel(o.teams.find((t) => t.id === x.from_team_id))} → <strong>{teamLabel(o.teams.find((t) => t.id === x.to_team_id))}</strong>
                      <br />
                      <span className="faint">
                        {formatDay(x.on)}{x.reason ? ` · ${x.reason}` : ''}{x.by_name ? ` · por ${x.by_name}` : ''}
                        {x.source === 'gestao' ? ' · alterado na gestão de membros' : ''}{!x.applied ? ' · só no ambiente de teste' : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <Empty title="Sem mudanças de equipa registadas." />}
          </div>
        </>
      )}
      {movable && (
        <details className="card eq-panel">
          <summary>Mudar de equipa</summary>
          <MoveForm o={o} member={m} />
        </details>
      )}
      {o.can_manage && m.function === 'dirigente' && (
        <Notice kind="info"><p className="prose">Os dirigentes não pertencem a equipas, por isso não têm cargos de equipa.</p></Notice>
      )}
    </>
  );
}
