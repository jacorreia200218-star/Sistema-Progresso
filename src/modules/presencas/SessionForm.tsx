// Criar ou editar uma sessão de presenças: a partir de uma atividade do Calendário (mesmo
// espaço; uma sessão por atividade) ou uma reunião/sessão própria.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ErrorBox, Field, Loading, MoreOptions, Notice, PageTitle } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { formatDay, lisbonDay, lisbonTime, MEETING_DEFAULT, nextSaturday, todayLisbon } from '../common';
import { EventSelect, type EventChoice } from '../EventSelect';
import { useSectionId, type Board, type EventOption, type SessionDetail } from './api';
import { DateInput } from '../../components/DateInput';

export function SessionForm() {
  const { id } = useParams();
  const section = useSectionId();
  const nav = useNavigate();
  const a = useAction();
  const existing = useQuery({
    queryKey: ['pres-session', section, id],
    queryFn: () => call<SessionDetail>('pres_session', { p_section: section, p_session: id }),
    enabled: !!id,
  });
  const options = useQuery({ queryKey: ['pres-events', section], queryFn: () => call<EventOption[]>('pres_event_options', { p_section: section }) });
  const today = todayLisbon();
  const teams = useQuery({
    queryKey: ['pres-board', section, today, today, ''],
    queryFn: () => call<Board>('pres_board', { p_section: section, p_from: today, p_to: today, p_team: null }),
  });
  const [event, setEvent] = useState('');
  // Por omissão, a reunião de sábado.
  const [date, setDate] = useState(() => nextSaturday(today));
  const [title, setTitle] = useState<string>(MEETING_DEFAULT.title);
  const [kind, setKind] = useState<'reuniao' | 'atividade'>('reuniao');
  const [team, setTeam] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const s = existing.data?.session;
    if (!s) return;
    setEvent(s.cal_event?.id ?? '');
    setDate(s.date); setTitle(s.title); setKind(s.kind); setTeam(s.team_id ?? ''); setNotes(s.notes ?? '');
  }, [existing.data]);

  const evOptions: EventOption[] = [
    ...(existing.data?.session.cal_event ? [{ ...existing.data.session.cal_event, audience: '', team_id: null, team_name: null }] : []),
    ...(options.data ?? []),
  ];
  const ev = evOptions.find((e) => e.id === event);
  // Formato comum do seletor: «DD/MM/AAAA · Nome» (hora/equipa só para distinguir homónimos).
  const evChoices: EventChoice[] = evOptions.map((e) => ({
    id: e.id, title: e.title, team_name: e.team_name,
    day: e.starts_at ? lisbonDay(e.starts_at) : e.start,
    time: e.starts_at && !e.all_day ? lisbonTime(e.starts_at) : null,
    note: e.end && e.end !== e.start ? `até ${formatDay(e.end)}` : null,
  }));
  const pickEvent = (eid: string) => {
    setEvent(eid);
    const e = evOptions.find((x) => x.id === eid);
    if (e) { setTitle(e.title); setDate(e.start); setKind('atividade'); setTeam(e.audience === 'equipa' && e.team_id ? e.team_id : ''); }
    else setKind('reuniao');
  };

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!date) errs.date = 'Indica a data.';
    if (!title.trim()) errs.title = 'Indica o nome do evento.';
    if (ev && date && (date < ev.start || date > ev.end)) errs.date = 'A data tem de estar dentro das datas da atividade.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const r = await a.run(() => call<string>('pres_session_save', {
      p_section: section, p_session: id ?? null, p_cal_event: event || null,
      p_date: date, p_title: title.trim(), p_kind: kind, p_team: team || null, p_notes: notes.trim() || null,
    }), id ? 'Sessão guardada.' : 'Sessão criada.');
    if (r.ok && r.value) nav(`/presencas/sessoes/${r.value}`, { replace: true });
  };

  if (id && existing.isLoading) return <Loading />;
  return (
    <>
      <PageTitle title={id ? 'Editar sessão' : 'Nova sessão'} back={id ? `/presencas/sessoes/${id}` : '/presencas'} />
      <ErrorBox error={existing.error} />
      <form className="card pres-form" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Evento" htmlFor="pres-title">
          <input id="pres-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!errors.title} />
          {errors.title && <span className="pres-error">{errors.title}</span>}
        </Field>
        <Field label="Data" htmlFor="pres-date">
          <DateInput id="pres-date" value={date} min={ev?.start} max={ev?.end} onChange={(e) => setDate(e.target.value)} aria-invalid={!!errors.date} />
          {errors.date && <span className="pres-error">{errors.date}</span>}
        </Field>
        <Field label="Notas (opcional)" htmlFor="pres-notes">
          <textarea id="pres-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <MoreOptions open={!!existing.data?.session && (!!existing.data.session.cal_event || !!existing.data.session.team_id)}>
          <Field label="Atividade do Calendário" htmlFor="pres-event">
            <EventSelect id="pres-event" value={event} onChange={pickEvent} events={evChoices} empty="Nenhuma (sessão própria)"
              loading={options.isLoading} />
          </Field>
          <Field label="Tipo" htmlFor="pres-kind">
            <select id="pres-kind" value={kind} onChange={(e) => setKind(e.target.value as 'reuniao')}>
              <option value="reuniao">Reunião</option>
              <option value="atividade">Atividade</option>
            </select>
          </Field>
          <Field label="Quem conta" htmlFor="pres-team">
            <select id="pres-team" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">Toda a secção</option>
              {(teams.data?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        </MoreOptions>
        {a.error && <Notice kind="error">{a.error}</Notice>}
        <div className="btn-row">
          <button type="submit" className="btn" disabled={a.busy} aria-busy={a.busy}>{id ? 'Guardar' : 'Criar sessão'}</button>
          <button type="button" className="btn secondary" onClick={() => nav(id ? `/presencas/sessoes/${id}` : '/presencas')}>Cancelar</button>
        </div>
      </form>
    </>
  );
}
