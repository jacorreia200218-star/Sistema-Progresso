// Pedido de validação por objetivos, dentro do trilho:
// Objetivos → Justificação → Resumo → Enviar para validação.
// Não exige começar o trilho, registar vivências nem escolher oportunidades.
// O envio cria um pedido; nada fica validado sem a decisão da reunião de Equipa.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MessageSquare, Paperclip } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { call, fetchRequest } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { errorMessage } from '../../lib/errors';
import { prepareAttachment, safeFileName } from '../../lib/image';
import { activeRequest, isValidated } from '../../lib/progress';
import { OBJECTIVE_LABEL, objectiveStates, validationInfo, type ObjectiveInfo } from '../../lib/meuprogresso';
import { formatDate, formatDateTime } from '../../lib/labels';
import type { CatalogArea, CatalogTrail, MemberProgress } from '../../lib/types';
import { Badge, ErrorBox, Loading, Notice } from '../ui';
import { AttachmentList } from '../RequestEditor';

const MAX = 4000;

/** Rascunho local (seleção + texto), por pessoa e por trilho: sobrevive a erros e a recarregar a página. */
function useLocalDraft(key: string) {
  const read = () => {
    try {
      const v = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      return v && Array.isArray(v.sel) && typeof v.text === 'string' ? (v as { sel: string[]; text: string }) : null;
    } catch {
      return null;
    }
  };
  const write = (v: { sel: string[]; text: string } | null) => {
    try {
      if (v) sessionStorage.setItem(key, JSON.stringify(v));
      else sessionStorage.removeItem(key);
    } catch { /* armazenamento indisponível: o estado continua em memória */ }
  };
  return { read, write };
}

/** Lista de objetivos com código, texto completo e estado (só leitura). */
export function ObjectiveList({ trail, states }: { trail: CatalogTrail; states: Map<string, ObjectiveInfo> }) {
  return (
    <ul className="obj-list" aria-label="Objetivos do trilho">
      {trail.catalog_objectives.map((o) => {
        const st = states.get(o.id) ?? { state: 'disponivel' as const };
        return (
          <li key={o.id} className="obj-item">
            <span className="code">{o.code}</span>
            <span className="grow">
              <span className="prose obj-text">{o.text}</span>
              {o.pending_note && <span className="faint obj-pending"><AlertTriangle size={13} aria-hidden="true" /> Pendente: {o.pending_note}</span>}
              {st.state === 'a_rever' && st.comment && <span className="feedback-inline"><MessageSquare size={13} aria-hidden="true" /> «{st.comment}»</span>}
            </span>
            <Badge {...OBJECTIVE_LABEL[st.state]} />
          </li>
        );
      })}
    </ul>
  );
}

export function PedidoObjetivos({ trail, area, progress, membershipId, pedidosTo, historicalEnabled }: {
  trail: CatalogTrail;
  area: CatalogArea;
  progress: MemberProgress;
  membershipId: string;
  pedidosTo: string;
  historicalEnabled: boolean;
}) {
  const r = activeRequest(progress.requests, trail.key);
  const states = useMemo(() => objectiveStates(trail, progress), [trail, progress]);
  const detail = useQuery({ queryKey: ['request', r?.id], queryFn: () => fetchRequest(r!.id), enabled: !!r });
  const action = useAction();
  const qc = useQueryClient();
  const local = useLocalDraft(`pedido:${membershipId}:${trail.key}`);
  const [sent, setSent] = useState(false);
  const [step, setStep] = useState<'editar' | 'resumo'>('editar');
  const [sel, setSel] = useState<string[] | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const editable = !r || (r.kind === 'normal' && (r.status === 'rascunho' || r.status === 'devolvido'));
  const selectable = (id: string) => ['disponivel', 'a_rever'].includes(states.get(id)?.state ?? 'disponivel');
  const current = detail.data?.versions.find((v) => v.version_no === detail.data!.request.current_version);

  // Estado inicial: rascunho local; senão, o que já está no pedido (rascunho ou «A rever»).
  useEffect(() => {
    if (sel !== null || !editable || (r && !detail.data)) return;
    const saved = local.read();
    const fromRequest = detail.data
      ? r!.status === 'rascunho'
        ? detail.data.objectives.filter((o) => o.version_no === r!.current_version).map((o) => o.objective_id)
        : trail.catalog_objectives.filter((o) => states.get(o.id)?.state === 'a_rever').map((o) => o.id)
      : [];
    setSel((saved?.sel ?? fromRequest).filter(selectable));
    setText(saved?.text ?? current?.evidence ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, detail.data, r?.id]);

  const selection = sel ?? [];
  const justification = text ?? '';
  const remember = (nextSel: string[], nextText: string) => local.write({ sel: nextSel, text: nextText });
  const toggle = (id: string) => {
    const next = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
    setSel(next);
    remember(next, justification);
  };
  const chosen = trail.catalog_objectives.filter((o) => selection.includes(o.id));
  const codes = chosen.map((o) => o.code).join(', ');
  const currentAttachments = current && r?.status === 'rascunho' ? (detail.data?.attachments ?? []).filter((a) => a.version_id === current.id) : [];
  const carriedAttachments = current && r?.status === 'devolvido' ? (detail.data?.attachments ?? []).filter((a) => a.version_id === current.id) : [];

  /** Garante um rascunho no servidor (para anexos e envio) e devolve o pedido e a versão a enviar. */
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
      await call('submit_objectives_request', { p_request: id, p_expected_version: version, p_objectives: selection, p_justification: justification });
    }));
    if (res.ok) {
      local.write(null);
      setSent(true);
      setStep('editar');
      setSel(null);
      setText(null);
    }
  }

  const sentNotice = sent && (
    <Notice kind="success">
      <p>Pedido enviado. Podes acompanhá-lo em <Link to={pedidosTo}>Os meus pedidos</Link>.</p>
    </Notice>
  );

  // Trilho validado, pedido em validação ou pedido de outro tipo: só leitura.
  if (!editable || sent) {
    const closed = isValidated(r);
    const v = closed ? validationInfo(r, progress.decisions) : null;
    return (
      <section className="card" id="pedido" aria-labelledby="h-obj">
        <h2 id="h-obj">Objetivos</h2>
        {sentNotice}
        <ObjectiveList trail={trail} states={states} />
        {closed ? (
          <p className="faint">{v ? `${v.label} em ${formatDate(v.date)}.` : 'Trilho validado.'}</p>
        ) : r && (r.status === 'submetido' || r.status === 'em_revisao') ? (
          <p className="faint prose">
            {r.kind === 'historico' ? 'O pedido de progresso anterior aguarda a decisão dos dirigentes.' : 'O pedido aguarda a decisão da reunião de Equipa. Os restantes objetivos podem ser pedidos depois dessa decisão.'}
            {current?.submitted_at && ` Enviado em ${formatDateTime(current.submitted_at)}.`}
          </p>
        ) : r?.kind === 'historico' ? (
          <p className="faint prose">Este trilho tem um pedido de progresso anterior.</p>
        ) : null}
        {r && <Link to={`/pedidos/${r.id}`} className="btn ghost">Ver o pedido</Link>}
      </section>
    );
  }

  if (r && detail.isLoading) return <section className="card" id="pedido"><Loading rows={2} /></section>;

  if (step === 'resumo') {
    return (
      <section className="card" id="pedido" aria-labelledby="h-resumo">
        <h2 id="h-resumo">Confirma o pedido</h2>
        <dl className="meta summary-list">
          <dt>Área</dt><dd>{area.name}</dd>
          <dt>Trilho</dt><dd>{trail.name}</dd>
          <dt>Objetivos</dt>
          <dd>
            <ul className="tight">{chosen.map((o) => <li key={o.id}><strong>{o.code}</strong> · <span className="prose">{o.text}</span></li>)}</ul>
          </dd>
          <dt>Justificação</dt><dd><div className="quote prose">{justification.trim()}</div></dd>
          {(currentAttachments.length + carriedAttachments.length) > 0 && (<><dt>Anexos</dt><dd>{currentAttachments.length + carriedAttachments.length}</dd></>)}
        </dl>
        <p className="faint prose">O pedido segue para a próxima reunião de Equipa. Enviar não fecha o trilho nem a etapa: cada objetivo é decidido pela reunião de Equipa.</p>
        <ErrorBox error={action.error} />
        <div className="btn-row">
          <button type="button" className="btn secondary" disabled={action.busy} onClick={() => setStep('editar')}>Voltar</button>
          <button type="button" className="btn" disabled={action.busy} aria-busy={action.busy} onClick={send}>
            {action.busy ? 'A enviar…' : 'Enviar para validação'}
          </button>
        </div>
      </section>
    );
  }

  const tooLong = justification.length > MAX;
  return (
    <section className="card" id="pedido" aria-labelledby="h-obj">
      <h2 id="h-obj">Que objetivos atingiste?</h2>
      {r?.status === 'devolvido' && (
        <Notice kind="warn"><p className="prose">O teu pedido está «A rever». Lê os comentários, corrige a justificação e volta a enviar. O histórico fica guardado.</p></Notice>
      )}
      <fieldset className="obj-choose">
        <legend className="sr-only">Objetivos do trilho {trail.name}</legend>
        {trail.catalog_objectives.map((o) => {
          const st = states.get(o.id) ?? { state: 'disponivel' as const };
          const can = selectable(o.id);
          return (
            <label key={o.id} className={`obj-item obj-check ${can ? '' : 'is-locked'}`}>
              <input type="checkbox" checked={can ? selection.includes(o.id) : st.state === 'validado'} disabled={!can} onChange={() => toggle(o.id)} />
              <span className="code">{o.code}</span>
              <span className="grow">
                <span className="prose obj-text">{o.text}</span>
                {o.pending_note && <span className="faint obj-pending"><AlertTriangle size={13} aria-hidden="true" /> Pendente: {o.pending_note}</span>}
                {st.state === 'a_rever' && st.comment && <span className="feedback-inline"><MessageSquare size={13} aria-hidden="true" /> «{st.comment}»</span>}
              </span>
              {st.state !== 'disponivel' && <Badge {...OBJECTIVE_LABEL[st.state]} />}
            </label>
          );
        })}
      </fieldset>

      {selection.length > 0 && (
        <div className="justification">
          <div className="field">
            <label htmlFor="justificacao">Como demonstrei que atingi estes objetivos?</label>
            <span className="hint prose" id="justificacao-hint">Conta o que fizeste, em que situação e o que aprendeste.</span>
            <p className="selected-codes" aria-live="polite">Objetivos selecionados: <strong>{codes}</strong></p>
            <textarea id="justificacao" aria-describedby="justificacao-hint" value={justification} required
              onChange={(e) => { setText(e.target.value); remember(selection, e.target.value); }} />
            {tooLong && <span className="hint" role="alert">O texto tem mais de {MAX} caracteres.</span>}
          </div>

          <p className="label">Anexos (opcional)</p>
          <AttachmentList attachments={[...carriedAttachments, ...currentAttachments]} busy={action.busy}
            onRemove={r?.status === 'rascunho' ? (id) => action.run(() => call('remove_attachment', { p_attachment: id })) : undefined} />
          <ErrorBox error={uploadError} />
          <label className="btn secondary attach-btn">
            <Paperclip size={16} aria-hidden="true" /> {uploading ? `A carregar ${uploading}…` : 'Juntar ficheiro'}
            <input ref={fileInput} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,application/pdf" multiple
              disabled={!!uploading || action.busy} onChange={(e) => onFiles(e.target.files)} />
          </label>
        </div>
      )}

      <ErrorBox error={action.error} />
      <div className="btn-row">
        <button type="button" className="btn" disabled={!selection.length || !justification.trim() || tooLong || action.busy}
          onClick={() => { action.clear(); setStep('resumo'); }}>
          Rever e enviar
        </button>
      </div>
      {!selection.length && <p className="faint prose">Seleciona um ou vários objetivos que consideras ter atingido.</p>}
      {!r && historicalEnabled && (
        <p className="faint prose">Já concluíste este trilho antes de usar a aplicação? Usa o <Link to="/progresso-anterior">progresso anterior</Link>.</p>
      )}
    </section>
  );
}
