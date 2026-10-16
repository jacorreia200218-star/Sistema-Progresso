// Vista individual: equipa atual, cargos atuais e histórico (recolhido) de cargos e de equipas.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Empty, ErrorBox, Loading, MoreMenu, PageTitle } from '../../components/ui';
import { formatDay } from '../common';
import { appointmentState, functionName, scoutYear, sortAppointments, useEquipas } from './data';
import { AppointForm, AppointmentList, BASE, Emblem, MoveForm, teamLabel } from './parts';

export default function PersonPage() {
  const { id } = useParams();
  const q = useEquipas();
  const [panel, setPanel] = useState<'' | 'nomear' | 'mudar'>('');
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

  const canAppoint = o.can_manage && !!team && m.status === 'ativo' && !team.archived_at;
  const historyCount = past.length + (canSeeMoves ? moves.length : 0);

  return (
    <>
      <PageTitle
        title={m.full_name || 'Pessoa'}
        back={BASE}
        actions={canAppoint || movable ? (
          <>
            {canAppoint && <button type="button" className="btn" onClick={() => setPanel('nomear')}><Plus size={16} aria-hidden="true" /> Nomear</button>}
            {movable && (
              <MoreMenu>
                <button type="button" className="btn" onClick={() => setPanel('mudar')}>Mudar de equipa</button>
              </MoreMenu>
            )}
          </>
        ) : undefined}
      />
      <section className="card eq-person-head" style={{ ['--team' as string]: team?.color ?? 'var(--line)' }}>
        {team ? <Emblem team={team} size={40} /> : null}
        <div className="grow">
          {team ? <Link to={`${BASE}/equipa/${team.id}`}><strong>{teamLabel(team)}</strong></Link> : <strong>Sem equipa</strong>}
          <div className="faint">
            {[m.totem, functionName(m.function), m.status !== 'ativo' ? m.status : null, m.since ? `na secção desde ${formatDay(m.since)}` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
      </section>

      {canAppoint && panel === 'nomear' && (
        <section className="card eq-panel" aria-label="Nomear para um cargo">
          <div className="eq-panel-head">
            <h2 className="eq-panel-title">Nomear para um cargo</h2>
            <button type="button" className="btn ghost" onClick={() => setPanel('')}>Fechar</button>
          </div>
          <AppointForm o={o} team={team!} member={m} />
        </section>
      )}
      {movable && panel === 'mudar' && (
        <section className="card eq-panel" aria-label="Mudar de equipa">
          <div className="eq-panel-head">
            <h2 className="eq-panel-title">Mudar de equipa</h2>
            <button type="button" className="btn ghost" onClick={() => setPanel('')}>Fechar</button>
          </div>
          <MoveForm o={o} member={m} />
        </section>
      )}

      <h2 className="section-title">Cargos atuais</h2>
      <div className="card">
        <AppointmentList list={currentRoles} o={o} show="pessoa" empty={<p className="faint eq-none">Sem cargos atuais.</p>} />
      </div>
      {o.can_manage && m.function === 'dirigente' && (
        <p className="faint eq-note">Os dirigentes não pertencem a equipas, por isso não têm cargos de equipa.</p>
      )}

      <details className="card eq-history">
        <summary>Histórico <span className="faint">({historyCount})</span></summary>
        <h3 className="faint-title">Cargos</h3>
        {byYear.size ? [...byYear.entries()].map(([y, list]) => (
          <div key={y} className="eq-year-group">
            <h4 className="eq-year-label">{y}</h4>
            <AppointmentList list={list} o={o} show="pessoa" empty={null} />
          </div>
        )) : <p className="faint eq-none">Ainda sem cargos terminados.</p>}
        {canSeeMoves && (
          <>
            <h3 className="faint-title">Equipas</h3>
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
            ) : <p className="faint eq-none">Sem mudanças de equipa registadas.</p>}
          </>
        )}
      </details>
    </>
  );
}
