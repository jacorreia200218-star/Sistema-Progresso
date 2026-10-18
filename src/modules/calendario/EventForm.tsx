// Criar ou alterar uma atividade (só quem gere; o servidor volta a validar tudo).
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { useActiveSection } from '../../lib/session';
import { ErrorBox, Field, Loading, MoreOptions, Notice, PageTitle } from '../../components/ui';
import { useModuleCtx } from '../ModuleShell';
import { isoToLisbon, lisbonToIso, MEETING_DEFAULT, nextSaturday } from '../common';
import { period, REMINDER_OPTIONS, yearOf, type CalDetail } from './cal';
import { useCalConfig } from './Overview';
import { isReadonly, SourceNotice } from './source';
import { DateInput, DateTimeInput, TimeInput } from '../../components/DateInput';
import { parseTimeText } from '../../lib/dates';

type Options = { teams: { id: string; name: string }[]; members: { id: string; name: string; function: string | null; team_id: string | null }[] };

interface FormState {
  title: string; description: string; location: string;
  /** Sem hora de início, a atividade é de dia inteiro. */
  startDay: string; endDay: string; startTime: string; endTime: string;
  audience: 'seccao' | 'equipa'; team_id: string; responsible_id: string; deadline: string;
  needs_authorization: boolean; needs_payment: boolean; needs_registration: boolean; material: string;
  reminder_minutes: number[]; deadline_reminder_minutes: number[];
}

/** Nova atividade: por omissão, a reunião de sábado (14:30–16:00); «day» (AAAA-MM-DD) vem do dia escolhido no calendário anual. */
const empty = (day = nextSaturday()): FormState => ({
  title: MEETING_DEFAULT.title, description: '', location: '',
  startDay: day, endDay: '', startTime: MEETING_DEFAULT.start, endTime: MEETING_DEFAULT.end,
  audience: 'seccao', team_id: '', responsible_id: '', deadline: '',
  needs_authorization: false, needs_payment: false, needs_registration: false, material: '',
  reminder_minutes: [1440], deadline_reminder_minutes: [1440],
});

const fromEvent = (e: CalDetail): FormState => ({
  title: e.title, description: e.description ?? '', location: e.location ?? '',
  startDay: e.all_day ? e.start_date! : isoToLisbon(e.starts_at!).slice(0, 10),
  endDay: e.all_day ? (e.end_date !== e.start_date ? e.end_date ?? '' : '') : sameOr(isoToLisbon(e.ends_at!).slice(0, 10), isoToLisbon(e.starts_at!).slice(0, 10)),
  startTime: e.all_day ? '' : isoToLisbon(e.starts_at!).slice(11, 16),
  endTime: e.all_day ? '' : isoToLisbon(e.ends_at!).slice(11, 16),
  audience: e.audience, team_id: e.team_id ?? '', responsible_id: e.responsible_id ?? '',
  deadline: e.registration_deadline ? isoToLisbon(e.registration_deadline) : '',
  needs_authorization: e.needs_authorization, needs_payment: e.needs_payment, needs_registration: e.needs_registration,
  material: e.material ?? '', reminder_minutes: e.reminder_minutes, deadline_reminder_minutes: e.deadline_reminder_minutes,
});

/** Último dia só quando é diferente do primeiro. */
const sameOr = (end: string, start: string) => (end === start ? '' : end);

/** Início e fim («AAAA-MM-DDTHH:MM») de uma atividade com hora; null se for de dia inteiro. */
function times(f: FormState) {
  const st = parseTimeText(f.startTime);
  if (!st) return null;
  const et = parseTimeText(f.endTime) ?? st;
  return { start: `${f.startDay}T${st}`, end: `${f.endDay || f.startDay}T${et}` };
}

function validate(f: FormState): Record<string, string> {
  const err: Record<string, string> = {};
  if (!f.title.trim()) err.title = 'Indica o nome do evento.';
  if (!f.startDay) err.start = 'Indica a data.';
  else if (f.endDay && f.endDay < f.startDay) err.end = 'O último dia não pode ser antes da data.';
  if (f.startTime.trim() && !parseTimeText(f.startTime)) err.time = 'Escreve a hora como 09:30.';
  else if (f.endTime.trim() && !parseTimeText(f.endTime)) err.time = 'Escreve a hora como 09:30.';
  else if (!f.startTime.trim() && f.endTime.trim()) err.time = 'Indica também a hora de início.';
  const t = times(f);
  if (t && f.startDay && t.end < t.start) err.time = 'O fim não pode ser antes do início.';
  if (f.deadline) {
    const limit = t ? t.start : `${f.startDay}T23:59`;
    if (f.deadline > limit) err.deadline = 'O prazo de inscrição tem de terminar antes do início da atividade.';
  }
  if (f.audience === 'equipa' && !f.team_id) err.team = 'Escolhe a equipa.';
  return err;
}

export function EventForm() {
  const { id } = useParams();
  const section = useActiveSection().membership.section_id;
  const { space, can } = useModuleCtx();
  const opts = useQuery({ queryKey: ['cal-form-options', section], queryFn: () => call<Options>('cal_form_options', { p_section: section }), enabled: can('calendario.gerir', true) });
  const ev = useQuery({
    queryKey: ['cal-event', section, space, id],
    queryFn: () => call<CalDetail>('cal_event_get', { p_section: section, p_event: id }),
    enabled: !!id,
  });
  const title = id ? 'Alterar atividade' : 'Nova atividade';
  if (!can('calendario.gerir', true)) {
    return (
      <>
        <PageTitle title={title} back="/calendario" />
        <Notice kind="info">Só os dirigentes e quem tem a permissão «Gerir atividades» podem criar ou alterar atividades.</Notice>
      </>
    );
  }
  if (opts.isLoading || ev.isLoading) return <Loading />;
  if (opts.error || ev.error) return <><PageTitle title={title} back="/calendario" /><ErrorBox error={opts.error ?? ev.error} /></>;
  return <FormBody key={id ?? 'nova'} title={title} event={ev.data ?? null} options={opts.data!} />;
}

function FormBody({ title, event, options }: { title: string; event: CalDetail | null; options: Options }) {
  const section = useActiveSection().membership.section_id;
  const navigate = useNavigate();
  const action = useAction();
  const [params] = useSearchParams();
  const preset = params.get('dia');
  const [f, setF] = useState<FormState>(() => (event ? fromEvent(event) : empty(preset && /^\d{4}-\d{2}-\d{2}$/.test(preset) ? preset : undefined)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Atividade do iCloud: título, datas, local e descrição só mudam no iCloud.
  const ro = !!event && isReadonly(event);
  // Nova atividade: por omissão repete todas as semanas até ao fim do ano escutista (a reunião de sábado).
  const cfg = useCalConfig();
  const startMonth = cfg.data?.year_start_month ?? 9;
  const yearEnd = f.startDay ? period('escutista', yearOf(f.startDay, 'escutista', startMonth), startMonth).to : '';
  const [repeat, setRepeat] = useState(!event);
  const [until, setUntil] = useState('');
  const untilDay = until || yearEnd;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggleIn = (k: 'reminder_minutes' | 'deadline_reminder_minutes', m: number) =>
    set(k, f[k].includes(m) ? f[k].filter((x) => x !== m) : [...f[k], m].sort((a, b) => b - a));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err = validate(f);
    if (!event && repeat) {
      if (!untilDay) err.until = 'Indica até quando se repete.';
      else if (untilDay < f.startDay) err.until = 'A repetição tem de terminar depois da data.';
    }
    setErrors(err);
    if (Object.keys(err).length) return;
    const t = times(f);
    const data = {
      title: f.title.trim(), description: f.description, location: f.location, all_day: !t,
      ...(t ? { starts_at: lisbonToIso(t.start), ends_at: lisbonToIso(t.end) }
        : { start_date: f.startDay, end_date: f.endDay || f.startDay }),
      audience: f.audience, team_id: f.audience === 'equipa' ? f.team_id : null, responsible_id: f.responsible_id || null,
      registration_deadline: f.deadline ? lisbonToIso(f.deadline) : null,
      needs_authorization: f.needs_authorization, needs_payment: f.needs_payment, needs_registration: f.needs_registration,
      material: f.material, reminder_minutes: f.reminder_minutes, deadline_reminder_minutes: f.deadline_reminder_minutes,
    };
    if (!event && repeat) {
      const w = await action.run(() => call<number>('cal_create_weekly', { p_section: section, p_data: data, p_until: untilDay }));
      if (w.ok) {
        const n = w.value ?? 0;
        navigate(`/calendario?ano=${f.startDay.slice(0, 4)}`, {
          replace: true,
          state: { flash: n === 0 ? 'Estas datas já estavam no calendário.' : n === 1 ? '1 atividade criada. Os envolvidos foram avisados.' : `${n} atividades criadas, uma por semana. Os envolvidos foram avisados.` },
        });
      }
      return;
    }
    const r = await action.run(() => event
      ? call('cal_update_event', { p_section: section, p_event: event.id, p_data: data, p_expected_updated_at: event.updated_at }).then(() => event.id)
      : call<string>('cal_create_event', { p_section: section, p_data: data }));
    if (r.ok && r.value) {
      navigate(`/calendario/evento/${r.value}`, {
        replace: true,
        state: { flash: event ? 'Atividade alterada. Os envolvidos foram avisados.' : 'Atividade criada. Os envolvidos foram avisados.' },
      });
    }
  };

  // Abre as opções quando já têm valores (ao alterar) ou quando há erros nelas.
  const moreOpen = !!event && (!event.all_day || !!f.endDay || !!f.location || f.audience !== 'seccao' || !!f.responsible_id || !!f.deadline
    || f.needs_authorization || f.needs_payment || f.needs_registration || !!f.material)
    || ['time', 'end', 'team', 'deadline'].some((k) => errors[k]);
  const errId = (k: string) => (errors[k] ? `cal-err-${k}` : undefined);
  const Err = ({ k }: { k: string }) => (errors[k] ? <p className="field-error" id={`cal-err-${k}`}>{errors[k]}</p> : null);

  return (
    <>
      <PageTitle title={title} back="/calendario" />
            <form className="card cal-form" onSubmit={submit} noValidate>
        {Object.keys(errors).length > 0 && <Notice kind="error">Revê os campos assinalados.</Notice>}
        {event && <SourceNotice e={event} />}
        <Field label="Evento" htmlFor="cal-title">
          <input id="cal-title" maxLength={200} readOnly={ro} value={f.title} onChange={(e) => set('title', e.target.value)} aria-invalid={!!errors.title} aria-describedby={errId('title')} />
        </Field>
        <Err k="title" />
        <Field label="Data" htmlFor="cal-sd">
          <DateInput id="cal-sd" disabled={ro} value={f.startDay} onChange={(e) => set('startDay', e.target.value)} aria-invalid={!!errors.start} aria-describedby={errId('start')} />
        </Field>
        <Err k="start" />
        {!event && (
          <div className="cal-repeat">
            <label className="checkbox"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Repetir todas as semanas até</label>
            <DateInput id="cal-until" aria-label="Repetir até" value={untilDay} min={f.startDay} disabled={!repeat}
              onChange={(e) => setUntil(e.target.value)} aria-invalid={!!errors.until} aria-describedby={errId('until')} />
          </div>
        )}
        <Err k="until" />
        <Field label="Notas (opcional)" htmlFor="cal-desc">
          <textarea id="cal-desc" rows={3} maxLength={5000} readOnly={ro} value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>

        <MoreOptions open={moreOpen}>
          <fieldset>
            <legend className="label">Horário e duração</legend>
            <div className="cal-time-row">
              <Field label="Hora de início" htmlFor="cal-st"><TimeInput id="cal-st" className="time-field" disabled={ro} value={f.startTime} onChange={(e) => set('startTime', e.target.value)} aria-invalid={!!errors.time} aria-describedby={errId('time')} /></Field>
              <Field label="Hora de fim" htmlFor="cal-et"><TimeInput id="cal-et" className="time-field" disabled={ro} value={f.endTime} onChange={(e) => set('endTime', e.target.value)} aria-invalid={!!errors.time} aria-describedby={errId('time')} /></Field>
              <Field label="Último dia" htmlFor="cal-ed"><DateInput id="cal-ed" disabled={ro} value={f.endDay} min={f.startDay} onChange={(e) => set('endDay', e.target.value)} aria-invalid={!!errors.end} aria-describedby={errId('end')} /></Field>
            </div>
            <Err k="time" /><Err k="end" />
            <p className="faint">Sem hora, conta como dia inteiro. Último dia só se durar vários dias.</p>
          </fieldset>
          <Field label="Local" htmlFor="cal-loc">
            <input id="cal-loc" maxLength={300} readOnly={ro} value={f.location} onChange={(e) => set('location', e.target.value)} />
          </Field>

        <fieldset className="cal-fieldset">
          <legend className="label">Para quem</legend>
          <div className="radio-row">
            <label className="radio"><input type="radio" name="aud" checked={f.audience === 'seccao'} onChange={() => set('audience', 'seccao')} /> Toda a secção</label>
            <label className="radio"><input type="radio" name="aud" checked={f.audience === 'equipa'} onChange={() => set('audience', 'equipa')} /> Uma equipa</label>
          </div>
          {f.audience === 'equipa' && (
            <Field label="Equipa" htmlFor="cal-team">
              <select id="cal-team" value={f.team_id} onChange={(e) => set('team_id', e.target.value)} aria-invalid={!!errors.team} aria-describedby={errId('team')}>
                <option value="">Escolhe…</option>
                {options.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          )}
          <Err k="team" />
          <Field label="Responsável" htmlFor="cal-resp">
            <select id="cal-resp" value={f.responsible_id} onChange={(e) => set('responsible_id', e.target.value)}>
              <option value="">Sem responsável</option>
              {options.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        </fieldset>

        <fieldset className="cal-fieldset">
          <legend className="label">Inscrição e pendências</legend>
          <Field label="Prazo de inscrição" htmlFor="cal-dl" hint="Depois do prazo, só os dirigentes e gestores podem mudar respostas.">
            <DateTimeInput timeLabel="Hora do prazo de inscrição" id="cal-dl" value={f.deadline} onChange={(e) => set('deadline', e.target.value)} aria-invalid={!!errors.deadline} aria-describedby={errId('deadline')} />
          </Field>
          <Err k="deadline" />
          <label className="checkbox"><input type="checkbox" checked={f.needs_authorization} onChange={(e) => set('needs_authorization', e.target.checked)} /> Pede autorização</label>
          <label className="checkbox"><input type="checkbox" checked={f.needs_payment} onChange={(e) => set('needs_payment', e.target.checked)} /> Pede pagamento</label>
          <label className="checkbox"><input type="checkbox" checked={f.needs_registration} onChange={(e) => set('needs_registration', e.target.checked)} /> Pede inscrição formal</label>
          <Field label="Material a levar" htmlFor="cal-mat">
            <textarea id="cal-mat" rows={2} maxLength={2000} value={f.material} onChange={(e) => set('material', e.target.value)} />
          </Field>
        </fieldset>

        <fieldset className="cal-fieldset">
          <legend className="label">Alertas (lembretes)</legend>
          <p className="faint">Antes da atividade:</p>
          <div className="cal-reminders" role="group" aria-label="Lembretes antes da atividade">
            {REMINDER_OPTIONS.map((o) => (
              <label key={o.minutes} className="checkbox"><input type="checkbox" checked={f.reminder_minutes.includes(o.minutes)} onChange={() => toggleIn('reminder_minutes', o.minutes)} /> {o.label}</label>
            ))}
          </div>
          {f.deadline && (
            <>
              <p className="faint">Antes do prazo de inscrição (para quem ainda tem algo em falta):</p>
              <div className="cal-reminders" role="group" aria-label="Lembretes antes do prazo">
                {REMINDER_OPTIONS.map((o) => (
                  <label key={o.minutes} className="checkbox"><input type="checkbox" checked={f.deadline_reminder_minutes.includes(o.minutes)} onChange={() => toggleIn('deadline_reminder_minutes', o.minutes)} /> {o.label}</label>
                ))}
              </div>
            </>
          )}
        </fieldset>
        </MoreOptions>

        <ErrorBox error={action.error} />
        <div className="btn-row">
          <button type="submit" className="btn" disabled={action.busy}>{event ? 'Guardar alterações' : 'Criar atividade'}</button>
          <button type="button" className="btn secondary" onClick={() => navigate(-1)}>Voltar sem guardar</button>
        </div>
      </form>
    </>
  );
}
