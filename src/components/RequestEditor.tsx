// Conteúdo e edição de um pedido de validação de trilho (usado na página do
// pedido e diretamente na página do trilho).
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Paperclip, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useActiveSection } from '../lib/session';
import { call, signedUrl, type RequestDetail } from '../lib/api';
import { useAction } from '../lib/useAction';
import { prepareAttachment, safeFileName } from '../lib/image';
import { errorMessage } from '../lib/errors';
import { formatDate, formatDateTime, JUSTIFICATION_LABEL, todayIso } from '../lib/labels';
import type { RequestObjective, RequestVersion } from '../lib/types';
import { Link } from 'react-router-dom';
import { Badge, ConfirmButton, ErrorBox, Field, Notice } from './ui';

/** Decisões por objetivo de uma versão do modelo anterior (histórico; não fecham o trilho). */
export function LegacyObjectives({ rows }: { rows: RequestObjective[] }) {
  return (
    <ul className="obj-list" aria-label="Objetivos escolhidos no modelo anterior">
      {rows.map((row) => (
        <li key={row.id} className="obj-item">
          <span className="code">{row.objective_code}</span>
          <span className="grow">{row.comment && <span className={row.decision === 'rever' ? 'feedback-inline' : 'faint'} style={{ display: 'block' }}>«{row.comment}»</span>}</span>
          {row.decision === 'aceite' ? <Badge label="Aceite" tone="muted" icon="check" />
            : row.decision === 'rever' ? <Badge label="A rever" tone="muted" icon="return" />
            : <Badge label="Sem decisão" tone="muted" icon="circle" />}
        </li>
      ))}
    </ul>
  );
}

/** Conteúdo de uma versão: justificação conjunta (ou os campos de reflexão dos pedidos antigos), anexos e data. */
export function VersionContent({ version, attachments, historic, compact, objectives = [] }: {
  version: RequestVersion; attachments: RequestDetail['attachments']; historic: boolean; compact?: boolean; objectives?: RequestObjective[];
}) {
  const legacy = objectives.filter((o) => o.version_id === version.id);
  const sentOn = version.submitted_at ? <p className="faint" style={{ margin: '8px 0 0' }}>Enviado em {formatDateTime(version.submitted_at)}.</p> : null;
  if (!historic && (version.evidence || legacy.length) && !version.reflection) {
    return (
      <section className={compact ? 'version-content' : 'card version-content'}>
        {!compact && <h2>Justificação</h2>}
        {legacy.length > 0 && (
          <>
            <p className="label">Objetivos escolhidos (modelo anterior, por objetivo)</p>
            <LegacyObjectives rows={legacy} />
          </>
        )}
        <p className="label">{JUSTIFICATION_LABEL}</p>
        <div className="quote prose">{version.evidence || '—'}</div>
        <AttachmentList attachments={attachments} />
        {sentOn}
      </section>
    );
  }
  return (
    <section className={compact ? 'version-content' : 'card version-content'}>
      {!compact && <h2>Reflexão e vivências</h2>}
      <p className="label">O que fiz</p>
      <div className="quote prose">{version.experiences || '—'}</div>
      {version.context && (<><p className="label" style={{ marginTop: 10 }}>Em que contexto</p><div className="quote prose">{version.context}</div></>)}
      <p className="label" style={{ marginTop: 10 }}>O que aprendi</p>
      <div className="quote prose">{version.reflection || '—'}</div>
      {version.evidence && (<><p className="label" style={{ marginTop: 10 }}>Como demonstrei os objetivos do trilho</p><div className="quote prose">{version.evidence}</div></>)}
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
      {sentOn}
    </section>
  );
}

export function AttachmentList({ attachments, onRemove, busy }: { attachments: RequestDetail['attachments']; onRemove?: (id: string) => void; busy?: boolean }) {
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

export function OwnerRequestPanel({ detail, current }: { detail: RequestDetail; current: RequestVersion }) {
  const s = useActiveSection();
  const { request, attachments } = detail;
  const action = useAction();
  const [form, setForm] = useState({
    reflection: current.reflection,
    experiences: current.experiences,
    context: current.context ?? '',
    evidence: current.evidence ?? '',
    period_start: current.period_start ?? '',
    period_end: current.period_end ?? '',
    approximate_date: current.approximate_date ?? '',
  });
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const historic = request.kind === 'historico';
  const trail = s.catalog.trailById.get(request.trail_id);
  const ownGuia = s.isGuia && request.membership_id === s.membership.id;
  const destination = historic
    ? 'Ao submeter, o pedido segue diretamente para os dirigentes (progresso anterior).'
    : ownGuia
      ? 'Ao submeter, segue para a reunião de Equipa; como és o guia, a decisão é registada pela Equipa de Animação. Depois é comunicada ao Conselho de Guias.'
      : 'Ao submeter, segue para a próxima reunião de Equipa: o guia regista a decisão tomada em conjunto, que é comunicada ao Conselho de Guias.';
  const historicBlocked = historic && !s.settings?.historical_progress_enabled;

  useEffect(() => {
    setForm({
      reflection: current.reflection,
      experiences: current.experiences,
      context: current.context ?? '',
      evidence: current.evidence ?? '',
      period_start: current.period_start ?? '',
      period_end: current.period_end ?? '',
      approximate_date: current.approximate_date ?? '',
    });
    setDirty(false);
  }, [current.id, current.reflection, current.experiences, current.context, current.evidence, current.period_start, current.period_end, current.approximate_date]);

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
      p_context: form.context,
      p_evidence: form.evidence,
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

  const trailTo = trail ? `/meu-progresso/trilho/${trail.key}#pedido` : '/meu-progresso';
  if (request.status === 'rascunho' && request.kind === 'normal') {
    return (
      <section className="card flat">
        <p className="prose">Este pedido ainda não foi enviado. Escreve a justificação e pede a validação na página do trilho.</p>
        <div className="btn-row">
          <Link to={trailTo} className="btn">Continuar no trilho</Link>
          <ConfirmButton className="btn ghost" confirmLabel="Cancelar pedido" description="O pedido fica no histórico como cancelado." disabled={action.busy}
            onConfirm={() => action.run(() => call('cancel_trail_request', { p_request: request.id }), 'Pedido cancelado.')}>
            Cancelar pedido
          </ConfirmButton>
        </div>
        <ErrorBox error={action.error} />
        {action.success && <Notice kind="success">{action.success}</Notice>}
      </section>
    );
  }

  if (request.status === 'rascunho') {
    return (
      <section className="card">
        <h2>{historic ? 'Descreve o que já concluíste' : 'Reflexão e vivências'}</h2>
        {historicBlocked && (
          <Notice kind="warn">
            <p className="prose">
              O registo de progresso anterior está desativado nesta secção. Podes cancelar este pedido e usar o progresso normal para o
              mesmo trilho, ou aguardar que seja reativado.
            </p>
          </Notice>
        )}
        <ErrorBox error={action.error} />
        {action.success && <Notice kind="success">{action.success}</Notice>}
        <Field label="O que fiz" htmlFor="experiences" hint="Atividades, momentos e oportunidades educativas que viveste — no escutismo, em casa, na escola.">
          <textarea id="experiences" aria-describedby="experiences-hint" value={form.experiences} onChange={set('experiences')} maxLength={10000} />
        </Field>
        <Field label="Em que contexto" htmlFor="context" hint="Onde e com quem: Empreendimento, Equipa, escola, família, paróquia…">
          <textarea id="context" aria-describedby="context-hint" value={form.context} onChange={set('context')} maxLength={10000} style={{ minHeight: 70 }} />
        </Field>
        <Field label="O que aprendi (obrigatório)" htmlFor="reflection" hint="A tua reflexão: o que mudou em ti?">
          <textarea id="reflection" aria-describedby="reflection-hint" value={form.reflection} onChange={set('reflection')} maxLength={10000} />
        </Field>
        <Field label="Como demonstrei os objetivos do trilho" htmlFor="evidence" hint="Relaciona o que fizeste com os objetivos educativos abaixo.">
          <textarea id="evidence" aria-describedby="evidence-hint" value={form.evidence} onChange={set('evidence')} maxLength={10000} />
        </Field>
        {trail && trail.catalog_objectives.length > 0 && (
          <ul className="objective-hints" aria-label="Objetivos educativos do trilho">
            {trail.catalog_objectives.map((o) => <li key={o.id}><span className="code">{o.code}</span> {o.text}</li>)}
          </ul>
        )}
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
        <p className="faint prose">JPG, PNG, WebP ou PDF, até 10 MB. As fotografias são comprimidas. Um anexo é um apoio, não uma prova que valide o trilho.</p>
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

        <div className="destination" role="note">
          <strong>Para onde segue:</strong> {destination} Submeter não é concluir: o trilho só fica «Validado» depois da decisão.
        </div>
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
          <p className="prose">{historic ? 'O pedido aguarda decisão dos dirigentes.' : 'O pedido aguarda a decisão da reunião de Equipa. Se precisares de o alterar, retira-o: a versão enviada fica no histórico.'}</p>
          <ConfirmButton confirmLabel="Retirar para editar" description="A versão submetida fica no histórico e é criada uma nova versão em rascunho." disabled={action.busy}
            onConfirm={() => action.run(() => call('withdraw_trail_request', { p_request: request.id }), 'Pedido retirado. Podes editar a nova versão.')}>
            Retirar para editar
          </ConfirmButton>
        </>
      )}
      {request.status === 'devolvido' && (
        <>
          <p className="prose">O pedido está «A rever». Lê os comentários, corrige e volta a enviar; o histórico fica guardado.</p>
          <div className="btn-row">
            {historic ? (
              <button type="button" className="btn" disabled={action.busy}
                onClick={() => action.run(() => call('start_new_version', { p_request: request.id }), 'Nova versão criada.')}>
                Preparar nova versão
              </button>
            ) : (
              <Link to={trailTo} className="btn">Corrigir e reenviar</Link>
            )}
            <ConfirmButton className="btn ghost" confirmLabel="Cancelar pedido" disabled={action.busy}
              description={historic ? 'Depois de cancelar podes pedir a validação deste trilho pelo progresso normal.' : undefined}
              onConfirm={() => action.run(() => call('cancel_trail_request', { p_request: request.id }), 'Pedido cancelado.')}>
              Cancelar pedido
            </ConfirmButton>
          </div>
        </>
      )}
      {request.status === 'validado_equipa' && <p className="prose">Trilho validado na reunião de Equipa. A decisão foi comunicada ao Conselho de Guias.</p>}
      {request.status === 'objetivos_validados' && (
        <p className="prose">Pedido do modelo anterior, por objetivos. As decisões ficam como histórico e não fecham o trilho: <Link to={trailTo}>pede a validação do trilho completo</Link>.</p>
      )}
      {request.status === 'aprovado' && request.kind === 'historico' && (
        <p className="prose">Progresso anterior reconhecido pelos dirigentes{request.approved_reference_date ? ` (referência: ${formatDate(request.approved_reference_date)})` : ''}.</p>
      )}
      {request.status === 'recusado' && <p className="prose">Este progresso anterior não foi reconhecido. Podes seguir pelo progresso normal para este trilho.</p>}
      {request.status === 'cancelado' && <p>Pedido cancelado.</p>}
    </section>
  );
}

