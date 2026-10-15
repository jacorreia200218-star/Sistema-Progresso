// Criar ou alterar uma reunião: tipo, equipa, data, local, ordem de trabalhos,
// participantes, partilhas (documentos gerais) e atividade do calendário.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { formatLisbon, isoToLisbon, lisbonToIso } from '../common';
import { KIND_AUDIENCE, KIND_LABEL, useMeeting, usePeople, useSectionId, type MeetingKind, type People } from './api';

export function PeoplePicker({ id, label, people, value, onChange }: {
  id: string; label: string; people: People['people']; value: string[]; onChange: (v: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const shown = people.filter((p) => !q.trim() || norm(p.name).includes(norm(q.trim())));
  return (
    <fieldset className="sec-picker" aria-describedby={`${id}-count`}>
      <legend>{label}</legend>
      <label className="search-field">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Procurar pessoa</span>
        <input type="search" placeholder="Procurar pessoa" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="sec-picker-list">
        {shown.map((p) => (
          <label key={p.id} className="check-row">
            <input type="checkbox" checked={value.includes(p.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))} />
            {p.name}
          </label>
        ))}
        {shown.length === 0 && <p className="faint">Ninguém com esse nome.</p>}
      </div>
      <p className="faint sec-meta" id={`${id}-count`}>{value.length === 1 ? '1 pessoa escolhida' : `${value.length} pessoas escolhidas`}</p>
    </fieldset>
  );
}

export function MeetingForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const section = useSectionId();
  const existing = useMeeting(id);
  const people = usePeople();
  const events = useQuery({
    queryKey: ['sec-events', section],
    queryFn: () => call<{ id: string; title: string; starts_at: string }[]>('sec_event_options', { p_section: section }),
  });
  const action = useAction();
  const [kind, setKind] = useState<MeetingKind | ''>('');
  const [team, setTeam] = useState('');
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [location, setLocation] = useState('');
  const [agenda, setAgenda] = useState('');
  const [event, setEvent] = useState('');
  const [participants, setParticipants] = useState<string[]>([]);
  const [shareP, setShareP] = useState<string[]>([]);
  const [shareT, setShareT] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    const d = existing.data;
    if (!d || loaded) return;
    setKind(d.meeting.kind);
    setTeam(d.meeting.team_id ?? '');
    setTitle(d.meeting.title);
    setWhen(isoToLisbon(d.meeting.starts_at));
    setLocation(d.meeting.location ?? '');
    setAgenda(d.meeting.agenda);
    setEvent(d.meeting.cal_event_id ?? '');
    setParticipants(d.participants.map((p) => p.id));
    setShareP(d.shares.filter((s) => s.profile_id).map((s) => s.profile_id!));
    setShareT(d.shares.filter((s) => s.team_id).map((s) => s.team_id!));
    setLoaded(true);
  }, [existing.data, loaded]);

  const hasMinutes = (existing.data?.minutes.length ?? 0) > 0;
  const eventOptions = useMemo(() => events.data ?? [], [events.data]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!kind) errs.kind = 'Escolhe o tipo de reunião.';
    if (kind === 'equipa' && !team) errs.team = 'Escolhe a equipa.';
    if (!title.trim()) errs.title = 'Indica o título.';
    if (!when) errs.when = 'Indica a data e a hora.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const r = await action.run(() => call<string>('sec_meeting_save', {
      p_section: section, p_meeting: id ?? null, p_kind: kind, p_team: kind === 'equipa' ? team : null, p_title: title.trim(),
      p_starts_at: lisbonToIso(when), p_location: location.trim() || null, p_agenda: agenda, p_cal_event: event || null,
      p_participants: participants, p_share_profiles: kind === 'geral' ? shareP : [], p_share_teams: kind === 'geral' ? shareT : [],
    }), id ? 'Reunião guardada.' : 'Reunião criada.');
    if (r.ok) navigate(`/secretaria/reunioes/${r.value}`, { replace: !!id });
  }

  if (id && (existing.isLoading || !loaded)) return existing.error ? <ErrorBox error={existing.error} /> : <Loading />;
  if (people.isLoading) return <Loading />;
  const ppl = people.data?.people ?? [];
  const teams = people.data?.teams ?? [];

  return (
    <>
      <PageTitle title={id ? 'Alterar reunião' : 'Nova reunião'} back={id ? `/secretaria/reunioes/${id}` : '/secretaria'} />
      <ErrorBox error={people.error} />
      <form className="card sec-form" onSubmit={submit} noValidate>
        <Field label="Tipo" htmlFor="sec-kind" hint={kind ? KIND_AUDIENCE[kind] : 'O tipo define quem pode ver a reunião e a ata.'}>
          <select id="sec-kind" value={kind} disabled={hasMinutes} aria-invalid={!!errors.kind}
            onChange={(e) => setKind(e.target.value as MeetingKind)}>
            <option value="">Escolher…</option>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {errors.kind && <span className="sec-error">{errors.kind}</span>}
          {hasMinutes && <span className="faint sec-meta">O tipo não muda depois de criada a ata.</span>}
        </Field>
        {kind === 'equipa' && (
          <Field label="Equipa" htmlFor="sec-team">
            <select id="sec-team" value={team} onChange={(e) => setTeam(e.target.value)} aria-invalid={!!errors.team}>
              <option value="">Escolher…</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {errors.team && <span className="sec-error">{errors.team}</span>}
          </Field>
        )}
        <Field label="Título" htmlFor="sec-title">
          <input id="sec-title" type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!errors.title} />
          {errors.title && <span className="sec-error">{errors.title}</span>}
        </Field>
        <div className="grid-2">
          <Field label="Data e hora" htmlFor="sec-when">
            <input id="sec-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-invalid={!!errors.when} />
            {errors.when && <span className="sec-error">{errors.when}</span>}
          </Field>
          <Field label="Local (opcional)" htmlFor="sec-location">
            <input id="sec-location" type="text" maxLength={300} value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
        </div>
        <Field label="Ordem de trabalhos" htmlFor="sec-agenda" hint="Um ponto por linha.">
          <textarea id="sec-agenda" rows={5} maxLength={10000} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
        </Field>
        <Field label="Atividade do calendário (opcional)" htmlFor="sec-event">
          <select id="sec-event" value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="">Sem ligação</option>
            {eventOptions.map((ev) => <option key={ev.id} value={ev.id}>{formatLisbon(ev.starts_at)} · {ev.title}</option>)}
          </select>
        </Field>
        <PeoplePicker id="sec-participants" label="Participantes" people={ppl} value={participants} onChange={setParticipants} />
        {kind === 'geral' && (
          <>
            <PeoplePicker id="sec-share" label="Partilhar com pessoas" people={ppl} value={shareP} onChange={setShareP} />
            <fieldset className="sec-picker">
              <legend>Partilhar com equipas</legend>
              {teams.map((t) => (
                <label key={t.id} className="check-row">
                  <input type="checkbox" checked={shareT.includes(t.id)}
                    onChange={(e) => setShareT(e.target.checked ? [...shareT, t.id] : shareT.filter((x) => x !== t.id))} />
                  {t.name}
                </label>
              ))}
              {teams.length === 0 && <p className="faint">Ainda não há equipas.</p>}
            </fieldset>
          </>
        )}
        <ErrorBox error={action.error} />
        {Object.keys(errors).length > 0 && <Notice kind="error">Revê os campos assinalados.</Notice>}
        <div className="btn-row">
          <button type="submit" className="btn" disabled={action.busy}>{action.busy ? 'A guardar…' : id ? 'Guardar' : 'Criar reunião'}</button>
        </div>
      </form>
    </>
  );
}
