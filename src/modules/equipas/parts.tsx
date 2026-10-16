// Peças partilhadas do módulo Equipas e cargos: emblema, nomeações (com terminar e
// anular), formulários de nomeação e de mudança de equipa, seletor de ano.
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Shield } from 'lucide-react';
import { call } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { useAction } from '../../lib/useAction';
import { Badge, Field, Notice } from '../../components/ui';
import { formatDay, todayLisbon } from '../common';
import {
  appointmentState, periodLabel, STATE_LABEL, STATE_TONE, useSectionId,
  type EqAppointment, type EqMember, type EqOverview, type EqRole, type EqTeam,
} from './data';
import { DateInput } from '../../components/DateInput';

export const BASE = '/equipas-e-cargos';

/** Lê/escreve um parâmetro do URL preservando os restantes (sobrevive ao «voltar»). */
export function useParam(key: string, fallback = '') {
  const [, setParams] = useSearchParams();
  const value = new URLSearchParams(window.location.search).get(key) ?? fallback;
  const set = (v: string) => {
    const p = new URLSearchParams(window.location.search);
    if (v && v !== fallback) p.set(key, v);
    else p.delete(key);
    setParams(p, { replace: true });
  };
  return [value, set] as const;
}

export function Result({ error, success }: { error: string | null; success: string | null }) {
  if (error) return <Notice kind="error"><p>{error}</p></Notice>;
  if (success) return <Notice kind="success"><p>{success}</p></Notice>;
  return null;
}

export function YearSelect({ years, value, onChange, id = 'eq-ano' }: { years: string[]; value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <div className="eq-year">
      <label htmlFor={id}>Ano escutista</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}

/** Emblema da equipa (anexo privado, URL temporário) ou a cor da equipa com a inicial. */
export function Emblem({ team, size = 56 }: { team: EqTeam; size?: number }) {
  const path = team.emblem?.path;
  const url = useQuery({
    queryKey: ['eq-emblem', path],
    enabled: !!path,
    staleTime: 50_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('modulos').createSignedUrl(path!, 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  const [failed, setFailed] = useState(false);
  const initial = team.name.replace(/^Equipa\s+/i, '').charAt(0).toUpperCase();
  return (
    <span className="eq-emblem" style={{ width: size, height: size, ['--team' as string]: team.color ?? 'var(--ink-faint)' }} aria-hidden="true">
      {url.data && !failed ? <img src={url.data} alt="" onError={() => setFailed(true)} /> : initial || <Shield size={size / 2} />}
    </span>
  );
}

export const teamLabel = (t: EqTeam | undefined) => (t ? (/^equipa\b/i.test(t.name) ? t.name : `Equipa ${t.name}`) : 'Sem equipa');

// ---------------------------------------------------------------------------
// Uma nomeação, com terminar/anular para quem gere
// ---------------------------------------------------------------------------
export function AppointmentItem({ a, o, show }: { a: EqAppointment; o: EqOverview; show: 'pessoa' | 'equipa' }) {
  const section = useSectionId();
  const role = o.roles.find((r) => r.id === a.role_id);
  const member = o.members.find((m) => m.membership_id === a.membership_id);
  const team = o.teams.find((t) => t.id === a.team_id);
  const state = appointmentState(a, o.today);
  const [mode, setMode] = useState<'' | 'fim' | 'anular'>('');
  const [end, setEnd] = useState(o.today);
  const [reason, setReason] = useState('');
  const [check, setCheck] = useState<string | null>(null);
  const act = useAction();
  const canEnd = o.can_manage && (state === 'ativo' || state === 'futuro');
  const canCancel = o.can_manage && state !== 'anulado';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setCheck(null);
    if (mode === 'fim') {
      if (!end) return setCheck('Indica a data de fim.');
      if (end < a.starts_on) return setCheck(`A data de fim não pode ser anterior à de início (${formatDay(a.starts_on)}).`);
      const r = await act.run(() => call('eq_end_appointment', { p_section: section, p_appointment: a.id, p_ends_on: end, p_reason: reason.trim() || null }), 'Nomeação terminada. Fica no histórico.');
      if (r.ok) setMode('');
    } else {
      if (!reason.trim()) return setCheck('Indica o motivo da anulação.');
      const r = await act.run(() => call('eq_cancel_appointment', { p_section: section, p_appointment: a.id, p_reason: reason.trim() }), 'Nomeação anulada. O registo mantém-se, marcado como anulado.');
      if (r.ok) setMode('');
    }
  };

  const who = show === 'equipa'
    ? <Link to={`${BASE}/pessoa/${a.membership_id}`}>{member?.full_name ?? 'Pessoa'}</Link>
    : <Link to={`${BASE}/equipa/${a.team_id}`}>{teamLabel(team)}</Link>;

  return (
    <li className={`eq-appointment state-${state}`} data-testid="nomeacao">
      <div className="eq-appointment-main">
        <div className="grow">
          <strong>{role?.name ?? 'Cargo'}</strong> <span className="faint">·</span> {who}
          <div className="faint">{periodLabel(a)}{a.end_reason ? ` · ${a.end_reason}` : ''}</div>
          {a.notes && <div className="faint prose">{a.notes}</div>}
          {a.cancelled_at && <div className="faint">Anulada{a.cancel_reason ? `: ${a.cancel_reason}` : ''}</div>}
        </div>
        <Badge label={STATE_LABEL[state]} tone={STATE_TONE[state]} />
      </div>
      {(canEnd || canCancel) && !mode && (
        <div className="btn-row eq-actions">
          {canEnd && <button type="button" className="btn secondary" onClick={() => { setMode('fim'); setReason(''); act.clear(); }}>Terminar</button>}
          {canCancel && <button type="button" className="btn ghost" onClick={() => { setMode('anular'); setReason(''); act.clear(); }}>Anular registo</button>}
        </div>
      )}
      {mode && (
        <form className="eq-inline-form" onSubmit={submit} noValidate>
          {mode === 'fim' ? (
            <>
              <p className="faint prose">A nomeação não é apagada: fica no histórico com esta data de fim. No dia de fim já pode começar outra pessoa.</p>
              <Field label="Data de fim" htmlFor={`fim-${a.id}`}>
                <DateInput id={`fim-${a.id}`} value={end} min={a.starts_on} onChange={(e) => setEnd(e.target.value)} required />
              </Field>
              <Field label="Motivo (opcional)" htmlFor={`mot-${a.id}`}>
                <input id={`mot-${a.id}`} type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: fim de mandato" />
              </Field>
            </>
          ) : (
            <>
              <p className="faint prose">Usa só para registos feitos por engano. A nomeação fica visível como anulada, com o motivo.</p>
              <Field label="Motivo da anulação" htmlFor={`anu-${a.id}`}>
                <input id={`anu-${a.id}`} type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} required />
              </Field>
            </>
          )}
          {check && <Notice kind="error"><p>{check}</p></Notice>}
          <div className="btn-row">
            <button type="submit" className="btn" disabled={act.busy} aria-busy={act.busy}>{mode === 'fim' ? 'Confirmar fim' : 'Anular nomeação'}</button>
            <button type="button" className="btn secondary" onClick={() => setMode('')}>Cancelar</button>
          </div>
        </form>
      )}
      <Result error={act.error} success={act.success} />
    </li>
  );
}

export function AppointmentList({ list, o, show, empty }: { list: EqAppointment[]; o: EqOverview; show: 'pessoa' | 'equipa'; empty: ReactNode }) {
  if (!list.length) return <>{empty}</>;
  return <ul className="list eq-appointments">{list.map((a) => <AppointmentItem key={a.id} a={a} o={o} show={show} />)}</ul>;
}

// ---------------------------------------------------------------------------
// Nomear
// ---------------------------------------------------------------------------
export function AppointForm({ o, team, member, onDone }: { o: EqOverview; team: EqTeam; member?: EqMember; onDone?: () => void }) {
  const section = useSectionId();
  const roles = o.roles.filter((r) => !r.archived_at);
  const people = o.members.filter((m) => m.status === 'ativo' && m.team_id === team.id);
  const [role, setRole] = useState('');
  const [person, setPerson] = useState(member?.membership_id ?? '');
  const [start, setStart] = useState(o.today || todayLisbon());
  const [end, setEnd] = useState('');
  const [remind, setRemind] = useState('7');
  const [notes, setNotes] = useState('');
  const [check, setCheck] = useState<string | null>(null);
  const act = useAction();
  const selected: EqRole | undefined = roles.find((r) => r.id === role);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setCheck(null);
    if (!role) return setCheck('Escolhe o cargo.');
    if (!person) return setCheck('Escolhe a pessoa.');
    if (!start) return setCheck('Indica a data de início.');
    if (end && end < start) return setCheck('A data de fim não pode ser anterior à de início.');
    const r = await act.run(() => call('eq_appoint', {
      p_section: section, p_role: role, p_team: team.id, p_membership: person, p_starts_on: start,
      p_ends_on: end || null, p_notes: notes.trim() || null, p_remind_days: end && remind ? Number(remind) : null,
    }), 'Nomeação registada. A pessoa foi avisada.');
    if (r.ok) {
      setRole(''); setEnd(''); setNotes('');
      if (!member) setPerson('');
      onDone?.();
    }
  };

  if (!roles.length) {
    return <Notice kind="info"><p className="prose">Ainda não há cargos configurados. Cria-os em <Link to={`${BASE}?vista=cargos`}>Cargos</Link>.</p></Notice>;
  }
  return (
    <form onSubmit={submit} noValidate aria-label="Nomear para um cargo">
      <div className="grid-2">
        <Field label="Cargo" htmlFor="eq-role">
          <select id="eq-role" value={role} onChange={(e) => setRole(e.target.value)} required>
            <option value="">Escolher…</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        {member ? (
          <Field label="Equipa" htmlFor="eq-team-fixed">
            <input id="eq-team-fixed" type="text" value={teamLabel(team)} readOnly />
          </Field>
        ) : (
          <Field label="Pessoa" htmlFor="eq-person">
            <select id="eq-person" value={person} onChange={(e) => setPerson(e.target.value)} required>
              <option value="">{people.length ? 'Escolher…' : 'Sem membros nesta equipa'}</option>
              {people.map((m) => <option key={m.membership_id} value={m.membership_id}>{m.full_name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Início" htmlFor="eq-start">
          <DateInput id="eq-start" value={start} onChange={(e) => setStart(e.target.value)} required />
        </Field>
        <Field label="Fim (opcional)" htmlFor="eq-end" hint="Deixa vazio se não tiver data prevista.">
          <DateInput id="eq-end" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      {end && (
        <Field label="Lembrete à pessoa antes do fim" htmlFor="eq-remind">
          <select id="eq-remind" value={remind} onChange={(e) => setRemind(e.target.value)}>
            <option value="">Sem lembrete</option>
            <option value="3">3 dias antes</option>
            <option value="7">7 dias antes</option>
            <option value="14">14 dias antes</option>
            <option value="30">30 dias antes</option>
          </select>
        </Field>
      )}
      {selected?.description && <p className="faint prose eq-duties"><strong>Responsabilidades:</strong> {selected.description}</p>}
      <Field label="Notas (opcional)" htmlFor="eq-notes">
        <input id="eq-notes" type="text" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {check && <Notice kind="error"><p>{check}</p></Notice>}
      <Result error={act.error} success={act.success} />
      <button type="submit" className="btn" disabled={act.busy} aria-busy={act.busy}>Nomear</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Mudar de equipa
// ---------------------------------------------------------------------------
export function MoveForm({ o, member }: { o: EqOverview; member: EqMember }) {
  const section = useSectionId();
  const teams = o.teams.filter((t) => !t.archived_at && t.id !== member.team_id);
  const [to, setTo] = useState('');
  const [day, setDay] = useState(o.today);
  const [reason, setReason] = useState('');
  const [endRoles, setEndRoles] = useState(true);
  const [check, setCheck] = useState<string | null>(null);
  const act = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setCheck(null);
    if (!to) return setCheck('Escolhe a nova equipa.');
    if (!day) return setCheck('Indica a data da mudança.');
    if (day > o.today) return setCheck('A data da mudança não pode ser futura.');
    const r = await act.run(() => call('eq_move_member', {
      p_section: section, p_membership: member.membership_id, p_to_team: to, p_effective_on: day, p_reason: reason.trim() || null, p_end_roles: endRoles,
    }), o.space === 'teste'
      ? 'Mudança registada no ambiente de teste. A equipa real da pessoa não foi alterada.'
      : 'Mudança de equipa registada. A pessoa foi avisada.');
    if (r.ok) { setTo(''); setReason(''); }
  };

  return (
    <form onSubmit={submit} noValidate aria-label="Mudar de equipa">
      <p className="faint prose">
        {o.space === 'teste'
          ? 'No ambiente de teste a mudança fica só no histórico de teste: a equipa real da pessoa não muda.'
          : 'A mudança passa a valer em toda a aplicação (incluindo quem acompanha o progresso na equipa) e fica no histórico. O progresso e os pedidos já feitos não mudam.'}
      </p>
      <div className="grid-2">
        <Field label="Nova equipa" htmlFor="eq-to">
          <select id="eq-to" value={to} onChange={(e) => setTo(e.target.value)} required>
            <option value="">Escolher…</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{teamLabel(t)}</option>)}
          </select>
        </Field>
        <Field label="Data da mudança" htmlFor="eq-move-day">
          <DateInput id="eq-move-day" value={day} max={o.today} onChange={(e) => setDay(e.target.value)} required />
        </Field>
      </div>
      <Field label="Motivo (opcional)" htmlFor="eq-move-reason">
        <input id="eq-move-reason" type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <label className="eq-check">
        <input type="checkbox" checked={endRoles} onChange={(e) => setEndRoles(e.target.checked)} />
        <span>Terminar, nesta data, os cargos na equipa anterior</span>
      </label>
      {check && <Notice kind="error"><p>{check}</p></Notice>}
      <Result error={act.error} success={act.success} />
      <button type="submit" className="btn" disabled={act.busy} aria-busy={act.busy}>Mudar de equipa</button>
    </form>
  );
}
