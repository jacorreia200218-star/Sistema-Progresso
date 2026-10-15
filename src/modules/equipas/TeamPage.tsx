// Vista por equipa: identidade, cargos no ano escutista, membros e entradas/saídas.
import { useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { Empty, ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import { formatDay } from '../common';
import { removeModuleFile, uploadModuleFile } from '../files';
import { inYear, membersInYear, sortAppointments, TEAM_COLORS, useEquipas, useSectionId, yearBounds, yearOptions, type EqTeam } from './data';
import { AppointForm, AppointmentList, BASE, Emblem, Result, teamLabel, useParam, YearSelect } from './parts';

export default function TeamPage() {
  const { id } = useParams();
  const q = useEquipas();
  const [year, setYear] = useParam('ano', q.data?.year ?? '');
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const o = q.data;
  const team = o.teams.find((t) => t.id === id);
  if (!team) return <><PageTitle title="Equipa" back={BASE} /><Empty title="Equipa não encontrada." /></>;
  const years = yearOptions(o);
  const y = years.includes(year) ? year : o.year;
  const current = y === o.year;
  const appointments = sortAppointments(o.appointments.filter((a) => a.team_id === team.id && inYear(a, y)), o.today);
  const members = current ? o.members.filter((m) => m.status === 'ativo' && m.team_id === team.id) : membersInYear(team.id, y, o.members, o.moves);
  const [from, to] = yearBounds(y);
  const moves = o.moves.filter((m) => (m.from_team_id === team.id || m.to_team_id === team.id) && m.on >= from && m.on < to && m.from_team_id);

  return (
    <div className="eq-team-page" style={{ ['--team' as string]: team.color ?? 'var(--line)' }}>
      <PageTitle title={teamLabel(team)} back={BASE} />
      <section className="card eq-identity" aria-label="Identidade da equipa">
        <Emblem team={team} size={72} />
        {team.motto ? <p className="eq-motto">«{team.motto}»</p> : <p className="faint">Sem lema registado.</p>}
        {team.archived_at && <p className="faint">Equipa arquivada.</p>}
      </section>
      {o.can_manage && !team.archived_at && <IdentityEditor team={team} />}

      <YearSelect years={years} value={y} onChange={setYear} />

      <h2 className="section-title">Cargos em {y}</h2>
      <div className="card">
        <AppointmentList list={appointments} o={o} show="equipa" empty={<Empty title={`Sem cargos registados em ${y}.`} />} />
      </div>
      {o.can_manage && !team.archived_at && (
        <details className="card eq-panel">
          <summary>Nomear para um cargo</summary>
          <AppointForm o={o} team={team} />
        </details>
      )}

      <h2 className="section-title">{current ? 'Membros atuais' : `Membros em ${y}`}</h2>
      <div className="card">
        {!current && <p className="faint prose">Composição reconstruída a partir do histórico de mudanças de equipa.</p>}
        {members.length ? (
          <ul className="list">
            {members.map((m) => (
              <li key={m.membership_id}>
                <Link to={`${BASE}/pessoa/${m.membership_id}`} className="list-item">
                  <span className="grow"><strong>{m.full_name}</strong>{m.totem ? <span className="faint"> · {m.totem}</span> : null}</span>
                  <ChevronRight size={18} className="row-arrow" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : <Empty title={o.can_manage ? 'Sem membros.' : 'Sem membros visíveis.'} />}
      </div>

      {moves.length > 0 && (
        <>
          <h2 className="section-title">Entradas e saídas em {y}</h2>
          <div className="card">
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
          </div>
        </>
      )}
    </div>
  );
}

function IdentityEditor({ team }: { team: EqTeam }) {
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
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) throw new Error('O emblema tem de ser uma imagem PNG, JPG ou WebP.');
      await uploadModuleFile(section, 'equipas', 'equipa', team.id, f);
    }, 'Emblema carregado.').finally(() => { if (file.current) file.current.value = ''; });
  };
  return (
    <details className="card eq-panel">
      <summary>Editar identidade</summary>
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
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor={`emb-${team.id}`}>Emblema (opcional)</label>
        <span className="hint prose">Imagem PNG, JPG ou WebP até 10 MB. Fica guardada num espaço privado da secção.</span>
        <input ref={file} id={`emb-${team.id}`} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e.target.files?.[0])} />
      </div>
      {team.emblem && (
        <button type="button" className="btn ghost" disabled={act.busy}
          onClick={() => act.run(() => removeModuleFile(team.emblem!.path), 'Emblema retirado.')}>Retirar emblema</button>
      )}
      <Result error={act.error} success={act.success} />
      {team.color === null && !color && <Notice kind="info"><p>Sem cor, a equipa aparece em tons neutros.</p></Notice>}
    </details>
  );
}

