// Detalhe de um pedido de validação de trilho (próprio ou de quem acompanha):
// pioneiro e equipa, área, trilho e etapa associada, todos os objetivos do
// trilho, justificação integral, anexos, datas e decisões anteriores. A decisão
// formal é sobre o trilho completo: validar, ou devolver para revisão com
// fundamentação (que pode indicar objetivos ainda por demonstrar).
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useActiveSection } from '../lib/session';
import { useProgress, useTeams } from '../lib/hooks';
import { call, fetchRequest, type RequestDetail } from '../lib/api';
import { useAction } from '../lib/useAction';
import { flaggedObjectives } from '../lib/meuprogresso';
import { decisionLabel, formatDate, formatDateTime, requestKindLabel, requestStatusLabel, stageRequestLabel, todayIso } from '../lib/labels';
import type { Catalog, MemberProgress, RequestVersion, TrailRequest } from '../lib/types';
import { Avatar, Badge, ConfirmButton, ErrorBox, Field, Loading, Notice, PageTitle } from '../components/ui';
import NotFound from './NotFound';
import { OwnerRequestPanel, VersionContent } from '../components/RequestEditor';
import { TrailObjectives } from '../components/meu/PedidoTrilho';
import { stageName } from '../components/StagePanel';

export default function RequestPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['request', id], queryFn: () => fetchRequest(id!), enabled: !!id });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  if (!q.data) return <NotFound />;
  return <RequestView detail={q.data} />;
}

/** Etapa a que o trilho está associado (escolha confirmada ou proposta), com o pedido de validação da etapa. */
function stageInfo(catalog: Catalog, p: MemberProgress | undefined, request: TrailRequest) {
  const choice = p?.choices.find((c) => c.trail_key === request.trail_key && (c.status === 'confirmada' || c.status === 'proposta'));
  if (!choice || !p) return null;
  const path = p.paths.find((x) => x.id === choice.stage_path_id);
  const sr = p.stageRequests.filter((x) => x.stage_path_id === choice.stage_path_id).sort((a, b) => b.requested_at.localeCompare(a.requested_at))[0];
  return { name: stageName(catalog, path?.stage_key ?? ''), confirmed: choice.status === 'confirmada', path, sr };
}

/** Processo pedagógico: validação do trilho, comunicação, etapa, opinião final e reconhecimento. */
function ProcessSteps({ request, stage }: { request: TrailRequest; stage: ReturnType<typeof stageInfo> }) {
  const trailDone = request.status === 'validado_equipa' || request.status === 'aprovado';
  const steps = [
    { label: 'Validação do trilho na reunião de Equipa', state: trailDone ? 'feito' : request.status === 'devolvido' ? 'rever' : 'atual' },
    { label: 'Comunicação ao Conselho de Guias', state: trailDone ? 'feito' : 'por_fazer' },
    { label: 'Validação da etapa no Conselho de Guias', state: stage?.sr?.council_decision ? 'feito' : stage?.sr?.status === 'submetido' ? 'atual' : 'por_fazer' },
    { label: 'Opinião final da Equipa de Animação', state: stage?.sr?.final_opinion ? 'feito' : stage?.sr?.status === 'decidido_conselho' ? 'atual' : 'por_fazer' },
    { label: 'Reconhecimento público', state: stage?.path?.recognized_on ? 'feito' : 'por_fazer' },
  ];
  return (
    <ol className="process" aria-label="Processo de validação">
      {steps.map((s) => (
        <li key={s.label} className={`process-step ps-${s.state}`}>
          <span className="ps-dot" aria-hidden="true" />
          <span>{s.label}<span className="sr-only"> · {s.state === 'feito' ? 'feito' : s.state === 'atual' ? 'em curso' : s.state === 'rever' ? 'a rever' : 'por fazer'}</span></span>
        </li>
      ))}
    </ol>
  );
}

function RequestView({ detail }: { detail: RequestDetail }) {
  const s = useActiveSection();
  const { request, versions, decisions, attachments, member, objectives } = detail;
  const trail = s.catalog.trailById.get(request.trail_id);
  const area = trail ? s.catalog.areaById.get(trail.area_id) : undefined;
  const isOwner = request.membership_id === s.membership.id;
  const progress = useProgress(request.membership_id);
  const teams = useTeams(s.membership.section_id);
  const current = versions.find((v) => v.version_no === request.current_version)!;
  const st = requestStatusLabel[request.status];
  const historic = request.kind === 'historico';
  const stage = stageInfo(s.catalog, progress.data, request);
  const flagged = request.status === 'devolvido' ? flaggedObjectives(request, [...decisions].reverse()) : [];
  const team = teams.data?.find((t) => t.id === member?.team_id)?.name;

  return (
    <>
      <PageTitle
        title={trail?.name ?? 'Pedido'}
        subtitle={request.kind === 'negociacao' ? 'Trilho reconhecido na negociação' : historic ? 'Pedido de progresso anterior' : 'Pedido de validação do trilho'}
        back={isOwner ? '/meu-progresso?vista=pedidos' : true}
      />
      <div className="row" style={{ marginBottom: 12 }}>
        <Badge {...st} />
        {requestKindLabel[request.kind] && <Badge label={requestKindLabel[request.kind]} tone="neutral" icon="clock" />}
        {request.kind !== 'negociacao' && <span className="faint">Versão {request.current_version}</span>}
      </div>

      <section className="card request-summary" aria-label="Resumo do pedido">
        {!isOwner && member && (
          <div className="row request-who">
            <Avatar name={member.profiles?.full_name ?? '?'} photoPath={member.profiles?.photo_path} />
            <div className="grow">
              <strong>{member.profiles?.full_name}</strong>
              <span className="faint">{member.profiles?.totem ? ` · ${member.profiles.totem}` : ''}{team ? ` · ${team}` : ''}</span>
            </div>
            {s.isDirigente && <Link to={`/membros/${member.id}`} className="btn ghost">Percurso</Link>}
          </div>
        )}
        <dl className="meta compact-meta">
          <dt>Área</dt><dd>{area?.name ?? '—'}</dd>
          <dt>Trilho</dt><dd>{trail?.name ?? request.trail_key}</dd>
          <dt>Etapa associada</dt>
          <dd>{stage ? `${stage.name}${stage.confirmed ? '' : ' (proposta, aguarda negociação)'}` : 'Ainda não associado a uma etapa'}</dd>
          {stage?.sr && <><dt>Validação da etapa</dt><dd>{stageRequestLabel[stage.sr.status].label}</dd></>}
          {current?.submitted_at && <><dt>Enviado</dt><dd>{formatDateTime(current.submitted_at)}</dd></>}
        </dl>
        {request.kind === 'normal' && <ProcessSteps request={request} stage={stage} />}
      </section>

      {trail && request.kind !== 'negociacao' && (
        <section className="card" aria-labelledby="h-objs">
          <h2 id="h-objs">Objetivos do trilho</h2>
          <p className="faint prose">O pedido abrange o trilho completo e todos os seus objetivos.</p>
          <TrailObjectives trail={trail} flagged={flagged} />
        </section>
      )}
      {/* A justificação fica logo a seguir aos objetivos, para se lerem juntos. */}
      {request.kind !== 'negociacao' && (!isOwner || request.status !== 'rascunho') && (
        <VersionContent version={current} attachments={attachments.filter((a) => a.version_id === current.id)} historic={historic} objectives={objectives} />
      )}

      {isOwner && <OwnerRequestPanel detail={detail} current={current} />}
      {!isOwner && <ReviewerPanel detail={detail} current={current} hasTeamGuia={!!member?.team_id} />}

      {request.kind === 'negociacao' && (
        <Notice kind="info">
          <p className="prose">A Equipa de Animação reconheceu, na negociação, que este trilho já tinha sido alcançado (Manual do Dirigente, p. 10). A fundamentação está no histórico.</p>
        </Notice>
      )}

      <h2 className="section-title">Decisões e histórico</h2>
      <div className="card">
        <ol className="timeline">
          {versions.map((v) => (
            <li key={v.id}>
              <strong>Versão {v.version_no}</strong>{' '}
              <span className="faint">
                {v.submitted_at ? `· Enviada em ${formatDateTime(v.submitted_at)}` : '· Rascunho'}
                {v.withdrawn_at ? ` · Retirada em ${formatDateTime(v.withdrawn_at)}` : ''}
              </span>
              {v.version_no !== request.current_version && v.submitted_at && (
                <details>
                  <summary className="faint">Ver conteúdo desta versão</summary>
                  <VersionContent version={v} attachments={attachments.filter((a) => a.version_id === v.id)} historic={historic} compact objectives={objectives} />
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
                    {d.objective_codes && d.objective_codes.length > 0 && <div>Objetivos a demonstrar melhor: <strong>{d.objective_codes.join(', ')}</strong></div>}
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

function ReviewerPanel({ detail, current, hasTeamGuia }: { detail: RequestDetail; current: RequestVersion; hasTeamGuia: boolean }) {
  const s = useActiveSection();
  const { request, member } = detail;
  const action = useAction();
  const trail = s.catalog.trailById.get(request.trail_id);
  const [outcome, setOutcome] = useState<'validado' | 'devolvido' | 'aprovado' | 'recusado'>(request.kind === 'historico' ? 'aprovado' : 'validado');
  const [meeting, setMeeting] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [refDate, setRefDate] = useState('');
  const [note, setNote] = useState('');
  const open = request.status === 'submetido' || request.status === 'em_revisao';
  const isTeamGuia = s.isGuia && member?.team_id === s.membership.team_id;
  const canTeam = request.kind === 'normal' && open && (s.isDirigente || isTeamGuia);
  const canHistoric = request.kind === 'historico' && open && s.isDirigente;
  const commentRequired = outcome !== 'validado' && outcome !== 'aprovado';
  const memberIsGuia = member?.function === 'guia';
  const onBehalf = s.isDirigente && !isTeamGuia;

  // Depois de decidir, o painel deixa de se aplicar; a confirmação continua visível.
  const done = action.success && !canTeam && !canHistoric ? <Notice kind="success">{action.success}</Notice> : null;
  if (!canTeam && !canHistoric && !s.isDirigente) {
    return done ?? (request.status === 'rascunho' ? <Notice kind="info">Este pedido ainda está em rascunho.</Notice> : null);
  }

  return (
    <>
      {done}
      {canTeam && (
        <section className="card" aria-labelledby="h-decisao">
          <h2 id="h-decisao">Decisão da reunião de Equipa</h2>
          <p className="faint prose">
            Regista a decisão tomada <strong>em reunião de Equipa</strong> sobre o trilho completo. Este registo não substitui a reunião e é comunicado ao pioneiro e ao Conselho de Guias.
          </p>
          {onBehalf && (
            <Notice kind="warn">
              <p className="prose">
                Estás a registar como Equipa de Animação, em nome da reunião de Equipa
                {memberIsGuia ? ' (pedido do próprio guia, que não decide o seu pedido).' : hasTeamGuia ? '. O guia da equipa será avisado deste registo.' : '.'}
              </p>
            </Notice>
          )}
          <ErrorBox error={action.error} />
          {action.success && <Notice kind="success">{action.success}</Notice>}
          {!action.success && (
            <>
              {request.status === 'submetido' && (
                <button type="button" className="btn secondary" disabled={action.busy}
                  onClick={() => action.run(() => call('mark_request_in_review', { p_request: request.id }), 'Pedido marcado como em análise.')}>
                  Marcar como em análise
                </button>
              )}
              <fieldset style={{ marginTop: 12 }}>
                <legend>Decisão sobre o trilho</legend>
                <div className="radio-cards">
                  <label className="radio-card">
                    <input type="radio" name="outcome" checked={outcome === 'validado'} onChange={() => setOutcome('validado')} />
                    <span><strong>Validar o trilho</strong><br /><span className="faint">O trilho foi alcançado.</span></span>
                  </label>
                  <label className="radio-card">
                    <input type="radio" name="outcome" checked={outcome === 'devolvido'} onChange={() => setOutcome('devolvido')} />
                    <span><strong>Devolver para revisão</strong><br /><span className="faint">Com fundamentação; o pioneiro corrige e volta a enviar.</span></span>
                  </label>
                </div>
              </fieldset>
              {outcome === 'devolvido' && trail && trail.catalog_objectives.length > 1 && (
                <fieldset className="obj-flags">
                  <legend>Objetivos que ainda precisam de ser demonstrados (opcional)</legend>
                  {trail.catalog_objectives.map((o) => (
                    <label key={o.id} className="check-row">
                      <input type="checkbox" checked={codes.includes(o.code)} onChange={() => setCodes((c) => (c.includes(o.code) ? c.filter((x) => x !== o.code) : [...c, o.code]))} />
                      <span><span className="code">{o.code}</span> <span className="faint">{o.text.length > 90 ? `${o.text.slice(0, 90)}…` : o.text}</span></span>
                    </label>
                  ))}
                </fieldset>
              )}
              <Field label="Data da reunião de Equipa" htmlFor="meeting">
                <input id="meeting" type="date" value={meeting} max={todayIso()} onChange={(e) => setMeeting(e.target.value)} required />
              </Field>
              <Field label={commentRequired ? 'Fundamentação (obrigatória)' : 'Comentário (opcional)'} htmlFor="comment">
                <textarea id="comment" value={comment} maxLength={4000} onChange={(e) => setComment(e.target.value)} />
              </Field>
              <ConfirmButton
                className="btn"
                confirmLabel={outcome === 'validado' ? 'Validar o trilho' : 'Devolver para revisão'}
                disabled={action.busy || !meeting || (commentRequired && !comment.trim())}
                description={outcome === 'validado' ? 'O trilho fica validado e a decisão é comunicada ao pioneiro e ao Conselho de Guias.' : 'O pedido fica «A rever» para o pioneiro corrigir e reenviar; o histórico fica guardado.'}
                onConfirm={() =>
                  action.run(() => call('record_team_decision', {
                    p_request: request.id, p_expected_version: current.version_no, p_validated: outcome === 'validado', p_meeting_date: meeting, p_comment: comment,
                    p_objective_codes: outcome === 'devolvido' && codes.length ? codes : null,
                  }), outcome === 'validado' ? 'Trilho validado. A decisão foi comunicada ao Conselho de Guias.' : 'Pedido devolvido para revisão.')
                }
              >
                Registar decisão
              </ConfirmButton>
            </>
          )}
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
        <details className="card flat more-card">
          <summary>Devolução fundamentada (Conselho de Guias)</summary>
          <p className="faint prose">Usa apenas se o Conselho de Guias verificar que a validação foi manifestamente incoerente com a atitude demonstrada.</p>
          <CouncilReturn requestId={request.id} />
        </details>
      )}

      {s.isDirigente && request.status !== 'rascunho' && request.status !== 'cancelado' && (
        <details className="card flat more-card">
          <summary>Nota de revisão da Equipa de Animação</summary>
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
        </details>
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
