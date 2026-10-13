import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, Paperclip, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useActiveSection } from '../lib/session';
import { call, fetchRequest, signedUrl, type RequestDetail } from '../lib/api';
import { useAction } from '../lib/useAction';
import { prepareAttachment, safeFileName } from '../lib/image';
import { errorMessage } from '../lib/errors';
import { decisionLabel, formatDate, formatDateTime, requestKindLabel, requestStatusLabel, todayIso } from '../lib/labels';
import type { RequestVersion } from '../lib/types';
import { Avatar, Badge, ConfirmButton, ErrorBox, Field, Loading, Notice, PageTitle } from '../components/ui';
import NotFound from './NotFound';

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
        back={isOwner ? '/pedidos' : true}
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

      {isOwner && <OwnerPanel detail={detail} current={current} />}
      {!isOwner && <ReviewerPanel detail={detail} current={current} />}

      {request.kind === 'negociacao' && (
        <Notice kind="info">
          <p>A Equipa de Animação reconheceu, na negociação, que este trilho já tinha sido alcançado (Manual do Dirigente, p. 10). A fundamentação está no histórico.</p>
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
                {v.submitted_at ? `submetida ${formatDateTime(v.submitted_at)}` : 'rascunho'}
                {v.withdrawn_at ? ` · retirada ${formatDateTime(v.withdrawn_at)}` : ''}
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

function VersionContent({ version, attachments, historic, compact }: { version: RequestVersion; attachments: RequestDetail['attachments']; historic: boolean; compact?: boolean }) {
  return (
    <section className={compact ? '' : 'card'}>
      {!compact && <h2>Reflexão e vivências</h2>}
      <p className="label">Reflexão</p>
      <div className="quote">{version.reflection || '—'}</div>
      <p className="label" style={{ marginTop: 10 }}>Vivências e oportunidades educativas</p>
      <div className="quote">{version.experiences || '—'}</div>
      <dl className="meta" style={{ marginTop: 10 }}>
        {(version.period_start || version.period_end) && (
          <>
            <dt>Período</dt>
            <dd>{formatDate(version.period_start)} – {formatDate(version.period_end)}</dd>
          </>
        )}
        {historic && (
          <>
            <dt>Data aproximada</dt>
            <dd>{version.approximate_date || 'Não indicada'}</dd>
          </>
        )}
      </dl>
      <AttachmentList attachments={attachments} />
    </section>
  );
}

function AttachmentList({ attachments, onRemove, busy }: { attachments: RequestDetail['attachments']; onRemove?: (id: string) => void; busy?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  if (!attachments.length) return null;
  async function open(path: string) {
    setError(null);
    try {
      window.open(await signedUrl('anexos', path, 120), '_blank', 'noopener');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <div style={{ marginTop: 10 }}>
      <p className="label">Anexos</p>
      <ErrorBox error={error} />
      <ul className="list">
        {attachments.map((a) => (
          <li key={a.id} className="list-item">
            <FileText size={20} aria-hidden="true" />
            <button type="button" className="btn ghost grow ellipsis" style={{ justifyContent: 'flex-start' }} onClick={() => open(a.storage_path)}>
              {a.file_name}
            </button>
            <span className="faint">{Math.ceil(a.size_bytes / 1024)} KB</span>
            {onRemove && (
              <button type="button" className="btn ghost" aria-label={`Remover ${a.file_name}`} disabled={busy} onClick={() => onRemove(a.id)}>
                <Trash2 size={18} aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OwnerPanel({ detail, current }: { detail: RequestDetail; current: RequestVersion }) {
  const s = useActiveSection();
  const { request, attachments } = detail;
  const action = useAction();
  const [form, setForm] = useState({
    reflection: current.reflection,
    experiences: current.experiences,
    period_start: current.period_start ?? '',
    period_end: current.period_end ?? '',
    approximate_date: current.approximate_date ?? '',
  });
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const historic = request.kind === 'historico';
  const historicBlocked = historic && !s.settings?.historical_progress_enabled;

  useEffect(() => {
    setForm({
      reflection: current.reflection,
      experiences: current.experiences,
      period_start: current.period_start ?? '',
      period_end: current.period_end ?? '',
      approximate_date: current.approximate_date ?? '',
    });
    setDirty(false);
  }, [current.id, current.reflection, current.experiences, current.period_start, current.period_end, current.approximate_date]);

  const currentAttachments = useMemo(() => attachments.filter((a) => a.version_id === current.id), [attachments, current.id]);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setDirty(true);
  };

  const save = () =>
    call('save_request_draft', {
      p_request: request.id,
      p_reflection: form.reflection,
      p_experiences: form.experiences,
      p_period_start: form.period_start || null,
      p_period_end: form.period_end || null,
      p_approximate_date: form.approximate_date || null,
    });

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    for (const file of Array.from(files)) {
      setUploading(file.name);
      try {
        const prepared = await prepareAttachment(file);
        const path = `${request.id}/${crypto.randomUUID()}-${safeFileName(prepared.name)}`;
        const up = await supabase.storage.from('anexos').upload(path, prepared.blob, { contentType: prepared.type, upsert: false });
        if (up.error) throw up.error;
        const res = await action.run(() => call('add_attachment', { p_request: request.id, p_path: path, p_file_name: prepared.name }));
        if (!res.ok) break;
      } catch (e) {
        setUploadError(`${file.name}: ${errorMessage(e)}`);
        break;
      } finally {
        setUploading(null);
      }
    }
    if (fileInput.current) fileInput.current.value = '';
  }

  if (request.status === 'rascunho') {
    return (
      <section className="card">
        <h2>{historic ? 'Descreve o que já concluíste' : 'Reflexão e vivências'}</h2>
        {historicBlocked && (
          <Notice kind="warn">
            <p>
              O registo de progresso anterior está desativado nesta secção. Podes cancelar este pedido e usar o progresso normal para o
              mesmo trilho, ou aguardar que seja reativado.
            </p>
          </Notice>
        )}
        <ErrorBox error={action.error} />
        {action.success && <Notice kind="success">{action.success}</Notice>}
        <Field label="Reflexão" htmlFor="reflection" hint="O que mudou em ti? Como sentes que alcançaste os objetivos deste trilho?">
          <textarea id="reflection" aria-describedby="reflection-hint" value={form.reflection} onChange={set('reflection')} maxLength={10000} />
        </Field>
        <Field label="Vivências e oportunidades educativas" htmlFor="experiences" hint="Atividades, momentos e oportunidades que viveste (no escutismo, em casa, na escola…).">
          <textarea id="experiences" aria-describedby="experiences-hint" value={form.experiences} onChange={set('experiences')} maxLength={10000} />
        </Field>
        <div className="grid-2">
          <Field label="Desde (opcional)" htmlFor="ps">
            <input id="ps" type="date" value={form.period_start} max={todayIso()} onChange={set('period_start')} />
          </Field>
          <Field label="Até (opcional)" htmlFor="pe">
            <input id="pe" type="date" value={form.period_end} max={todayIso()} onChange={set('period_end')} />
          </Field>
        </div>
        {historic && (
          <Field label="Quando concluíste? (aproximado, opcional)" htmlFor="approx" hint="Ex.: «primavera de 2025». A data real da decisão fica registada à parte.">
            <input id="approx" type="text" aria-describedby="approx-hint" value={form.approximate_date} onChange={set('approximate_date')} maxLength={100} />
          </Field>
        )}

        <p className="label">Anexos (opcional)</p>
        <p className="faint">JPG, PNG, WebP ou PDF, até 10 MB. As fotografias são comprimidas. Um anexo é um apoio, não uma prova que valide o trilho.</p>
        <AttachmentList
          attachments={currentAttachments}
          busy={action.busy}
          onRemove={(id) => action.run(() => call('remove_attachment', { p_attachment: id }), 'Anexo removido.')}
        />
        <ErrorBox error={uploadError} />
        <label className="btn secondary" style={{ marginTop: 8 }}>
          <Paperclip size={18} aria-hidden="true" /> {uploading ? `A carregar ${uploading}…` : 'Juntar ficheiro'}
          <input ref={fileInput} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,application/pdf" multiple
            disabled={!!uploading} onChange={(e) => onFiles(e.target.files)} />
        </label>

        <div className="btn-row">
          <button type="button" className="btn secondary" disabled={action.busy || !dirty} onClick={async () => {
            const r = await action.run(save, 'Rascunho guardado.');
            if (r.ok) setDirty(false);
          }}>
            {action.busy ? 'A guardar…' : 'Guardar rascunho'}
          </button>
          <ConfirmButton
            className="btn"
            confirmLabel="Submeter"
            disabled={action.busy || historicBlocked || !form.reflection.trim()}
            description={historic ? 'O pedido segue para os dirigentes. Depois de submetido só o podes alterar retirando-o.' : 'O pedido segue para a próxima reunião de Equipa. Depois de submetido só o podes alterar retirando-o.'}
            onConfirm={() =>
              action.run(async () => {
                await save();
                await call('submit_trail_request', { p_request: request.id });
              }, 'Pedido submetido.')
            }
          >
            Submeter
          </ConfirmButton>
        </div>
        <div className="btn-row">
          <ConfirmButton className="btn ghost" confirmLabel="Cancelar pedido" description="O pedido fica no histórico como cancelado." disabled={action.busy}
            onConfirm={() => action.run(() => call('cancel_trail_request', { p_request: request.id }), 'Pedido cancelado.')}>
            Cancelar pedido
          </ConfirmButton>
        </div>
      </section>
    );
  }

  return (
    <section className="card flat">
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      {(request.status === 'submetido' || request.status === 'em_revisao') && (
        <>
          <p>{historic ? 'O pedido aguarda decisão dos dirigentes.' : 'O pedido aguarda a decisão da reunião de Equipa.'}</p>
          <ConfirmButton confirmLabel="Retirar para editar" description="A versão submetida fica no histórico e é criada uma nova versão em rascunho." disabled={action.busy}
            onConfirm={() => action.run(() => call('withdraw_trail_request', { p_request: request.id }), 'Pedido retirado. Podes editar a nova versão.')}>
            Retirar para editar
          </ConfirmButton>
        </>
      )}
      {request.status === 'devolvido' && (
        <>
          <p>O pedido foi devolvido para continuares a trabalhar. Lê os comentários no histórico.</p>
          <div className="btn-row">
            <button type="button" className="btn" disabled={action.busy}
              onClick={() => action.run(() => call('start_new_version', { p_request: request.id }), 'Nova versão criada.')}>
              Preparar nova versão
            </button>
            <ConfirmButton className="btn ghost" confirmLabel="Cancelar pedido" disabled={action.busy}
              description={historic ? 'Depois de cancelar podes pedir a validação deste trilho pelo progresso normal.' : undefined}
              onConfirm={() => action.run(() => call('cancel_trail_request', { p_request: request.id }), 'Pedido cancelado.')}>
              Cancelar pedido
            </ConfirmButton>
          </div>
        </>
      )}
      {request.status === 'validado_equipa' && <p>Trilho validado na reunião de Equipa. A decisão foi comunicada ao Conselho de Guias.</p>}
      {request.status === 'aprovado' && request.kind === 'historico' && (
        <p>Progresso anterior reconhecido pelos dirigentes{request.approved_reference_date ? ` (referência: ${formatDate(request.approved_reference_date)})` : ''}.</p>
      )}
      {request.status === 'recusado' && <p>Este progresso anterior não foi reconhecido. Podes seguir pelo progresso normal para este trilho.</p>}
      {request.status === 'cancelado' && <p>Pedido cancelado.</p>}
    </section>
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
            <p>
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
          <p className="faint">Usa apenas se o Conselho de Guias verificar que a validação foi manifestamente incoerente com a atitude demonstrada.</p>
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
