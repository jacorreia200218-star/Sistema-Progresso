// Vista por equipa: identidade, cargos no ano escutista, membros e histórico (recolhido).
import { useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { Empty, ErrorBox, Field, Loading, MoreMenu, PageTitle } from '../../components/ui';
import { formatDay } from '../common';
import { removeModuleFile, uploadModuleFile } from '../files';
import { appointmentState, inYear, membersInYear, sortAppointments, TEAM_COLORS, useEquipas, useSectionId, yearBounds, yearOptions, type EqTeam } from './data';
import { AppointForm, AppointmentList, BASE, Emblem, Result, teamLabel, useParam, YearSelect } from './parts';

export default function TeamPage() {
  const { id } = useParams();
  const q = useEquipas();
  const [year, setYear] = useParam('ano', q.data?.year ?? '');
  const [panel, setPanel] = useState<'' | 'nomear' | 'identidade'>('');
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const o = q.data;
  const team = o.teams.find((t) => t.id === id);
  if (!team) return <><PageTitle title="Equipa" back={BASE} /><Empty title="Equipa não encontrada." /></>;
  const years = yearOptions(o);
  const y = years.includes(year) ? year : o.year;
  const current = y === o.year;
  const appointments = sortAppointments(o.appointments.filter((a) => a.team_id === team.id && inYear(a, y)), o.today);
  const open = appointments.filter((a) => ['ativo', 'futuro'].includes(appointmentState(a, o.today)));
  const closed = appointments.filter((a) => !['ativo', 'futuro'].includes(appointmentState(a, o.today)));
  const members = current ? o.members.filter((m) => m.status === 'ativo' && m.team_id === team.id) : membersInYear(team.id, y, o.members, o.moves);
  const [from, to] = yearBounds(y);
  const moves = o.moves.filter((m) => (m.from_team_id === team.id || m.to_team_id === team.id) && m.on >= from && m.on < to && m.from_team_id);
  const manage = o.can_manage && !team.archived_at;

  // Cargos de cada membro nesta equipa no ano escolhido (em funções no ano atual).
  const rolesOf = (membership: string) => appointments
    .filter((a) => a.membership_id === membership && !a.cancelled_at && (!current || appointmentState(a, o.today) === 'ativo'))
    .map((a) => o.roles.find((r) => r.id === a.role_id)?.name ?? 'Cargo')
    .filter((n, i, all) => all.indexOf(n) === i);

  return (
    <div className="eq-team-page" style={{ ['--team' as string]: team.color ?? 'var(--line)' }}>
      <PageTitle
        title={teamLabel(team)}
        back={BASE}
        actions={manage ? (
          <>
            <button type="button" className="btn" onClick={() => setPanel('nomear')}><Plus size={16} aria-hidden="true" /> Nomear</button>
            <MoreMenu>
              <button type="button" className="btn" onClick={() => setPanel('identidade')}>Editar identidade</button>
            </MoreMenu>
          </>
        ) : undefined}
      />
      <section className="card eq-identity" aria-label="Identidade da equipa">
        <Emblem team={team} size={48} />
        <div className="grow">
          {team.motto ? <div className="eq-motto">«{team.motto}»</div> : <div className="faint">Sem lema registado.</div>}
          <div className="faint">{members.length} {members.length === 1 ? 'membro' : 'membros'}{team.archived_at ? ' · equipa arquivada' : ''}</div>
        </div>
      </section>

      {manage && panel === 'identidade' && <IdentityEditor team={team} onClose={() => setPanel('')} />}
      {manage && panel === 'nomear' && (
        <section className="card eq-panel" aria-label="Nomear para um cargo">
          <div className="eq-panel-head">
            <h2 className="eq-panel-title">Nomear para um cargo</h2>
            <button type="button" className="btn ghost" onClick={() => setPanel('')}>Fechar</button>
          </div>
          <AppointForm o={o} team={team} />
        </section>
      )}

      <YearSelect years={years} value={y} onChange={setYear} />

      <h2 className="section-title">Cargos em {y}</h2>
      <div className="card">
        <AppointmentList list={open} o={o} show="equipa" empty={<p className="faint eq-none">{current ? 'Sem cargos em funções.' : `Sem cargos em funções no fim de ${y}.`}</p>} />
      </div>

      <h2 className="section-title">{current ? 'Membros atuais' : `Membros em ${y}`}</h2>
      <div className="card">
        {!current && <p className="faint eq-note">Composição reconstruída a partir do histórico de mudanças de equipa.</p>}
        {members.length ? (
          <ul className="list">
            {members.map((m) => (
              <li key={m.membership_id}>
                <Link to={`${BASE}/pessoa/${m.membership_id}`} className="list-item">
                  <span className="grow"><strong>{m.full_name}</strong>{m.totem ? <span className="faint"> · {m.totem}</span> : null}</span>
                  {rolesOf(m.membership_id).map((r) => <span key={r} className="badge tone-progress">{r}</span>)}
                  <ChevronRight size={18} className="row-arrow" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="faint eq-none">{o.can_manage ? 'Sem membros.' : 'Sem membros visíveis.'}</p>}
      </div>

      {(closed.length > 0 || moves.length > 0) && (
        <details className="card eq-history">
          <summary>Histórico <span className="faint">({closed.length + moves.length})</span></summary>
          {closed.length > 0 && (
            <>
              <h3 className="faint-title">Cargos terminados ou anulados</h3>
              <AppointmentList list={closed} o={o} show="equipa" empty={null} />
            </>
          )}
          {moves.length > 0 && (
            <>
              <h3 className="faint-title">Entradas e saídas</h3>
              <ul className="list">
                {moves.map((m) => {
                  const who = o.members.find((x) => x.membership_id === m.membership_id)?.full_name ?? 'Pessoa';
                  const entered = m.to_team_id === team.id;
                  const other = o.teams.find((t) => t.id === (entered ? m.from_team_id : m.to_team_id));
                  return (
                    <li key={`${m.source}-${m.id}`} className="list-item">
                      <span className="grow">
                        <strong>{who}</strong> {entered ? 'entrou, vindo da' : 'saiu para a'} {teamLabel(other)}
                        <br /><span className="faint">{formatDay(m.on)}{m.reason ? ` · ${m.reason}` : ''}{!m.applied ? ' · só no ambiente de teste' : ''}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </details>
      )}
    </div>
  );
}

function IdentityEditor({ team, onClose }: { team: EqTeam; onClose: () => void }) {
  const section = useSectionId();
  const [color, setColor] = useState(team.color ?? '');
  const [motto, setMotto] = useState(team.motto ?? '');
  const file = useRef<HTMLInputElement>(null);
  const act = useAction();
  const save = (e: FormEvent) => {
    e.preventDefault();
    act.run(() => call('eq_save_identity', { p_section: section, p_team: team.id, p_color: color || null, p_motto: motto.trim() || null }), 'Identidade da equipa guardada.');
  };
  const upload = (f: File | undefined) => {
    if (!f) return;
    act.run(async () => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) throw new Error('O símbolo ou fotografia tem de ser uma imagem PNG, JPG ou WebP.');
      await uploadModuleFile(section, 'equipas', 'equipa', team.id, f);
    }, 'Símbolo carregado.').finally(() => { if (file.current) file.current.value = ''; });
  };
  return (
    <section className="card eq-panel" aria-label="Editar identidade">
      <div className="eq-panel-head">
        <h2 className="eq-panel-title">Editar identidade</h2>
        <button type="button" className="btn ghost" onClick={onClose}>Fechar</button>
      </div>
      <form onSubmit={save} noValidate aria-label="Identidade da equipa">
        <fieldset className="eq-colors">
          <legend className="label">Cor</legend>
          {TEAM_COLORS.map((c) => (
            <label key={c.value} className="eq-swatch" title={c.label}>
              <input type="radio" name={`cor-${team.id}`} value={c.value} checked={color === c.value} onChange={() => setColor(c.value)} />
              <span style={{ background: c.value }} aria-hidden="true" />
              <span className="sr-only">{c.label}</span>
            </label>
          ))}
          <label className="eq-swatch none" title="Sem cor">
            <input type="radio" name={`cor-${team.id}`} value="" checked={!color} onChange={() => setColor('')} />
            <span aria-hidden="true" />
            <span className="sr-only">Sem cor</span>
          </label>
        </fieldset>
        <Field label="Lema" htmlFor={`lema-${team.id}`}>
          <input id={`lema-${team.id}`} type="text" maxLength={200} value={motto} onChange={(e) => setMotto(e.target.value)} />
        </Field>
        <button type="submit" className="btn" disabled={act.busy} aria-busy={act.busy}>Guardar identidade</button>
      </form>
      <div className="field eq-emblem-field">
        <label htmlFor={`emb-${team.id}`}>Símbolo ou fotografia (opcional)</label>
        <span className="hint prose">Imagem PNG, JPG ou WebP até 10 MB. Fica guardada num espaço privado da secção.</span>
        <input ref={file} id={`emb-${team.id}`} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e.target.files?.[0])} />
      </div>
      {team.emblem && (
        <button type="button" className="btn ghost" disabled={act.busy}
          onClick={() => act.run(() => removeModuleFile(team.emblem!.path), 'Símbolo retirado.')}>Retirar símbolo</button>
      )}
      <Result error={act.error} success={act.success} />
      {team.color === null && !color && <p className="faint eq-note">Sem cor, a equipa aparece em tons neutros.</p>}
    </section>
  );
}

