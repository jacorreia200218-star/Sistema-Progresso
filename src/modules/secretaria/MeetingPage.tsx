// Reunião: dados, ordem de trabalhos, participantes, ata e aditamentos, decisões e anexos.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, FileText, MapPin, Pencil, Users } from 'lucide-react';
import { Badge, ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { formatDay, formatLisbon } from '../common';
import { Attachments } from './Attachments';
import { EXEC_STATUS, KIND_AUDIENCE, KIND_LABEL, MINUTE_STATUS, docLabel, useMeeting, useSectionId } from './api';

export function MeetingPage() {
  const { id } = useParams();
  const section = useSectionId();
  const navigate = useNavigate();
  const q = useMeeting(id);
  const action = useAction();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return (<><PageTitle title="Reunião" back="/secretaria" /><ErrorBox error={q.error ?? 'Registo não encontrado.'} /></>);
  const d = q.data;
  const m = d.meeting;
  const ata = d.minutes.find((x) => x.kind === 'ata');
  const addenda = d.minutes.filter((x) => x.kind === 'aditamento');
  const active = m.status === 'ativa';

  const createAta = async () => {
    const r = await action.run(() => call<string>('sec_minute_create', { p_section: section, p_meeting: m.id, p_kind: 'ata', p_body: '' }));
    if (r.ok) navigate(`/secretaria/atas/${r.value}`);
  };
  const cancel = async () => {
    if (!reason.trim()) { setReasonError('Indica o motivo.'); return; }
    setReasonError('');
    await action.run(() => call('sec_meeting_cancel', { p_section: section, p_meeting: m.id, p_reason: reason.trim() }), 'Reunião anulada.');
  };

  return (
    <>
      <PageTitle title={m.title} back="/secretaria" subtitle={<>{KIND_LABEL[m.kind]}{m.team_name ? ` · ${m.team_name}` : ''}</>} />
      {!active && <Notice kind="warn">Reunião anulada{m.cancel_reason ? `: ${m.cancel_reason}` : '.'} Os registos mantêm-se para consulta.</Notice>}
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}

      <section className="card sec-facts" aria-label="Dados da reunião">
        <p><CalendarDays size={16} aria-hidden="true" /> {formatLisbon(m.starts_at)}</p>
        {m.location && <p><MapPin size={16} aria-hidden="true" /> {m.location}</p>}
        {m.cal_event && <p><CalendarDays size={16} aria-hidden="true" /> Atividade: {m.cal_event.title}{m.cal_event.status === 'cancelado' ? ' (cancelada)' : ''}</p>}
        <p className="faint sec-meta">{KIND_AUDIENCE[m.kind]}</p>
        {d.can_draft && active && (
          <div className="btn-row">
            <Link className="btn secondary" to={`/secretaria/reunioes/${m.id}/editar`}><Pencil size={16} aria-hidden="true" /> Alterar reunião</Link>
          </div>
        )}
      </section>

      <div className="sec-grid">
        <section className="card" aria-labelledby="sec-agenda-h">
          <h2 className="sec-h2" id="sec-agenda-h">Ordem de trabalhos</h2>
          {m.agenda.trim() ? <p className="sec-pre">{m.agenda}</p> : <p className="faint">Sem ordem de trabalhos.</p>}
        </section>
        <section className="card" aria-labelledby="sec-part-h">
          <h2 className="sec-h2" id="sec-part-h"><Users size={16} aria-hidden="true" /> Participantes</h2>
          {d.participants.length ? (
            <ul className="chip-list sec-chips">{d.participants.map((p) => <li key={p.id} className="chip">{p.name}</li>)}</ul>
          ) : <p className="faint">Sem participantes indicados.</p>}
          {m.kind === 'geral' && (
            <>
              <h3 className="sec-h3">Partilhado com</h3>
              {d.shares.length ? <ul className="chip-list sec-chips">{d.shares.map((s) => <li key={s.profile_id ?? s.team_id} className="chip">{s.name}</li>)}</ul>
                : <p className="faint">Ainda não foi partilhado com ninguém.</p>}
            </>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="sec-ata-h">
        <h2 className="sec-h2" id="sec-ata-h"><FileText size={16} aria-hidden="true" /> Ata</h2>
        {ata ? (
          <ul className="list">
            {[ata, ...addenda].map((x) => (
              <li key={x.id}>
                <Link to={`/secretaria/atas/${x.id}`} className="list-item">
                  <div className="grow">
                    <div className="sec-row-title">{docLabel(x.kind)}</div>
                    <div className="faint sec-meta">
                      Versão {x.current_version}{x.approved_version && x.approved_version !== x.current_version ? ` · aprovada: versão ${x.approved_version}` : ''}
                    </div>
                  </div>
                  <Badge {...MINUTE_STATUS[x.status]} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="faint">Ainda não há ata desta reunião.</p>
            {d.can_draft && active && (
              <div className="btn-row"><button type="button" className="btn" disabled={action.busy} onClick={createAta}>Criar ata</button></div>
            )}
          </>
        )}
      </section>

      {d.items.length > 0 && (
        <section className="card" aria-labelledby="sec-dec-h">
          <h2 className="sec-h2" id="sec-dec-h">Decisões e tarefas</h2>
          <ul className="list sec-items">
            {d.items.map((i) => (
              <li key={i.id} className="sec-item">
                <div className="grow">
                  <p className="sec-item-text"><span className="sec-kind">{i.kind === 'tarefa' ? 'Tarefa' : 'Decisão'}</span> {i.text}</p>
                  <p className="faint sec-meta">{i.responsible_name ?? 'Sem responsável'}{i.due_date && ` · prazo ${formatDay(i.due_date)}`}{i.link_label && ` · ${i.link_label}`}</p>
                </div>
                {i.kind === 'tarefa' && <Badge {...EXEC_STATUS[i.exec_status]} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Attachments entity="sec_meeting" entityId={m.id} canWrite={d.can_draft && active} />

      {d.can_draft && active && !d.minutes.some((x) => x.approved_version) && (
        <details className="card sec-danger">
          <summary>Anular reunião</summary>
          <p className="prose faint">Anular não apaga nada: a reunião e os registos ficam para consulta, e os lembretes das tarefas são cancelados.</p>
          <Field label="Motivo" htmlFor="sec-cancel">
            <input id="sec-cancel" type="text" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!reasonError} />
            {reasonError && <span className="sec-error">{reasonError}</span>}
          </Field>
          <button type="button" className="btn secondary" disabled={action.busy} onClick={cancel}>Anular reunião</button>
        </details>
      )}
    </>
  );
}
