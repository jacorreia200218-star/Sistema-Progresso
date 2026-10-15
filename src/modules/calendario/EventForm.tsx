// Criar ou alterar uma atividade (só quem gere; o servidor volta a validar tudo).
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { useActiveSection } from '../../lib/session';
import { ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import { useModuleCtx } from '../ModuleShell';
import { isoToLisbon, lisbonToIso, todayLisbon } from '../common';
import { REMINDER_OPTIONS, type CalDetail } from './cal';

type Options = { teams: { id: string; name: string }[]; members: { id: string; name: string; function: string | null; team_id: string | null }[] };

interface FormState {
  title: string; description: string; location: string; all_day: boolean;
  start: string; end: string; startDay: string; endDay: string;
  audience: 'seccao' | 'equipa'; team_id: string; responsible_id: string; deadline: string;
  needs_authorization: boolean; needs_payment: boolean; needs_registration: boolean; material: string;
  reminder_minutes: number[]; deadline_reminder_minutes: number[];
}

const empty = (): FormState => ({
  title: '', description: '', location: '', all_day: false,
  start: `${todayLisbon()}T10:00`, end: `${todayLisbon()}T12:00`, startDay: todayLisbon(), endDay: todayLisbon(),
  audience: 'seccao', team_id: '', responsible_id: '', deadline: '',
  needs_authorization: false, needs_payment: false, needs_registration: false, material: '',
  reminder_minutes: [1440], deadline_reminder_minutes: [1440],
});

const fromEvent = (e: CalDetail): FormState => ({
  title: e.title, description: e.description ?? '', location: e.location ?? '', all_day: e.all_day,
  start: e.starts_at ? isoToLisbon(e.starts_at) : `${e.start_date}T10:00`,
  end: e.ends_at ? isoToLisbon(e.ends_at) : `${e.end_date}T12:00`,
  startDay: e.start_date ?? isoToLisbon(e.starts_at!).slice(0, 10),
  endDay: e.end_date ?? isoToLisbon(e.ends_at!).slice(0, 10),
  audience: e.audience, team_id: e.team_id ?? '', responsible_id: e.responsible_id ?? '',
  deadline: e.registration_deadline ? isoToLisbon(e.registration_deadline) : '',
  needs_authorization: e.needs_authorization, needs_payment: e.needs_payment, needs_registration: e.needs_registration,
  material: e.material ?? '', reminder_minutes: e.reminder_minutes, deadline_reminder_minutes: e.deadline_reminder_minutes,
});

function validate(f: FormState): Record<string, string> {
  const err: Record<string, string> = {};
  if (!f.title.trim()) err.title = 'Indica o título da atividade.';
  if (f.all_day) {
    if (!f.startDay) err.start = 'Indica o dia de início.';
    else if (f.endDay && f.endDay < f.startDay) err.end = 'O fim não pode ser antes do início.';
  } else {
    if (!f.start) err.start = 'Indica o dia e a hora de início.';
    else if (f.end && f.end < f.start) err.end = 'O fim não pode ser antes do início.';
  }
  if (f.deadline) {
    const limit = f.all_day ? `${f.startDay}T23:59` : f.start;
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
  const [f, setF] = useState<FormState>(() => (event ? fromEvent(event) : empty()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggleIn = (k: 'reminder_minutes' | 'deadline_reminder_minutes', m: number) =>
    set(k, f[k].includes(m) ? f[k].filter((x) => x !== m) : [...f[k], m].sort((a, b) => b - a));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err = validate(f);
    setErrors(err);
    if (Object.keys(err).length) return;
    const data = {
      title: f.title.trim(), description: f.description, location: f.location, all_day: f.all_day,
      ...(f.all_day ? { start_date: f.startDay, end_date: f.endDay || f.startDay }
        : { starts_at: lisbonToIso(f.start), ends_at: lisbonToIso(f.end || f.start) }),
      audience: f.audience, team_id: f.audience === 'equipa' ? f.team_id : null, responsible_id: f.responsible_id || null,
      registration_deadline: f.deadline ? lisbonToIso(f.deadline) : null,
      needs_authorization: f.needs_authorization, needs_payment: f.needs_payment, needs_registration: f.needs_registration,
      material: f.material, reminder_minutes: f.reminder_minutes, deadline_reminder_minutes: f.deadline_reminder_minutes,
    };
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

  const errId = (k: string) => (errors[k] ? `cal-err-${k}` : undefined);
  const Err = ({ k }: { k: string }) => (errors[k] ? <p className="field-error" id={`cal-err-${k}`}>{errors[k]}</p> : null);

  return (
    <>
      <PageTitle title={title} back="/calendario" />
      <form className="card cal-form" onSubmit={submit} noValidate>
        {Object.keys(errors).length > 0 && <Notice kind="error">Revê os campos assinalados.</Notice>}
        <Field label="Título" htmlFor="cal-title">
          <input id="cal-title" maxLength={200} value={f.title} onChange={(e) => set('title', e.target.value)} aria-invalid={!!errors.title} aria-describedby={errId('title')} />
        </Field>
        <Err k="title" />
        <Field label="Descrição (opcional)" htmlFor="cal-desc">
          <textarea id="cal-desc" rows={3} maxLength={5000} value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Local (opcional)" htmlFor="cal-loc">
          <input id="cal-loc" maxLength={300} value={f.location} onChange={(e) => set('location', e.target.value)} />
        </Field>

        <fieldset className="cal-fieldset">
          <legend className="label">Quando</legend>
          <label className="checkbox"><input type="checkbox" checked={f.all_day} onChange={(e) => set('all_day', e.target.checked)} /> Dia inteiro (um ou vários dias)</label>
          <div className="grid-2">
            {f.all_day ? (
              <>
                <Field label="Primeiro dia" htmlFor="cal-sd"><input id="cal-sd" type="date" value={f.startDay} onChange={(e) => set('startDay', e.target.value)} aria-invalid={!!errors.start} aria-describedby={errId('start')} /></Field>
                <Field label="Último dia" htmlFor="cal-ed"><input id="cal-ed" type="date" value={f.endDay} min={f.startDay} onChange={(e) => set('endDay', e.target.value)} aria-invalid={!!errors.end} aria-describedby={errId('end')} /></Field>
              </>
            ) : (
              <>
                <Field label="Início" htmlFor="cal-s"><input id="cal-s" type="datetime-local" value={f.start} onChange={(e) => set('start', e.target.value)} aria-invalid={!!errors.start} aria-describedby={errId('start')} /></Field>
                <Field label="Fim" htmlFor="cal-e"><input id="cal-e" type="datetime-local" value={f.end} min={f.start} onChange={(e) => set('end', e.target.value)} aria-invalid={!!errors.end} aria-describedby={errId('end')} /></Field>
              </>
            )}
          </div>
          <Err k="start" /><Err k="end" />
          <p className="faint">Horas de Portugal continental (Lisboa).</p>
        </fieldset>

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
          <Field label="Responsável (opcional)" htmlFor="cal-resp">
            <select id="cal-resp" value={f.responsible_id} onChange={(e) => set('responsible_id', e.target.value)}>
              <option value="">Sem responsável</option>
              {options.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        </fieldset>

        <fieldset className="cal-fieldset">
          <legend className="label">Inscrição e pendências</legend>
          <Field label="Prazo de inscrição (opcional)" htmlFor="cal-dl" hint="Depois do prazo, só os dirigentes e gestores podem mudar respostas.">
            <input id="cal-dl" type="datetime-local" value={f.deadline} onChange={(e) => set('deadline', e.target.value)} aria-invalid={!!errors.deadline} aria-describedby={errId('deadline')} />
          </Field>
          <Err k="deadline" />
          <label className="checkbox"><input type="checkbox" checked={f.needs_authorization} onChange={(e) => set('needs_authorization', e.target.checked)} /> Pede autorização</label>
          <label className="checkbox"><input type="checkbox" checked={f.needs_payment} onChange={(e) => set('needs_payment', e.target.checked)} /> Pede pagamento</label>
          <label className="checkbox"><input type="checkbox" checked={f.needs_registration} onChange={(e) => set('needs_registration', e.target.checked)} /> Pede inscrição formal</label>
          <Field label="Material a levar (opcional)" htmlFor="cal-mat">
            <textarea id="cal-mat" rows={2} maxLength={2000} value={f.material} onChange={(e) => set('material', e.target.value)} />
          </Field>
        </fieldset>

        <fieldset className="cal-fieldset">
          <legend className="label">Lembretes</legend>
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

        <ErrorBox error={action.error} />
        <div className="btn-row">
          <button type="submit" className="btn" disabled={action.busy}>{event ? 'Guardar alterações' : 'Criar atividade'}</button>
          <button type="button" className="btn secondary" onClick={() => navigate(-1)}>Voltar sem guardar</button>
        </div>
      </form>
    </>
  );
}
