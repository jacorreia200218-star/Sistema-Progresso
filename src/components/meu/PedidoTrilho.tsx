// Pedido de validação do trilho, dentro da página do trilho:
// (a página mostra a área e o trilho) → todos os objetivos (sempre visíveis) → justificação → Pedir validação do trilho.
// O pedido abrange o trilho completo: não se escolhem objetivos. Não exige
// começar o trilho, registar vivências nem uma fase intermédia. Enviar não
// fecha o trilho: só a decisão da reunião de Equipa o valida.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MessageSquare, Paperclip } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { call, fetchRequest } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { errorMessage } from '../../lib/errors';
import { prepareAttachment, safeFileName } from '../../lib/image';
import { activeRequest, isAwaiting, isValidated } from '../../lib/progress';
import { flaggedObjectives, lastFeedback, validationInfo } from '../../lib/meuprogresso';
import { decisionLabel, formatDate, formatDateTime, JUSTIFICATION_HINT, JUSTIFICATION_LABEL } from '../../lib/labels';
import type { CatalogTrail, MemberProgress } from '../../lib/types';
import { Badge, ConfirmButton, ErrorBox, Loading, Notice } from '../ui';
import { AttachmentList } from '../RequestEditor';

const MAX = 10000;

/** Rascunho local do texto, por pessoa e por trilho: sobrevive a erros, a voltar atrás e a recarregar a página. */
function useLocalDraft(key: string) {
  const read = (): string | null => {
    try {
      const v = localStorage.getItem(key);
      return typeof v === 'string' ? v : null;
    } catch {
      return null;
    }
  };
  const write = (text: string | null) => {
    try {
      if (text === null) localStorage.removeItem(key);
      else localStorage.setItem(key, text);
    } catch { /* armazenamento indisponível: o texto continua em memória */ }
  };
  return { read, write };
}

/** Todos os objetivos do trilho, com código e texto oficial completo (só leitura). */
export function TrailObjectives({ trail, flagged = [], label = 'Objetivos do trilho' }: { trail: CatalogTrail; flagged?: string[]; label?: string }) {
  return (
    <ul className="obj-list" aria-label={label}>
      {trail.catalog_objectives.map((o) => (
        <li key={o.id} className={`obj-item ${flagged.includes(o.code) ? 'is-flagged' : ''}`}>
          <span className="code">{o.code}</span>
          <span className="grow">
            <span className="prose obj-text">{o.text}</span>
            {o.pending_note && <span className="faint obj-pending"><AlertTriangle size={13} aria-hidden="true" /> Pendente: {o.pending_note}</span>}
          </span>
          {flagged.includes(o.code) && <Badge label="A demonstrar" tone="attention" icon="return" />}
        </li>
      ))}
    </ul>
  );
}

export function PedidoTrilho({ trail, progress, membershipId, pedidosTo, historicalEnabled, readOnly }: {
  trail: CatalogTrail;
  progress: MemberProgress;
  membershipId: string;
  pedidosTo: string;
  historicalEnabled: boolean;
  /** Modo de consulta: mostra o estado, sem ações do pioneiro. */
  readOnly?: boolean;
}) {
  const r = activeRequest(progress.requests, trail.key);
  const detail = useQuery({ queryKey: ['request', r?.id], queryFn: () => fetchRequest(r!.id), enabled: !!r });
  const action = useAction();
  const qc = useQueryClient();
  const local = useLocalDraft(`pedido-trilho:${membershipId}:${trail.key}`);
  const [sent, setSent] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const editable = !readOnly && (!r || (r.kind === 'normal' && (r.status === 'rascunho' || r.status === 'devolvido')));
  const current = detail.data?.versions.find((v) => v.version_no === detail.data!.request.current_version);
  const flagged = r?.status === 'devolvido' ? flaggedObjectives(r, progress.decisions) : [];
  const feedback = r?.status === 'devolvido' ? lastFeedback(r, progress.decisions) : undefined;

  // Texto inicial: rascunho local; senão, o que já está no pedido (rascunho ou versão devolvida).
  useEffect(() => {
    if (text !== null || !editable || (r && !detail.data)) return;
    setText(local.read() ?? (current?.evidence || current?.reflection || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, detail.data, r?.id]);

  const justification = text ?? '';
  const attachments = current ? (detail.data?.attachments ?? []).filter((a) => a.version_id === current.id) : [];

  // Se um passo falhar a meio (ex.: rascunho criado, envio recusado), atualiza os
  // dados antes de mostrar o erro: a tentativa seguinte parte do estado real.
  const refreshing = async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      await qc.invalidateQueries();
      throw e;
    }
  };

  /** Garante um rascunho no servidor (para anexos e envio) e devolve o pedido e a versão a enviar. */
  async function ensureDraft(): Promise<{ id: string; version: number }> {
    if (!r) return { id: await call<string>('create_trail_request', { p_membership: membershipId, p_trail: trail.id, p_kind: 'normal' }), version: 1 };
    if (r.status === 'devolvido') {
      await call('start_new_version', { p_request: r.id });
      return { id: r.id, version: r.current_version + 1 };
    }
    return { id: r.id, version: r.current_version };
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    for (const file of Array.from(files)) {
      setUploading(file.name);
      try {
        const prepared = await prepareAttachment(file);
        const res = await action.run(() => refreshing(async () => {
          const { id } = await ensureDraft();
          const path = `${id}/${crypto.randomUUID()}-${safeFileName(prepared.name)}`;
          const up = await supabase.storage.from('anexos').upload(path, prepared.blob, { contentType: prepared.type, upsert: false });
          if (up.error) throw up.error;
          await call('add_attachment', { p_request: id, p_path: path, p_file_name: prepared.name });
        }));
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

  async function send() {
    const res = await action.run(() => refreshing(async () => {
      const { id, version } = await ensureDraft();
      await call('submit_trail_validation', { p_request: id, p_expected_version: version, p_justification: justification });
    }));
    if (res.ok) {
      local.write(null);
      setSent(true);
      setText(null);
    }
  }

  // Trilho validado, pedido em validação, consulta ou pedido de outro tipo: só leitura.
  if (!editable || sent) {
    const closed = isValidated(r);
    const v = closed ? validationInfo(r, progress.decisions) : null;
    const pending = isAwaiting(r);
    return (
      <section className="card pedido" id="pedido" aria-labelledby="h-pedido">
        <h2 id="h-pedido">Objetivos e validação</h2>
        {sent && <Notice kind="success"><p>Pedido enviado. Podes acompanhá-lo em <Link to={pedidosTo}>Os meus pedidos</Link>.</p></Notice>}
        <p className="label">Objetivos que o trilho demonstra</p>
        <TrailObjectives trail={trail} flagged={flagged} />
        {closed ? (
          <p className="faint">{v ? `${v.label} em ${formatDate(v.date)}.` : 'Trilho validado.'}</p>
        ) : pending && r ? (
          <p className="faint prose">
            {r.kind === 'historico' ? 'O pedido de progresso anterior aguarda a decisão dos dirigentes.'
              : r.status === 'validado_guias' ? 'Validado pelos guias. Falta a confirmação dos dirigentes.'
              : 'O pedido aguarda a decisão da reunião de Equipa sobre o trilho completo.'}
            {current?.submitted_at && ` Enviado em ${formatDateTime(current.submitted_at)}.`}
          </p>
        ) : r?.kind === 'historico' ? (
          <p className="faint prose">Este trilho tem um pedido de progresso anterior.</p>
        ) : readOnly ? (
          <p className="faint">{r?.status === 'devolvido' ? 'O pedido está a rever.' : 'Ainda não há pedido de validação para este trilho.'}</p>
        ) : null}
        {r && <Link to={readOnly ? `/revisoes/pedido/${r.id}` : `/pedidos/${r.id}`} className="btn ghost">Ver o pedido</Link>}
      </section>
    );
  }

  if (r && detail.isLoading) return <section className="card" id="pedido"><Loading rows={2} /></section>;

  const tooLong = justification.length > MAX;
  return (
    <section className="card pedido" id="pedido" aria-labelledby="h-pedido">
      <h2 id="h-pedido">Fechar este trilho</h2>
      {r?.status === 'devolvido' && (
        <div className="feedback feedback-review">
          <MessageSquare size={15} aria-hidden="true" />
          <div>
            <strong>{feedback ? decisionLabel[feedback.kind] : 'A rever'}</strong>
            {feedback?.comment && <p className="prose" style={{ margin: '2px 0 0' }}>«{feedback.comment}»</p>}
            {flagged.length > 0 && <p style={{ margin: '2px 0 0' }}>Objetivos a demonstrar melhor: <strong>{flagged.join(', ')}</strong>.</p>}
            <p className="faint prose" style={{ margin: '2px 0 0' }}>Corrige a justificação e volta a pedir a validação. O histórico fica guardado.</p>
          </div>
        </div>
      )}

      <div className="pedido-objs" role="region" aria-label={`Objetivos do trilho ${trail.name}`}>
        <p className="label">Objetivos que o trilho demonstra ({trail.catalog_objectives.length})</p>
        <TrailObjectives trail={trail} flagged={flagged} />
      </div>

      <div className="field">
        <label htmlFor="justificacao">{JUSTIFICATION_LABEL}</label>
        <span className="hint prose" id="justificacao-hint">{JUSTIFICATION_HINT}</span>
        <textarea id="justificacao" aria-describedby="justificacao-hint" value={justification} required
          onChange={(e) => { setText(e.target.value); local.write(e.target.value); }} />
        {tooLong && <span className="hint" role="alert">O texto tem mais de {MAX} caracteres.</span>}
      </div>

      <p className="label">Anexos (opcional)</p>
      <AttachmentList attachments={attachments} busy={action.busy}
        onRemove={r?.status === 'rascunho' ? (id) => action.run(() => call('remove_attachment', { p_attachment: id })) : undefined} />
      <ErrorBox error={uploadError} />
      <label className="btn secondary attach-btn">
        <Paperclip size={16} aria-hidden="true" /> {uploading ? `A carregar ${uploading}…` : 'Juntar ficheiro'}
        <input ref={fileInput} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,application/pdf" multiple
          disabled={!!uploading || action.busy} onChange={(e) => onFiles(e.target.files)} />
      </label>

      <ErrorBox error={action.error} />
      <div className="btn-row">
        <ConfirmButton className="btn" confirmLabel="Pedir validação do trilho" disabled={!justification.trim() || tooLong || action.busy}
          description="O pedido segue para a próxima reunião de Equipa, que decide sobre o trilho completo; depois os dirigentes confirmam. Enviar não fecha o trilho."
          onConfirm={send}>
          {action.busy ? 'A enviar…' : 'Pedir validação do trilho'}
        </ConfirmButton>
      </div>
      {!r && historicalEnabled && (
        <p className="faint prose">Já concluíste este trilho antes de usar a aplicação? Fala com a Equipa de Animação: o progresso anterior é registado pelos dirigentes.</p>
      )}
    </section>
  );
}
