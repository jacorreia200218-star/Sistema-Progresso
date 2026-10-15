// Detalhe de uma atividade: dados, a minha resposta, «O que te falta», participantes
// (com pendências por pessoa para quem gere), anexos, exportação e gestão.
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, CalendarClock, Check, Download, FileText, Link2, MapPin, Package, Paperclip, Pencil, User, Users, Wallet } from 'lucide-react';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { useActiveSection } from '../../lib/session';
import { ConfirmButton, ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import { useModuleCtx } from '../ModuleShell';
import { downloadFile, formatEuros, formatLisbon } from '../common';
import { listModuleFiles, openModuleFile, uploadModuleFile } from '../files';
import { MISSING_LABEL, RESPONSE_LABEL, reminderLabel, whenLabel, type CalDetail, type CalParticipant, type PendingItem, type Response } from './cal';
import { buildIcs, icsFileName } from './ics';
import { MissingList, ResponseBadge, useParam } from './shared';

const FILTERS: [string, string][] = [['', 'Todos'], ['vou', 'Vou'], ['nao_vou', 'Não vou'], ['por_confirmar', 'Por confirmar'], ['sem', 'Sem resposta'], ['falta', 'Com pendências']];

export function EventDetail() {
  const { id = '' } = useParams();
  const section = useActiveSection().membership.section_id;
  const { space } = useModuleCtx();
  const location = useLocation();
  const q = useQuery({
    queryKey: ['cal-event', section, space, id],
    queryFn: () => call<CalDetail>('cal_event_get', { p_section: section, p_event: id }),
    retry: false,
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) {
    return (
      <>
        <PageTitle title="Atividade" back="/calendario" />
        <ErrorBox error={q.error ?? new Error('Registo não encontrado.')} retry={() => q.refetch()} />
      </>
    );
  }
  const e = q.data;
  const cancelled = e.status === 'cancelado';
  const flash = (location.state as { flash?: string } | null)?.flash;
  return (
    <>
      <PageTitle title={e.title} back="/calendario" />
      {flash && <Notice kind="success">{flash}</Notice>}
      {cancelled && (
        <Notice kind="warn">
          <strong>Atividade cancelada</strong>{e.cancelled_at && <> a {formatLisbon(e.cancelled_at)}</>}.{e.cancel_reason && <> Motivo: {e.cancel_reason}</>}
        </Notice>
      )}

      <section className="card cal-info" aria-label="Dados da atividade">
        <ul className="cal-facts">
          <li><CalendarClock size={18} aria-hidden="true" /><span>{whenLabel(e)}</span></li>
          {e.location && <li><MapPin size={18} aria-hidden="true" /><span>{e.location}</span></li>}
          <li><Users size={18} aria-hidden="true" /><span>{e.audience === 'equipa' ? `Equipa: ${e.team_name ?? '—'}` : 'Toda a secção'}</span></li>
          {e.responsible_name && <li><User size={18} aria-hidden="true" /><span>Responsável: {e.responsible_name}</span></li>}
          {e.registration_deadline && (
            <li className={e.deadline_passed ? 'is-late' : ''}><Bell size={18} aria-hidden="true" />
              <span>Prazo de inscrição: {formatLisbon(e.registration_deadline)}{e.deadline_passed && ' (terminou)'}</span></li>
          )}
        </ul>
        {e.description && <p className="prose cal-description">{e.description}</p>}
        {(e.required.length > 0) && (
          <div className="cal-requires">
            <span className="label">Pede-se a cada participante</span>
            <ul className="chips">{e.required.map((r) => <li key={r} className="chip">{MISSING_LABEL[r]}</li>)}</ul>
            {e.material && <p className="cal-material"><strong>Material:</strong> {e.material}</p>}
          </div>
        )}
        <div className="btn-row">
          <button type="button" className="btn secondary" onClick={() => downloadFile(icsFileName(e.title), buildIcs([e]), 'text/calendar;charset=utf-8')}>
            <Download size={16} aria-hidden="true" /> Adicionar ao meu calendário (.ics)
          </button>
          {e.can_manage && !cancelled && (
            <Link to={`/calendario/evento/${e.id}/editar`} className="btn secondary"><Pencil size={16} aria-hidden="true" /> Alterar</Link>
          )}
        </div>
      </section>

      {(e.involved || e.can_respond) && <MyResponse e={e} />}
      <Participants e={e} />
      <Linked e={e} />
      <Attachments e={e} />
      {e.can_manage && !cancelled && <ManageBox e={e} />}
    </>
  );
}

function MyResponse({ e }: { e: CalDetail }) {
  const section = useActiveSection().membership.section_id;
  const action = useAction();
  const [resp, setResp] = useState<Response | ''>(e.me.response ?? '');
  const [note, setNote] = useState(e.me.note ?? '');
  const [err, setErr] = useState<string | null>(null);
  const cancelled = e.status === 'cancelado';
  const save = async () => {
    if (!resp) { setErr('Escolhe «Vou», «Não vou» ou «Por confirmar».'); return; }
    setErr(null);
    await action.run(() => call('cal_respond', { p_section: section, p_event: e.id, p_response: resp, p_note: note.trim() || null }), 'Resposta guardada.');
  };
  return (
    <section className="card cal-me" aria-labelledby="cal-me-h">
      <h2 id="cal-me-h">A tua resposta</h2>
      {!cancelled && e.me.missing.length > 0 && <div className="cal-todo-inline"><MissingList missing={e.me.missing} label="O que te falta" /></div>}
      {!cancelled && e.involved && e.me.missing.length === 0 && e.me.response === 'vou' && (
        <p className="cal-ok"><Check size={16} aria-hidden="true" /> Está tudo tratado. Até lá!</p>
      )}
      {e.can_respond ? (
        <form onSubmit={(ev) => { ev.preventDefault(); void save(); }} noValidate>
          <fieldset className="segmented cal-answer" aria-describedby={err ? 'cal-resp-err' : undefined}>
            <legend className="sr-only">Vais participar?</legend>
            {(['vou', 'nao_vou', 'por_confirmar'] as Response[]).map((r) => (
              <label key={r} className="segment">
                <input type="radio" name="resposta" value={r} checked={resp === r} onChange={() => { setResp(r); setErr(null); }} /> {RESPONSE_LABEL[r]}
              </label>
            ))}
          </fieldset>
          {err && <p className="field-error" id="cal-resp-err" role="alert">{err}</p>}
          <Field label="Nota (opcional)" htmlFor="cal-note" hint="Por exemplo: chego mais tarde, alergias, boleia.">
            <textarea id="cal-note" rows={2} maxLength={500} value={note} onChange={(ev) => setNote(ev.target.value)} />
          </Field>
          <ErrorBox error={action.error} />
          {action.success && <Notice kind="success">{action.success}</Notice>}
          <div className="btn-row"><button type="submit" className="btn" disabled={action.busy}>Guardar resposta</button></div>
          {e.me.responded_at && <p className="faint">Última resposta: {formatLisbon(e.me.responded_at)}.</p>}
        </form>
      ) : (
        <>
          <p>Resposta: <ResponseBadge response={e.me.response} /></p>
          <p className="faint prose">
            {cancelled ? 'Esta atividade foi cancelada e já não aceita respostas.'
              : e.deadline_passed ? 'O prazo de inscrição terminou. Se precisas de mudar a resposta, fala com um dirigente.'
              : 'Esta atividade não é para a tua equipa.'}
          </p>
        </>
      )}
    </section>
  );
}

function Participants({ e }: { e: CalDetail }) {
  const [filter, setFilter] = useParam('p');
  const list = e.participants.filter((p) => {
    if (!filter) return true;
    if (filter === 'sem') return !p.response;
    if (filter === 'falta') return (p.missing ?? []).length > 0;
    return p.response === filter;
  });
  const count = (r: Response | null) => e.participants.filter((p) => p.response === r).length;
  return (
    <section className="card cal-people" aria-labelledby="cal-people-h">
      <h2 id="cal-people-h">Participantes</h2>
      <dl className="cal-counts">
        <div><dt>Vou</dt><dd>{count('vou')}</dd></div>
        <div><dt>Não vou</dt><dd>{count('nao_vou')}</dd></div>
        <div><dt>Por confirmar</dt><dd>{count('por_confirmar')}</dd></div>
        <div><dt>Sem resposta</dt><dd>{count(null)}</dd></div>
      </dl>
      <div className="tabs" role="tablist" aria-label="Filtrar participantes">
        {FILTERS.filter(([k]) => k !== 'falta' || e.can_see_pending).map(([k, label]) => (
          <button key={k} type="button" role="tab" className="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      {!e.can_see_pending && <p className="faint prose">Vês as respostas de todos; as pendências de cada pessoa só são visíveis para a própria, para quem gere o calendário e para o responsável.</p>}
      {list.length === 0 ? <p className="faint">Ninguém nesta lista.</p> : (
        <ul className="list cal-people-list">
          {list.map((p) => <ParticipantRow key={p.profile_id} e={e} p={p} />)}
        </ul>
      )}
    </section>
  );
}

function ParticipantRow({ e, p }: { e: CalDetail; p: CalParticipant }) {
  const section = useActiveSection().membership.section_id;
  const action = useAction();
  const cancelled = e.status === 'cancelado';
  const missing = p.missing ?? [];
  const toggle = (item: PendingItem, done: boolean) =>
    action.run(() => call('cal_set_pending', { p_section: section, p_event: e.id, p_profile: p.profile_id, p_item: item, p_done: done }),
      `${MISSING_LABEL[item]} de ${p.name}: ${done ? 'resolvida' : 'por resolver'}.`);
  const setResponse = (r: Response) =>
    action.run(() => call('cal_respond', { p_section: section, p_event: e.id, p_response: r, p_note: null, p_profile: p.profile_id }), `Resposta de ${p.name} guardada.`);
  return (
    <li className="cal-person">
      <div className="cal-person-head">
        <span className="grow">
          <span className="cal-person-name">{p.name}{p.is_me && ' (tu)'}</span>
          <span className="faint cal-person-meta">
            {[p.team_name, p.is_responsible ? 'responsável' : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        <ResponseBadge response={p.response} />
      </div>
      {p.note && <p className="cal-person-note">«{p.note}»</p>}
      {p.missing && !cancelled && <MissingList missing={missing} label="O que falta" />}
      {p.missing && !cancelled && p.response !== 'nao_vou' && missing.length === 0 && <p className="cal-ok"><Check size={14} aria-hidden="true" /> Tudo tratado</p>}
      {e.can_manage && !cancelled && (
        <div className="cal-person-actions">
          {e.required.length > 0 && p.response !== 'nao_vou' && (
            <div className="cal-toggles" role="group" aria-label={`Pendências de ${p.name}`}>
              {e.required.map((item) => {
                const done = !missing.includes(item);
                return (
                  <button key={item} type="button" className={`cal-toggle${done ? ' is-done' : ''}`} aria-pressed={done} disabled={action.busy}
                    onClick={() => void toggle(item, !done)}>
                    {done && <Check size={14} aria-hidden="true" />} {MISSING_LABEL[item]}
                  </button>
                );
              })}
            </div>
          )}
          <label className="inline-field cal-set-resp">
            <span className="faint">Resposta</span>
            <select value={p.response ?? ''} disabled={action.busy} aria-label={`Resposta de ${p.name}`}
              onChange={(ev) => ev.target.value && void setResponse(ev.target.value as Response)}>
              <option value="" disabled>—</option>
              {(['vou', 'nao_vou', 'por_confirmar'] as Response[]).map((r) => <option key={r} value={r}>{RESPONSE_LABEL[r]}</option>)}
            </select>
          </label>
        </div>
      )}
      <ErrorBox error={action.error} />
      {action.success && <p className="cal-saved" role="status">{action.success}</p>}
    </li>
  );
}

type Links = {
  reservas?: { id: string; item_id: string; item: string; unit: string; quantity: number; status: string }[];
  financas?: { orcamento: Totals; efetivo: Totals; por_confirmar: Totals } | null;
  reunioes?: { id: string; title: string; kind: string; starts_at: string }[];
};
type Totals = { receitas: number; despesas: number; resultado: number };

// Registos de outros módulos ligados a esta atividade (só os módulos a que a pessoa tem
// acesso, no mesmo espaço). Cada registo vive no seu módulo; aqui só se mostra a ligação.
function Linked({ e }: { e: CalDetail }) {
  const section = useActiveSection().membership.section_id;
  const { space } = useModuleCtx();
  const q = useQuery({
    queryKey: ['cal-links', section, space, e.id],
    queryFn: () => call<Links>('cal_event_links', { p_section: section, p_event: e.id }),
    retry: false,
  });
  const l = q.data;
  if (!l) return null;
  const hasRes = !!l.reservas?.length, hasMeet = !!l.reunioes?.length, hasFin = !!l.financas;
  if (!hasRes && !hasMeet && !hasFin) return null;
  return (
    <section className="card" aria-labelledby="cal-links-h">
      <h2 id="cal-links-h"><Link2 size={18} aria-hidden="true" /> Ligado a esta atividade</h2>
      {hasRes && (
        <>
          <h3 className="label"><Package size={16} aria-hidden="true" /> Material reservado</h3>
          <ul className="list">
            {l.reservas!.map((r) => (
              <li key={r.id}><Link className="list-item" to={`/inventario/artigo/${r.item_id}`}>
                <span className="grow ellipsis">{r.item}</span><span className="faint">{r.quantity} {r.unit}{r.status === 'concluida' ? ' · concluída' : ''}</span>
              </Link></li>
            ))}
          </ul>
        </>
      )}
      {hasFin && (
        <>
          <h3 className="label"><Wallet size={16} aria-hidden="true" /> Finanças</h3>
          <p className="faint">
            Orçamento: {formatEuros(l.financas!.orcamento.resultado)} · Efetivo: {formatEuros(l.financas!.efetivo.resultado)}
            {l.financas!.por_confirmar.resultado !== 0 && <> · Por confirmar: {formatEuros(l.financas!.por_confirmar.resultado)}</>}
            {' '}<Link to="/tesouraria/atividades">Ver na Tesouraria</Link>
          </p>
        </>
      )}
      {hasMeet && (
        <>
          <h3 className="label"><FileText size={16} aria-hidden="true" /> Reuniões</h3>
          <ul className="list">
            {l.reunioes!.map((m) => (
              <li key={m.id}><Link className="list-item" to={`/reunioes-e-tarefas/reunioes/${m.id}`}>
                <span className="grow ellipsis">{m.title}</span><span className="faint">{formatLisbon(m.starts_at)}</span>
              </Link></li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Attachments({ e }: { e: CalDetail }) {
  const section = useActiveSection().membership.section_id;
  const action = useAction();
  const input = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['cal-files', section, e.id], queryFn: () => listModuleFiles(section, 'calendario', 'cal_event', e.id) });
  const canUpload = e.can_manage && e.status === 'ativo';
  if (!canUpload && !q.data?.length) return null;
  return (
    <section className="card" aria-labelledby="cal-files-h">
      <h2 id="cal-files-h">Anexos</h2>
      {q.error ? <ErrorBox error={q.error} /> : q.data?.length ? (
        <ul className="list">
          {q.data.map((f) => (
            <li key={f.path}>
              <button type="button" className="list-item as-button" onClick={() => void action.run(() => openModuleFile(f.path))}>
                <FileText size={18} aria-hidden="true" /> <span className="grow ellipsis">{f.file_name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="faint">Sem anexos. Podes juntar o programa ou a autorização para imprimir (PDF ou imagem, até 10 MB).</p>}
      {canUpload && (
        <>
          <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" id="cal-file"
            onChange={(ev) => {
              const f = ev.target.files?.[0];
              ev.target.value = '';
              if (f) void action.run(() => uploadModuleFile(section, 'calendario', 'cal_event', e.id, f), 'Anexo guardado.');
            }} />
          <div className="btn-row"><label htmlFor="cal-file" className="btn secondary"><Paperclip size={16} aria-hidden="true" /> Juntar anexo</label></div>
        </>
      )}
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
    </section>
  );
}

function ManageBox({ e }: { e: CalDetail }) {
  const section = useActiveSection().membership.section_id;
  const action = useAction();
  const [reason, setReason] = useState('');
  useEffect(() => { action.clear(); }, [e.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="card danger-zone" aria-labelledby="cal-manage-h">
      <h2 id="cal-manage-h">Gestão</h2>
      <p className="faint prose">
        Lembretes antes da atividade: {e.reminder_minutes.length ? e.reminder_minutes.map(reminderLabel).join(', ') : 'nenhum'}.
        {e.registration_deadline && <> Antes do prazo: {e.deadline_reminder_minutes.length ? e.deadline_reminder_minutes.map(reminderLabel).join(', ') : 'nenhum'}.</>}
        {' '}Ao alterar ou cancelar, os envolvidos são avisados e os lembretes são reagendados ou retirados.
      </p>
      <Field label="Motivo do cancelamento (opcional)" htmlFor="cal-reason">
        <input id="cal-reason" maxLength={500} value={reason} onChange={(ev) => setReason(ev.target.value)} />
      </Field>
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      <ConfirmButton className="btn secondary danger" confirmLabel="Cancelar atividade" disabled={action.busy}
        description="A atividade fica marcada como cancelada (não é apagada), deixa de aceitar respostas e os envolvidos são avisados."
        onConfirm={() => void action.run(() => call('cal_cancel_event', { p_section: section, p_event: e.id, p_reason: reason.trim() || null }), 'Atividade cancelada. Os envolvidos foram avisados.')}>
        Cancelar atividade…
      </ConfirmButton>
    </section>
  );
}
