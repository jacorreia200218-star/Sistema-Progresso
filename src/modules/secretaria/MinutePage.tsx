// Ata ou aditamento: texto, fluxo (Rascunho → Em aprovação → Aprovada), histórico de
// versões, correções (nova versão ou aditamento), decisões e tarefas, anexos e impressão.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FilePlus, History, Paperclip, Pencil, Printer, Undo2 } from 'lucide-react';
import { Badge, ConfirmButton, ErrorBox, Field, Loading, MoreMenu, Notice, PageTitle } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { formatDay, formatLisbon } from '../common';
import { Attachments, pickAttachment } from './Attachments';
import { ItemsSection } from './Items';
import { BASE, ITEM_KIND, MINUTE_STATUS, docLabel, useMinute, useSectionId } from './api';

export function MinutePage() {
  const { id } = useParams();
  const section = useSectionId();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const asked = params.get('versao');
  const version = asked && /^\d+$/.test(asked) ? Number(asked) : null;
  const q = useMinute(id, version);
  const action = useAction();
  const [body, setBody] = useState('');
  const [loadedFor, setLoadedFor] = useState('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [mode, setMode] = useState<'' | 'devolver' | 'corrigir'>('');

  const d = q.data;
  const key = d ? `${d.minute.id}:${d.version.version_no}:${d.version.updated_at}` : '';
  useEffect(() => {
    if (d && key !== loadedFor) { setBody(d.version.body); setLoadedFor(key); }
  }, [d, key, loadedFor]);

  if (q.isLoading) return <Loading />;
  if (q.error || !d) return (<><PageTitle title="Ata" back={BASE} /><ErrorBox error={q.error ?? 'Registo não encontrado.'} /></>);

  const v = d.version;
  const isCurrent = v.version_no === d.minute.current_version;
  const editable = d.can_edit && isCurrent && !v.frozen;
  const dirty = editable && body !== v.body;
  const c = v.content;
  const goVersion = (n: number | null) => setParams(() => {
    const next = new URLSearchParams(window.location.search);
    if (n == null) next.delete('versao'); else next.set('versao', String(n));
    return next;
  });
  const exp = d.minute.current_version;

  const save = () => action.run(() => call('sec_minute_save', { p_section: section, p_minute: d.minute.id, p_body: body, p_expected_version: exp }), 'Texto guardado.');
  const submit = () => action.run(() => call('sec_minute_submit', { p_section: section, p_minute: d.minute.id, p_expected_version: exp }), 'Enviada para aprovação.');
  const approve = () => action.run(() => call('sec_minute_approve', { p_section: section, p_minute: d.minute.id, p_expected_version: exp }), 'Ata aprovada.');
  const giveBack = async () => {
    const r = await action.run(() => call('sec_minute_return', { p_section: section, p_minute: d.minute.id, p_reason: reason.trim() || null }), 'Voltou a rascunho.');
    if (r.ok) { setMode(''); setReason(''); goVersion(null); }
  };
  const revise = async () => {
    if (!reason.trim()) { setReasonError('Indica o motivo da correção.'); return; }
    setReasonError('');
    const r = await action.run(() => call<number>('sec_minute_revise', { p_section: section, p_minute: d.minute.id, p_reason: reason.trim() }), 'Nova versão criada em rascunho. A versão aprovada continua disponível no histórico.');
    if (r.ok) { setMode(''); setReason(''); goVersion(null); }
  };
  const addendum = async () => {
    const r = await action.run(() => call<string>('sec_minute_create', { p_section: section, p_meeting: d.meeting.id, p_kind: 'aditamento', p_body: '' }));
    if (r.ok) navigate(`${BASE}/atas/${r.value}`);
  };

  const canCorrect = isCurrent && (d.can_revise || d.can_addendum);
  const pick = (m: typeof mode) => { action.clear(); setReason(''); setReasonError(''); setMode(m); };
  const label = docLabel(d.minute.kind);
  const status = MINUTE_STATUS[d.minute.status];
  return (
    <>
      <PageTitle title={`${label} · ${d.meeting.title}`} back={`${BASE}/reunioes/${d.meeting.id}`}
        actions={<>
          <Link className="btn secondary" to={`${BASE}/atas/${d.minute.id}/imprimir?versao=${v.version_no}`}>
            <Printer size={16} aria-hidden="true" /> Imprimir / PDF
          </Link>
          {(canCorrect || d.can_edit || (isCurrent && d.can_return)) && (
            <MoreMenu>
              {d.can_revise && <button type="button" className="btn" onClick={() => pick('corrigir')}><Pencil size={16} aria-hidden="true" /> Corrigir com nova versão</button>}
              {d.can_addendum && <button type="button" className="btn" disabled={action.busy} onClick={addendum}><FilePlus size={16} aria-hidden="true" /> Criar aditamento</button>}
              {isCurrent && d.can_return && <button type="button" className="btn" onClick={() => pick('devolver')}><Undo2 size={16} aria-hidden="true" /> Voltar a rascunho</button>}
              {d.can_edit && <button type="button" className="btn" onClick={() => pickAttachment(d.minute.id)}><Paperclip size={16} aria-hidden="true" /> Anexar ficheiro</button>}
            </MoreMenu>
          )}
        </>} />
      <div className="sec-status-bar">
        <Badge {...status} />
        <span className="faint sec-meta">Reunião de {formatLisbon(d.meeting.starts_at)}</span>
        <span className="faint sec-meta">· versão {d.minute.current_version}</span>
        {d.minute.approved_version && d.minute.status !== 'aprovada' && (
          <span className="faint sec-meta">· versão aprovada em vigor: {d.minute.approved_version}</span>
        )}
      </div>
      {d.parent && <Notice>Aditamento à <Link to={`${BASE}/atas/${d.parent.id}`}>ata aprovada</Link>.</Notice>}
      {!isCurrent && (
        <Notice kind="warn">
          Estás a ver a versão {v.version_no}{v.approved_at ? ', aprovada' : ''}. <button type="button" className="link-btn" onClick={() => goVersion(null)}>Ver a versão atual</button>
        </Notice>
      )}
      {d.meeting.status === 'anulada' && <Notice kind="warn">A reunião foi anulada. O documento fica só para consulta.</Notice>}
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}

      <section className="card" aria-labelledby="sec-body-h">
        <h2 className="sec-h2" id="sec-body-h">Texto {d.minute.kind === 'ata' ? 'da ata' : 'do aditamento'}</h2>
        {v.note && <p className="faint sec-meta">{v.note}</p>}
        {editable ? (
          <>
            <Field label="Texto" htmlFor="sec-body" hint="O que foi tratado e decidido. Decisões, tarefas e preparativos acrescentam-se em baixo.">
              <textarea id="sec-body" rows={12} maxLength={50000} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            <div className="btn-row">
              <button type="button" className="btn secondary" disabled={!dirty || action.busy} onClick={save}>{action.busy ? 'A guardar…' : 'Guardar texto'}</button>
              {d.can_submit && (
                <ConfirmButton className="btn" disabled={dirty || action.busy || !v.body.trim()} confirmLabel="Enviar para aprovação" onConfirm={submit}
                  description="A versão fica fechada e quem aprova é avisado. Para mudar depois, terá de voltar a rascunho.">
                  Enviar para aprovação
                </ConfirmButton>
              )}
            </div>
            {dirty && <p className="faint sec-meta">Tens alterações por guardar.</p>}
            {!dirty && !v.body.trim() && <p className="faint sec-meta">Escreve e guarda o texto antes de enviar para aprovação.</p>}
          </>
        ) : (
          v.body.trim() ? <div className="sec-pre sec-body">{v.body}</div> : <p className="faint">Sem texto.</p>
        )}
        {v.frozen && (
          <p className="faint sec-meta">
            Fechada em {formatLisbon(v.frozen_at!)}{v.submitted_by_name ? ` por ${v.submitted_by_name}` : ''}
            {v.approved_at && ` · aprovada em ${formatLisbon(v.approved_at)} por ${v.approved_by_name}`}
          </p>
        )}
        {isCurrent && d.can_approve && (
          <div className="btn-row">
            <ConfirmButton className="btn" disabled={action.busy} confirmLabel={`Aprovar versão ${v.version_no}`} onConfirm={approve}
              description="Depois de aprovada, a ata não pode ser alterada: correções criam uma nova versão ou um aditamento.">
              Aprovar
            </ConfirmButton>
          </div>
        )}
        {mode === 'devolver' && (
          <div className="sec-inline-form">
            <Field label="Motivo (opcional)" htmlFor="sec-return">
              <input id="sec-return" type="text" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="btn-row">
              <button type="button" className="btn" disabled={action.busy} onClick={giveBack}>Voltar a rascunho</button>
              <button type="button" className="btn secondary" onClick={() => setMode('')}>Cancelar</button>
            </div>
          </div>
        )}
        {canCorrect && mode === '' && (
          <p className="faint sec-meta sec-locked">Aprovada: o texto já não muda. Para corrigir, usa «Mais» (nova versão ou aditamento).</p>
        )}
        {mode === 'corrigir' && (
          <div className="sec-inline-form">
            <Field label="Motivo da correção" htmlFor="sec-revise">
              <input id="sec-revise" type="text" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!reasonError} />
              {reasonError && <span className="sec-error">{reasonError}</span>}
            </Field>
            <div className="btn-row">
              <button type="button" className="btn" disabled={action.busy} onClick={revise}>Criar nova versão</button>
              <button type="button" className="btn secondary" onClick={() => setMode('')}>Cancelar</button>
            </div>
          </div>
        )}
      </section>

      {isCurrent ? (
        <ItemsSection minuteId={d.minute.id} items={d.items} canEdit={editable} />
      ) : (
        <section className="card">
          <h2 className="sec-h2">Decisões, tarefas e preparativos (nesta versão)</h2>
          {c.items.length === 0 ? <p className="faint">Sem registos nesta versão.</p> : (
            <ul className="list sec-items">
              {c.items.map((i, n) => (
                <li key={n} className="sec-item"><div className="grow"><p className="sec-item-text"><span className="sec-kind">{ITEM_KIND[i.kind] ?? 'Registo'}</span> {i.text}</p>
                  <p className="faint sec-meta">{i.kind === 'decisao' ? i.responsible_name ?? '' : i.responsible_name ?? 'Responsável por definir'}{i.due_date ? ` · prazo ${formatDay(i.due_date)}` : ''}</p></div></li>
              ))}
            </ul>
          )}
        </section>
      )}

      {d.addenda.length > 0 && (
        <section className="card">
          <h2 className="sec-h2">Aditamentos</h2>
          <ul className="list">
            {d.addenda.map((a, n) => (
              <li key={a.id}><Link className="list-item" to={`${BASE}/atas/${a.id}`}>
                <span className="grow">Aditamento {n + 1} · {formatLisbon(a.created_at)}</span><Badge {...MINUTE_STATUS[a.status]} />
              </Link></li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="sec-hist-h">
        <h2 className="sec-h2" id="sec-hist-h"><History size={16} aria-hidden="true" /> Histórico de versões</h2>
        <ol className="sec-versions">
          {d.versions.map((x) => (
            <li key={x.version_no} aria-current={x.version_no === v.version_no ? 'true' : undefined}>
              <button type="button" className="link-btn" onClick={() => goVersion(x.version_no === d.minute.current_version ? null : x.version_no)}>
                Versão {x.version_no}
              </button>
              {' '}
              {x.approved_at ? <Badge label={x.version_no === d.minute.approved_version ? 'Aprovada' : 'Aprovada (substituída)'} tone="ok" />
                : x.frozen_at ? <Badge label="Submetida" tone="muted" /> : <Badge label="Rascunho" tone="neutral" />}
              <div className="faint sec-meta">
                Criada em {formatLisbon(x.created_at)} por {x.created_by_name}
                {x.approved_at && ` · aprovada por ${x.approved_by_name} em ${formatLisbon(x.approved_at)}`}
                {x.note && ` · ${x.note}`}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <Attachments entity="sec_minute" entityId={d.minute.id} canWrite={d.can_edit} />
    </>
  );
}
