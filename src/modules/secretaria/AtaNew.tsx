// Nova ata: escolher o evento do calendário, escrever o texto e guardar.
// O título e a data vêm do evento; sem evento, cria-se um no calendário aqui mesmo.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { ErrorBox, Field, Loading, MoreOptions, PageTitle } from '../../components/ui';
import { DateInput, TimeInput } from '../../components/DateInput';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { MEETING_DEFAULT, nextSaturday, todayLisbon } from '../common';
import { BASE, eventLabel, useSectionId, type AtaEvent } from './api';

/** Sábado mais recente (o próprio dia, se for sábado): a ata costuma ser da última reunião. */
function lastSaturday() {
  const today = todayLisbon();
  const next = nextSaturday(today);
  if (next === today) return today;
  const d = new Date(`${next}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

function NewEvent({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const section = useSectionId();
  const action = useAction();
  const [title, setTitle] = useState<string>(MEETING_DEFAULT.title);
  const [day, setDay] = useState(lastSaturday);
  const [start, setStart] = useState<string>(MEETING_DEFAULT.start);
  const [end, setEnd] = useState<string>(MEETING_DEFAULT.end);

  async function create() {
    const r = await action.run(() => call<string>('ata_event_create', {
      p_section: section, p_title: title, p_day: day || null, p_start: start || null, p_end: end || null,
    }));
    if (r.ok && r.value) onCreated(r.value);
  }

  return (
    <div className="sec-item-form" role="group" aria-label="Criar no calendário">
      <div className="sec-grid">
        <Field label="Nome do evento" htmlFor="ata-ev-title">
          <input id="ata-ev-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Data" htmlFor="ata-ev-day">
          <DateInput id="ata-ev-day" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
      </div>
      <MoreOptions>
        <div className="sec-grid">
          <Field label="Início" htmlFor="ata-ev-start"><TimeInput id="ata-ev-start" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Fim" htmlFor="ata-ev-end"><TimeInput id="ata-ev-end" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
      </MoreOptions>
      <ErrorBox error={action.error} />
      <div className="btn-row">
        <button type="button" className="btn" disabled={action.busy} onClick={create}>{action.busy ? 'A criar…' : 'Criar evento'}</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

export function AtaNew() {
  const section = useSectionId();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const action = useAction();
  const events = useQuery({ queryKey: ['ata-events', section], queryFn: () => call<AtaEvent[]>('ata_events', { p_section: section }) });
  const [event, setEvent] = useState(params.get('evento') ?? '');
  const [body, setBody] = useState('');
  const [reserved, setReserved] = useState(false);
  const [creating, setCreating] = useState(false);
  const [errors, setErrors] = useState<{ event?: string; body?: string }>({});

  const list = events.data ?? [];
  const chosen = list.find((e) => e.id === event) ?? null;
  // Um evento pedido no endereço que já não está na lista (antigo ou cancelado) não fica escolhido.
  useEffect(() => { if (events.data && event && !chosen) setEvent(''); }, [events.data]);
  // Sem eventos, abre logo «Criar no calendário».
  useEffect(() => { if (events.data && events.data.length === 0) setCreating(true); }, [events.data]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const err = { event: event ? undefined : 'Escolhe o evento.', body: body.trim() ? undefined : 'Escreve o texto da ata.' };
    setErrors(err);
    if (err.event || err.body) return;
    const r = await action.run(() => call<string>('ata_save', {
      p_section: section, p_ata: null, p_event: event, p_body: body, p_scope: reserved ? 'dirigentes' : 'evento', p_expected_version: null,
    }));
    if (r.ok && r.value) navigate(`${BASE}/atas/${r.value}`, { replace: true });
  }

  return (
    <>
      <PageTitle title="Nova ata" back={BASE} />
      {events.isLoading && <Loading />}
      <ErrorBox error={events.error} retry={() => events.refetch()} />
      {events.data && (
        <form className="card sec-form" onSubmit={submit} noValidate>
          <Field label="Evento" htmlFor="ata-event">
            <select id="ata-event" value={event} onChange={(e) => setEvent(e.target.value)} aria-invalid={!!errors.event}>
              <option value="">Escolhe o evento do calendário</option>
              {list.map((ev) => <option key={ev.id} value={ev.id}>{eventLabel(ev)}{ev.ata_id ? ' (já tem ata)' : ''}</option>)}
            </select>
            {errors.event && <span className="sec-error">{errors.event}</span>}
            {chosen?.ata_id && (
              <span className="sec-meta">Este evento já tem ata. <Link to={`${BASE}/atas/${chosen.ata_id}`}>Abrir a ata</Link></span>
            )}
          </Field>
          {creating ? (
            <NewEvent onCancel={() => setCreating(false)} onCreated={async (id) => {
              await events.refetch();
              setEvent(id);
              setCreating(false);
            }} />
          ) : (
            <button type="button" className="btn ghost sec-add" onClick={() => setCreating(true)}>
              <CalendarPlus size={16} aria-hidden="true" /> Criar no calendário
            </button>
          )}
          <Field label="Ata" htmlFor="ata-body">
            <textarea id="ata-body" rows={12} value={body} onChange={(e) => setBody(e.target.value)} maxLength={50000} aria-invalid={!!errors.body} />
            {errors.body && <span className="sec-error">{errors.body}</span>}
          </Field>
          <MoreOptions>
            <label className="check-row">
              <input type="checkbox" checked={reserved} onChange={(e) => setReserved(e.target.checked)} /> Reservada aos dirigentes
            </label>
          </MoreOptions>
          <ErrorBox error={action.error} />
          <div className="btn-row">
            <button type="submit" className="btn" disabled={action.busy || !!chosen?.ata_id}>{action.busy ? 'A guardar…' : 'Guardar'}</button>
            <button type="button" className="btn secondary" onClick={() => navigate(BASE)}>Cancelar</button>
          </div>
        </form>
      )}
    </>
  );
}
