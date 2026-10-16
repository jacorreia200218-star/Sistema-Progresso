// Reunião: dados (com assuntos e participantes), ata e sumário, decisões e tarefas, anexos.
// Alterar, anexar e anular escolhem-se no menu «Mais»; o formulário de anular só abre aí.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Ban, CalendarDays, FileText, Flag, ListChecks, MapPin, Paperclip, Pencil, Users } from 'lucide-react';
import { Badge, ErrorBox, Field, Loading, MoreMenu, Notice, PageTitle } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { formatLisbon } from '../common';
import { Attachments, pickAttachment } from './Attachments';
import { TaskFacts } from './Items';
import { BASE, EXEC_STATUS, ITEM_KIND, KIND_AUDIENCE, KIND_LABEL, MINUTE_STATUS, docLabel, useMeeting, useSectionId } from './api';

export function MeetingPage() {
  const { id } = useParams();
  const section = useSectionId();
  const navigate = useNavigate();
  const q = useMeeting(id);
  const action = useAction();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [cancelling, setCancelling] = useState(false);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return (<><PageTitle title="Reunião" back={BASE} /><ErrorBox error={q.error ?? 'Registo não encontrado.'} /></>);
  const d = q.data;
  const m = d.meeting;
  const ata = d.minutes.find((x) => x.kind === 'ata');
  const addenda = d.minutes.filter((x) => x.kind === 'aditamento');
  const active = m.status === 'ativa';

  const createAta = async () => {
    const r = await action.run(() => call<string>('sec_minute_create', { p_section: section, p_meeting: m.id, p_kind: 'ata', p_body: '' }));
    if (r.ok) navigate(`${BASE}/atas/${r.value}`);
  };
  const cancel = async () => {
    if (!reason.trim()) { setReasonError('Indica o motivo.'); return; }
    setReasonError('');
    await action.run(() => call('sec_meeting_cancel', { p_section: section, p_meeting: m.id, p_reason: reason.trim() }), 'Reunião anulada.');
  };

  const canEdit = d.can_draft && active;
  const canCancel = canEdit && !d.minutes.some((x) => x.approved_version);
  const summaryText = d.summary
    ? d.summary.status === 'publicado' ? `Versão ${d.summary.published_version} publicada`
      : d.summary.published_version ? `Nova versão em revisão · em vigor: versão ${d.summary.published_version}` : 'Em revisão, ainda não publicado'
    : '';

  return (
    <>
      <PageTitle title={m.title} back={BASE}
        actions={canEdit && (
          <MoreMenu>
            <Link className="btn" to={`${BASE}/reunioes/${m.id}/editar`}><Pencil size={16} aria-hidden="true" /> Alterar reunião</Link>
            <button type="button" className="btn" onClick={() => pickAttachment(m.id)}><Paperclip size={16} aria-hidden="true" /> Anexar ficheiro</button>
            {canCancel && <hr />}
            {canCancel && <button type="button" className="btn danger" onClick={() => setCancelling(true)}><Ban size={16} aria-hidden="true" /> Anular reunião</button>}
          </MoreMenu>
        )} />
      {!active && <Notice kind="warn">Reunião anulada{m.cancel_reason ? `: ${m.cancel_reason}` : '.'} Os registos mantêm-se para consulta.</Notice>}
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}

      {cancelling && canCancel && (
        <section className="card" aria-label="Anular reunião">
          <h2 className="sec-h2">Anular reunião</h2>
          <p className="faint sec-meta sec-form-note">Anular não apaga nada: a reunião e os registos ficam para consulta, e os lembretes das tarefas são cancelados.</p>
          <Field label="Motivo" htmlFor="sec-cancel">
            <input id="sec-cancel" type="text" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!reasonError} />
            {reasonError && <span className="sec-error">{reasonError}</span>}
          </Field>
          <div className="btn-row">
            <button type="button" className="btn" disabled={action.busy} onClick={cancel}>Anular reunião</button>
            <button type="button" className="btn secondary" onClick={() => { setCancelling(false); setReasonError(''); }}>Cancelar</button>
          </div>
        </section>
      )}

      <section className="card" aria-label="Dados da reunião">
        <p className="sec-facts-line sec-facts-main">
          <span><CalendarDays size={15} aria-hidden="true" /> {formatLisbon(m.starts_at)}</span>
          {m.location && <span><MapPin size={15} aria-hidden="true" /> {m.location}</span>}
          {m.cal_event && <span><Flag size={15} aria-hidden="true" /> Atividade: {m.cal_event.title}{m.cal_event.status === 'cancelado' ? ' (cancelada)' : ''}</span>}
        </p>
        <p className="faint sec-meta">{KIND_LABEL[m.kind]}{m.team_name ? ` · ${m.team_name}` : ''}</p>
        <p className="faint sec-meta">{KIND_AUDIENCE[m.kind]}</p>
        <div className="sec-grid sec-sub">
          <div>
            <h2 className="sec-h3" id="sec-agenda-h">Assuntos (ordem de trabalhos)</h2>
            {m.agenda.trim() ? <p className="sec-pre">{m.agenda}</p> : <p className="faint">Sem assuntos indicados.</p>}
          </div>
          <div>
            <h2 className="sec-h3" id="sec-part-h"><Users size={15} aria-hidden="true" /> Participantes</h2>
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
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="sec-ata-h">
        <h2 className="sec-h2" id="sec-ata-h"><FileText size={16} aria-hidden="true" /> Ata e sumário</h2>
        {ata ? (
          <ul className="list">
            {[ata, ...addenda].map((x) => (
              <li key={x.id}>
                <Link to={`${BASE}/atas/${x.id}`} className="list-item">
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
            {d.summary ? (
              <li>
                <Link to={`${BASE}/reunioes/${m.id}/sumario`} className="list-item">
                  <div className="grow">
                    <div className="sec-row-title">Sumário</div>
                    <div className="faint sec-meta">{summaryText}</div>
                  </div>
                  {d.summary.status === 'publicado' ? <Badge label="Publicado" tone="ok" icon="check" /> : <Badge label="Em revisão" tone="attention" icon="pencil" />}
                </Link>
              </li>
            ) : (
              <li className="list-item">
                <div className="grow">
                  <div className="sec-row-title">Sumário</div>
                  <div className="faint sec-meta">Decisões, próximas tarefas e preparativos, a partir da ata.</div>
                </div>
                {d.can_manage && active ? <Link className="btn secondary sec-small" to={`${BASE}/reunioes/${m.id}/sumario`}>Preparar sumário</Link>
                  : <Badge label="Sem sumário" tone="muted" />}
              </li>
            )}
          </ul>
        ) : (
          <>
            <p className="faint">Ainda não há ata desta reunião.</p>
            {canEdit && (
              <div className="btn-row"><button type="button" className="btn" disabled={action.busy} onClick={createAta}>Criar ata</button></div>
            )}
          </>
        )}
      </section>

      {d.items.length > 0 && (
        <section className="card" aria-labelledby="sec-dec-h">
          <h2 className="sec-h2" id="sec-dec-h"><ListChecks size={16} aria-hidden="true" /> Decisões, tarefas e preparativos</h2>
          <ul className="list sec-items">
            {d.items.map((i) => (
              <li key={i.id} className={`sec-item${i.overdue ? ' is-overdue' : ''}`}>
                <div className="grow">
                  <p className="sec-item-text"><span className="sec-kind">{ITEM_KIND[i.kind]}</span>{' '}
                    {i.kind === 'decisao' ? i.text : <Link to={`${BASE}/tarefas/${i.id}`}>{i.text}</Link>}</p>
                  {i.kind !== 'decisao' && <TaskFacts responsible={i.responsible_name} team={i.team_name} due={i.due_date} event={i.cal_event} overdue={i.overdue} />}
                  {i.link_label && <p className="faint sec-meta">{i.link_label}</p>}
                </div>
                {i.kind !== 'decisao' && <Badge {...EXEC_STATUS[i.exec_status]} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Attachments entity="sec_meeting" entityId={m.id} canWrite={canEdit} />
    </>
  );
}
