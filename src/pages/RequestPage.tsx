import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useActiveSection } from '../lib/session';
import { call, fetchRequest, type RequestDetail } from '../lib/api';
import { useAction } from '../lib/useAction';
import { decisionLabel, formatDate, formatDateTime, requestKindLabel, requestStatusLabel, todayIso } from '../lib/labels';
import type { RequestVersion } from '../lib/types';
import { Avatar, Badge, ConfirmButton, ErrorBox, Field, Loading, Notice, PageTitle } from '../components/ui';
import NotFound from './NotFound';
import { OwnerRequestPanel, VersionContent } from '../components/RequestEditor';

export default function RequestPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['request', id], queryFn: () => fetchRequest(id!), enabled: !!id });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  if (!q.data) return <NotFound />;
  return <RequestView detail={q.data} />;
}

function RequestView({ detail }: { detail: RequestDetail }) {
  const s = useActiveSection();
  const { request, versions, decisions, attachments, member } = detail;
  const trail = s.catalog.trailById.get(request.trail_id);
  const isOwner = request.membership_id === s.membership.id;
  const current = versions.find((v) => v.version_no === request.current_version)!;
  const st = requestStatusLabel[request.status];
  const historic = request.kind === 'historico';

  return (
    <>
      <PageTitle
        title={trail?.name ?? 'Pedido'}
        subtitle={request.kind === 'negociacao' ? 'Trilho reconhecido na negociação' : historic ? 'Pedido de progresso anterior' : 'Pedido de validação de trilho'}
        back={isOwner ? '/meu-progresso?vista=pedidos' : true}
      />
      <div className="row" style={{ marginBottom: 12 }}>
        <Badge {...st} />
        {requestKindLabel[request.kind] && <Badge label={requestKindLabel[request.kind]} tone="neutral" icon="clock" />}
        {request.kind !== 'negociacao' && <span className="faint">Versão {request.current_version}</span>}
      </div>
      {!isOwner && member && (
        <div className="card flat row">
          <Avatar name={member.profiles?.full_name ?? '?'} photoPath={member.profiles?.photo_path} />
          <div className="grow">
            <strong>{member.profiles?.full_name}</strong>
            {member.profiles?.totem && <span className="faint"> · {member.profiles.totem}</span>}
          </div>
          {s.isDirigente && <Link to={`/membros/${member.id}`} className="btn ghost">Percurso</Link>}
        </div>
      )}

      {isOwner && <OwnerRequestPanel detail={detail} current={current} />}
      {!isOwner && <ReviewerPanel detail={detail} current={current} />}

      {request.kind === 'negociacao' && (
        <Notice kind="info">
          <p className="prose">A Equipa de Animação reconheceu, na negociação, que este trilho já tinha sido alcançado (Manual do Dirigente, p. 10). A fundamentação está no histórico.</p>
        </Notice>
      )}
      {request.kind !== 'negociacao' && (!isOwner || request.status !== 'rascunho') && <VersionContent version={current} attachments={attachments.filter((a) => a.version_id === current.id)} historic={historic} />}

      <h2 className="section-title">Histórico</h2>
      <div className="card">
        <ol className="timeline">
          {versions.map((v) => (
            <li key={v.id}>
              <strong>Versão {v.version_no}</strong>{' '}
              <span className="faint">
                {v.submitted_at ? `· Submetida em ${formatDateTime(v.submitted_at)}` : '· Rascunho'}
                {v.withdrawn_at ? ` · Retirada em ${formatDateTime(v.withdrawn_at)}` : ''}
              </span>
              {v.version_no !== request.current_version && v.submitted_at && (
                <details>
                  <summary className="faint">Ver conteúdo desta versão</summary>
                  <VersionContent version={v} attachments={attachments.filter((a) => a.version_id === v.id)} historic={historic} compact />
                </details>
              )}
              {decisions
                .filter((d) => d.version_id === v.id)
                .map((d) => (
                  <div key={d.id} style={{ marginTop: 6 }}>
                    <strong>{decisionLabel[d.kind]}</strong>
                    <div className="faint">
                      Registado por {detail.recorders[d.recorded_by] ?? (d.recorded_as === 'guia' ? 'guia' : 'dirigente')} ({d.recorded_as === 'guia' ? 'guia' : 'Equipa de Animação'}) em {formatDateTime(d.recorded_at)}
                      {d.meeting_date && ` · reunião de ${formatDate(d.meeting_date)}`}
                      {d.reference_date && ` · referência temporal: ${formatDate(d.reference_date)}`}
                    </div>
                    {d.comment && <div className="quote">{d.comment}</div>}
                  </div>
                ))}
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

function ReviewerPanel({ detail, current }: { detail: RequestDetail; current: RequestVersion }) {
  const s = useActiveSection();
  const { request, member } = detail;
  const action = useAction();
  const [outcome, setOutcome] = useState<'validado' | 'devolvido' | 'aprovado' | 'recusado'>(request.kind === 'historico' ? 'aprovado' : 'validado');
  const [meeting, setMeeting] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [refDate, setRefDate] = useState('');
  const [note, setNote] = useState('');
  const open = request.status === 'submetido' || request.status === 'em_revisao';
  const isTeamGuia = s.isGuia && member?.team_id === s.membership.team_id;
  const canTeam = request.kind === 'normal' && open && (s.isDirigente || isTeamGuia);
  const canHistoric = request.kind === 'historico' && open && s.isDirigente;
  const commentRequired = outcome !== 'validado' && outcome !== 'aprovado';

  if (!canTeam && !canHistoric && !s.isDirigente) {
    return request.status === 'rascunho' ? <Notice kind="info">Este pedido ainda está em rascunho.</Notice> : null;
  }

  return (
    <>
      {canTeam && (
        <section className="card">
          <h2>Registo da reunião de Equipa</h2>
          <Notice kind="info">
            <p className="prose">
              Regista aqui a decisão tomada <strong>em reunião de Equipa</strong>. Este registo não substitui a reunião.
              {s.isDirigente && !isTeamGuia ? ' (Registo pela Equipa de Animação — ex.: pedido do próprio guia.)' : ''}
            </p>
          </Notice>
          <ErrorBox error={action.error} />
          {action.success && <Notice kind="success">{action.success}</Notice>}
          {request.status === 'submetido' && (
            <button type="button" className="btn secondary" disabled={action.busy}
              onClick={() => action.run(() => call('mark_request_in_review', { p_request: request.id }), 'Pedido marcado como em revisão.')}>
              Marcar como em revisão
            </button>
          )}
          <fieldset style={{ marginTop: 12 }}>
            <legend>Decisão da Equipa</legend>
            <div className="radio-cards">
              <label className="radio-card">
                <input type="radio" name="outcome" checked={outcome === 'validado'} onChange={() => setOutcome('validado')} />
                <span><strong>Validado na equipa</strong><br /><span className="faint">O trilho foi alcançado.</span></span>
              </label>
              <label className="radio-card">
                <input type="radio" name="outcome" checked={outcome === 'devolvido'} onChange={() => setOutcome('devolvido')} />
                <span><strong>Continuar a trabalhar</strong><br /><span className="faint">Devolver com comentário.</span></span>
              </label>
            </div>
          </fieldset>
          <Field label="Data da reunião de Equipa" htmlFor="meeting">
            <input id="meeting" type="date" value={meeting} max={todayIso()} onChange={(e) => setMeeting(e.target.value)} required />
          </Field>
          <Field label={commentRequired ? 'Comentário (obrigatório)' : 'Comentário (opcional)'} htmlFor="comment">
            <textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <ConfirmButton
            className="btn"
            confirmLabel="Registar decisão"
            disabled={action.busy || !meeting || (commentRequired && !comment.trim())}
            description="A decisão é comunicada ao pioneiro e ao Conselho de Guias."
            onConfirm={() =>
              action.run(() => call('record_team_decision', {
                p_request: request.id, p_expected_version: current.version_no, p_validated: outcome === 'validado', p_meeting_date: meeting, p_comment: comment,
              }), 'Decisão registada.')
            }
          >
            Registar decisão
          </ConfirmButton>
        </section>
      )}

      {canHistoric && (
        <section className="card">
          <h2>Decisão sobre progresso anterior</h2>
          <ErrorBox error={action.error} />
          {action.success && <Notice kind="success">{action.success}</Notice>}
          <fieldset>
            <legend>Decisão</legend>
            <div className="radio-cards">
              {([
                ['aprovado', 'Reconhecer', 'O trilho passa a contar como concluído.'],
                ['devolvido', 'Devolver para correção', 'O pioneiro pode corrigir e voltar a submeter (se a opção estiver ativa).'],
                ['recusado', 'Não reconhecer', 'Pode seguir pelo progresso normal.'],
              ] as const).map(([v, t, d]) => (
                <label key={v} className="radio-card">
                  <input type="radio" name="hist" checked={outcome === v} onChange={() => setOutcome(v as typeof outcome)} />
                  <span><strong>{t}</strong><br /><span className="faint">{d}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          {outcome === 'aprovado' && (
            <Field label="Referência temporal (opcional)" htmlFor="ref" hint={`Indicado pelo pioneiro: «${current.approximate_date || 'não indicado'}». A data de hoje fica registada como data da decisão.`}>
              <input id="ref" type="date" aria-describedby="ref-hint" value={refDate} max={todayIso()} onChange={(e) => setRefDate(e.target.value)} />
            </Field>
          )}
          <Field label={commentRequired ? 'Comentário (obrigatório)' : 'Comentário (opcional)'} htmlFor="hcomment">
            <textarea id="hcomment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <ConfirmButton className="btn" confirmLabel="Registar decisão" disabled={action.busy || (commentRequired && !comment.trim())}
            onConfirm={() =>
              action.run(() => call('decide_historical_request', {
                p_request: request.id, p_expected_version: current.version_no, p_outcome: outcome, p_comment: comment, p_reference_date: refDate || null,
              }), 'Decisão registada.')
            }>
            Registar decisão
          </ConfirmButton>
        </section>
      )}

      {s.isDirigente && request.status === 'validado_equipa' && (
        <section className="card flat">
          <h3>Devolução fundamentada (Conselho de Guias)</h3>
          <p className="faint prose">Usa apenas se o Conselho de Guias verificar que a validação foi manifestamente incoerente com a atitude demonstrada.</p>
          <CouncilReturn requestId={request.id} />
        </section>
      )}

      {s.isDirigente && request.status !== 'rascunho' && request.status !== 'cancelado' && (
        <section className="card flat">
          <h3>Nota de revisão da Equipa de Animação</h3>
          <p className="faint">Opcional. Não altera o estado do pedido.</p>
          <Field label="Nota" htmlFor="note">
            <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <button type="button" className="btn secondary" disabled={action.busy || !note.trim()}
            onClick={async () => {
              const r = await action.run(() => call('record_animation_review', { p_request: request.id, p_comment: note }), 'Nota registada.');
              if (r.ok) setNote('');
            }}>
            Registar nota
          </button>
        </section>
      )}
    </>
  );
}

function CouncilReturn({ requestId }: { requestId: string }) {
  const action = useAction();
  const [date, setDate] = useState(todayIso());
  const [comment, setComment] = useState('');
  return (
    <>
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      <Field label="Data do Conselho de Guias" htmlFor="cgdate">
        <input id="cgdate" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Fundamentação (obrigatória)" htmlFor="cgc">
        <textarea id="cgc" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <ConfirmButton confirmLabel="Devolver trilho" disabled={action.busy || !comment.trim()} description="O trilho deixa de contar como validado até nova validação na Equipa."
        onConfirm={() => action.run(() => call('record_council_return', { p_request: requestId, p_meeting_date: date, p_comment: comment }), 'Devolução registada.')}>
        Registar devolução
      </ConfirmButton>
    </>
  );
}
