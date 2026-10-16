// Movimentos (só para quem gere): lista com filtros e CSV, registo, alteração,
// correção ligada ao original, anulação com motivo, comprovativos e histórico.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Minus, Paperclip, Plus } from 'lucide-react';
import { Badge, ConfirmButton, Empty, ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { downloadFile, eurosInput, formatDay, formatEuros, formatLisbon, parseEuros, todayLisbon, toCsv } from '../common';
import { listModuleFiles, openModuleFile, removeModuleFile, uploadModuleFile } from '../files';
import {
  KIND_LABEL, STATE_LABEL, STATE_TONE, csvEuros, filtersFrom, newClientKey, periodLabel, useActivities, useAllMovements, useHistory,
  useMembersFin, useOptions, useSearchMovements, useSectionId, type Kind, type MovState, type Movement,
} from './api';
import { MovementList } from './Dashboard';
import { FiltersBar, useCanManage } from './shared';
import { DateInput } from '../../components/DateInput';

export function MovementsPage() {
  const [params] = useSearchParams();
  const f = filtersFrom(params);
  const canManage = useCanManage();
  const q = useSearchMovements(f, canManage);
  const list = q.data?.items ?? [];

  const exportCsv = () => {
    const head = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Valor (€)', 'Estado', 'Atividade'];
    const rows: (string | number | null | undefined)[][] = [
      canManage ? [...head, 'Conta/caixa', 'Membro', 'Anulado'] : head,
      ...list.map((m) => {
        const base = [formatDay(m.occurred_on), KIND_LABEL[m.kind], m.description, m.category,
          csvEuros(m.kind === 'despesa' ? -m.amount_cents : m.amount_cents), STATE_LABEL[m.state], m.activity_title];
        return canManage ? [...base, m.account_name, m.member_name, m.voided_at ? 'sim' : 'não'] : base;
      }),
    ];
    downloadFile(`tesouraria-movimentos-${todayLisbon()}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  };

  return (
    <div className="stack">
      <FiltersBar extended />
      <div className="row between fin-section-head">
        <h2 className="section-title">Movimentos · {periodLabel(f)}</h2>
        <div className="row">
          {canManage && (
            <>
              <Link to="/tesouraria/movimentos/novo?tipo=receita" className="btn"><Plus size={18} aria-hidden="true" /> Nova receita</Link>
              <Link to="/tesouraria/movimentos/novo?tipo=despesa" className="btn secondary"><Minus size={18} aria-hidden="true" /> Nova despesa</Link>
            </>
          )}
          <button type="button" className="btn ghost" onClick={exportCsv} disabled={!list.length}>
            <Download size={18} aria-hidden="true" /> Exportar CSV
          </button>
        </div>
      </div>
      {!canManage && (
        <p className="faint prose">
          Movimentos partilhados com quem tem acesso à tesouraria: data, descrição, categoria, valor e atividade. Os pagamentos
          individuais de outras pessoas aparecem como «Pagamento individual», sem nome; observações e comprovativos são privados.
        </p>
      )}
      {q.isLoading ? <Loading rows={2} /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : !list.length ? (
        <Empty title="Sem movimentos">
          <p>Não há movimentos com estes filtros ou esta pesquisa. Experimenta outro período ou limpa os filtros.</p>
        </Empty>
      ) : (
        <>
          <p className="faint" aria-live="polite">
            {q.data!.total === 1 ? '1 movimento' : `${q.data!.total} movimentos`}
            {q.data!.total > list.length ? ` (a mostrar os ${list.length} mais recentes)` : ''}
          </p>
          <div className="card fin-movs-card"><MovementList items={list} canManage={canManage} label="Lista de movimentos" /></div>
        </>
      )}
    </div>
  );
}

type FormValues = {
  kind: Kind; on: string; description: string; category: string; amount: string; account: string; state: MovState;
  activity: string; member: string; notes: string;
};

const fromMovement = (m: Movement): FormValues => ({
  kind: m.kind, on: m.occurred_on, description: m.description, category: m.category, amount: eurosInput(m.amount_cents),
  account: m.account_id, state: m.state, activity: m.activity_id ?? '', member: m.member_profile_id ?? '', notes: m.notes ?? '',
});

/** Formulário de movimento: criar, alterar ou corrigir. */
function MovementForm({ initial, mode, locked, onSubmit, busy, submitLabel }: {
  initial: FormValues; mode: 'novo' | 'alterar' | 'corrigir'; locked?: boolean; busy: boolean; submitLabel: string;
  onSubmit: (v: FormValues & { cents: number; reason: string; allowExcess: boolean; file: File | null }) => void;
}) {
  const opts = useOptions();
  const acts = useActivities();
  const members = useMembersFin(true);
  const [v, setV] = useState<FormValues>(initial);
  const [reason, setReason] = useState('');
  const [allowExcess, setAllowExcess] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const set = <K extends keyof FormValues>(k: K, val: FormValues[K]) => setV((x) => ({ ...x, [k]: val }));
  const accounts = (opts.data?.accounts ?? []).filter((a) => !a.archived || a.id === initial.account);
  const id = (k: string) => `fin-${mode}-${k}`;
  // Com uma só conta ou caixa ativa, fica escolhida (menos um passo no telemóvel).
  const only = accounts.filter((a) => !a.archived);
  useEffect(() => {
    if (!v.account && only.length === 1) set('account', only[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [only.length]);
  // Data anterior ao saldo inicial que cobre esta conta (ou global): fica registado, mas não soma ao saldo.
  const ref = (opts.data?.opening ?? []).find((o) => o.account_id === null || o.account_id === v.account)?.reference_date;
  const beforeOpening = !!(ref && v.on && v.on < ref && v.state === 'efetivo');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    const cents = parseEuros(v.amount);
    if (!v.on) err.on = 'Indica a data.';
    if (!v.description.trim()) err.description = 'Escreve uma descrição.';
    if (!v.category.trim()) err.category = 'Escolhe ou escreve uma categoria.';
    if (cents == null || cents <= 0) err.amount = 'Indica um valor superior a zero, por exemplo 12,30.';
    if (!v.account) err.account = 'Escolhe a conta ou caixa.';
    if (mode === 'corrigir' && reason.trim().length < 3) err.reason = 'Indica o motivo da correção.';
    if (file && !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) err.file = 'O comprovativo tem de ser PDF, JPG, PNG ou WebP.';
    setErrors(err);
    if (Object.keys(err).length) return;
    onSubmit({ ...v, cents: cents!, reason, allowExcess, file });
  };
  const fe = (k: string) => errors[k] && <span className="fin-error" role="alert">{errors[k]}</span>;

  return (
    <form className="card stack fin-form" onSubmit={submit} noValidate>
      {locked && (
        <Notice kind="info">
          Este movimento é efetivo: só a descrição, a categoria, a atividade e as notas podem ser alteradas. Para mudar o valor, a data,
          o tipo, a conta ou o membro, usa «Corrigir».
        </Notice>
      )}
      <fieldset className="fin-fieldset" disabled={locked}>
        <legend className="label">Tipo</legend>
        <div className="segmented" role="radiogroup" aria-label="Tipo">
          {(['receita', 'despesa'] as const).map((k) => (
            <label key={k} className="segment"><input type="radio" name={id('kind')} checked={v.kind === k} onChange={() => set('kind', k)} /> <span>{KIND_LABEL[k]}</span></label>
          ))}
        </div>
      </fieldset>
      <div className="grid-2">
        <Field label="Data" htmlFor={id('on')}>
          <DateInput id={id('on')} value={v.on} disabled={locked} onChange={(e) => set('on', e.target.value)} aria-invalid={!!errors.on} />
          {fe('on')}
          {beforeOpening && (
            <span className="hint prose" role="note">
              Data anterior ao saldo inicial ({formatDay(ref!)}): o movimento fica registado, mas não soma ao saldo atual porque já está incluído no saldo inicial.
            </span>
          )}
        </Field>
        <Field label="Valor (€)" htmlFor={id('amount')} hint="Em euros, com vírgula: 12,30">
          <input id={id('amount')} inputMode="decimal" autoComplete="off" value={v.amount} disabled={locked} onChange={(e) => set('amount', e.target.value)} aria-invalid={!!errors.amount} />
          {fe('amount')}
        </Field>
      </div>
      <Field label="Descrição" htmlFor={id('description')}>
        <input id={id('description')} maxLength={200} value={v.description} onChange={(e) => set('description', e.target.value)} aria-invalid={!!errors.description} />
        {fe('description')}
      </Field>
      <div className="grid-2">
        <Field label="Categoria" htmlFor={id('category')}>
          <input id={id('category')} list={id('categories')} maxLength={60} value={v.category} onChange={(e) => set('category', e.target.value)} aria-invalid={!!errors.category} />
          <datalist id={id('categories')}>{(opts.data?.categories ?? []).map((c) => <option key={c} value={c} />)}</datalist>
          {fe('category')}
        </Field>
        <Field label="Conta ou caixa" htmlFor={id('account')}>
          <select id={id('account')} value={v.account} disabled={locked} onChange={(e) => set('account', e.target.value)} aria-invalid={!!errors.account}>
            <option value="">Escolhe…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (arquivada)' : ''}</option>)}
          </select>
          {!opts.isLoading && !accounts.length && <span className="hint">Ainda não há contas. <Link to="/tesouraria/contas">Criar conta ou caixa</Link>.</span>}
          {fe('account')}
        </Field>
      </div>
      <Field label="Atividade (opcional)" htmlFor={id('activity')}>
        <select id={id('activity')} value={v.activity} onChange={(e) => set('activity', e.target.value)}>
          <option value="">Nenhuma</option>
          {(acts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.title}{a.day ? ` · ${formatDay(a.day)}` : ''}{a.status === 'cancelado' ? ' (cancelada)' : ''}</option>)}
        </select>
      </Field>
      <details className="fin-more" open={mode !== 'novo' || undefined}>
        <summary>Estado ({STATE_LABEL[v.state].toLowerCase()}) e pagamento individual</summary>
        <div className="stack">
          <fieldset className="fin-fieldset" disabled={locked}>
            <legend className="label">Estado</legend>
            <div className="segmented" role="radiogroup" aria-label="Estado">
              {(['previsto', 'pendente', 'efetivo'] as const).map((k) => (
                <label key={k} className="segment"><input type="radio" name={id('state')} checked={v.state === k} onChange={() => set('state', k)} /> <span>{STATE_LABEL[k]}</span></label>
              ))}
            </div>
            <span className="hint prose">Só os efetivos contam no saldo. Pendente: aguarda confirmação; previsto: ainda vai acontecer.</span>
          </fieldset>
          <Field label="Membro (pagamento individual, opcional)" htmlFor={id('member')}>
            <select id={id('member')} value={v.member} disabled={locked} onChange={(e) => set('member', e.target.value)}>
              <option value="">Nenhum</option>
              {(members.data ?? []).map((m) => <option key={m.profile_id} value={m.profile_id}>{m.full_name}</option>)}
            </select>
            <span className="hint">O nome nunca aparece a quem só consulta a tesouraria.</span>
          </Field>
        </div>
      </details>
      <Field label="Observações (opcional, privadas)" htmlFor={id('notes')}>
        <textarea id={id('notes')} rows={2} maxLength={1000} value={v.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      {mode === 'novo' && (
        <Field label="Comprovativo (opcional)" htmlFor={id('file')} hint="PDF ou imagem; só quem gere a tesouraria o vê.">
          <input id={id('file')} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {fe('file')}
        </Field>
      )}
      {mode === 'corrigir' && (
        <Field label="Motivo da correção" htmlFor={id('reason')}>
          <input id={id('reason')} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!errors.reason} />
          {fe('reason')}
        </Field>
      )}
      {mode !== 'novo' && (
        <label className="checkbox">
          <input type="checkbox" checked={allowExcess} onChange={(e) => setAllowExcess(e.target.checked)} />
          <span>Confirmo um valor acima do que está em falta na quota (se aplicável)</span>
        </label>
      )}
      <div className="btn-row">
        <button type="submit" className="btn" disabled={busy} aria-busy={busy}>{submitLabel}</button>
      </div>
    </form>
  );
}

export function NewMovement() {
  const section = useSectionId();
  const nav = useNavigate();
  const act = useAction();
  const [params] = useSearchParams();
  const [key] = useState(newClientKey);
  const tipo = params.get('tipo');
  const kind: Kind = tipo === 'receita' ? 'receita' : 'despesa';
  const title = tipo === 'receita' ? 'Nova receita' : tipo === 'despesa' ? 'Nova despesa' : 'Novo movimento';
  const initial: FormValues = { kind, on: todayLisbon(), description: '', category: '', amount: '', account: '', state: 'efetivo', activity: '', member: '', notes: '' };
  return (
    <div className="fin-page">
      <PageTitle title={title} back="/tesouraria" />
      <ErrorBox error={act.error} />
      <MovementForm key={kind} initial={initial} mode="novo" busy={act.busy} submitLabel="Registar movimento" onSubmit={async (v) => {
        const r = await act.run(() => call<string>('fin_create_movement', {
          p_section: section, p_kind: v.kind, p_on: v.on, p_description: v.description, p_category: v.category, p_amount: v.cents,
          p_account: v.account, p_state: v.state, p_activity: v.activity || null, p_member: v.member || null, p_notes: v.notes || null, p_client_key: key,
        }));
        if (!r.ok) return;
        // O comprovativo vai depois de o movimento existir; se falhar, o movimento fica e o aviso aparece no detalhe.
        let proof = '';
        if (v.file) {
          try { await uploadModuleFile(section, 'tesouraria', 'movimento', r.value!, v.file); } catch { proof = '&comprovativo=erro'; }
        }
        nav(`/tesouraria/movimentos/${r.value}?registado=1${proof}`, { replace: true });
      }} />
    </div>
  );
}

export function MovementDetail() {
  const { id = '' } = useParams();
  const section = useSectionId();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const q = useAllMovements();
  const act = useAction();
  const [mode, setMode] = useState<'ver' | 'alterar' | 'corrigir'>('ver');
  const [reason, setReason] = useState('');
  const m = q.data?.find((x) => x.id === id);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  if (!m) return (<><PageTitle title="Movimento" back="/tesouraria/movimentos" /><Empty title="Registo não encontrado" /></>);

  const signed = m.kind === 'despesa' ? -m.amount_cents : m.amount_cents;
  return (
    <div className="fin-page stack">
      <PageTitle title={m.description} back="/tesouraria/movimentos" subtitle={`${KIND_LABEL[m.kind]} · ${formatDay(m.occurred_on)}`} />
      {params.get('registado') && !act.success && mode === 'ver' && <Notice kind="success">Movimento registado.</Notice>}
      {params.get('comprovativo') === 'erro' && <Notice kind="warn">O movimento ficou registado, mas não foi possível anexar o comprovativo. Tenta de novo em «Comprovativos».</Notice>}
      {act.success && <Notice kind="success">{act.success}</Notice>}
      <ErrorBox error={act.error} />
      {m.voided_at && (
        <Notice kind="warn">
          {m.replaced_by ? 'Corrigido' : 'Anulado'} em {formatLisbon(m.voided_at)}{m.voided_by_name ? ` por ${m.voided_by_name}` : ''}: {m.void_reason}.
          {m.replaced_by && <> <Link to={`/tesouraria/movimentos/${m.replaced_by}`}>Ver o movimento de correção</Link>.</>}
          {' '}Não conta nos saldos.
        </Notice>
      )}
      {m.corrects_id && <Notice kind="info">Este movimento corrige um anterior. <Link to={`/tesouraria/movimentos/${m.corrects_id}`}>Ver o original</Link>.</Notice>}

      {mode === 'ver' && (
        <div className="card">
          <div className="row between">
            <span className={`fin-amount fin-big ${signed < 0 ? 'neg' : 'pos'}`}>{formatEuros(signed)}</span>
            {!m.voided_at && <Badge label={STATE_LABEL[m.state]} tone={STATE_TONE[m.state]} />}
          </div>
          <dl className="fin-dl">
            <dt>Categoria</dt><dd>{m.category}</dd>
            <dt>Conta ou caixa</dt><dd>{m.account_name}</dd>
            <dt>Atividade</dt><dd>{m.activity_title ?? '—'}</dd>
            <dt>Membro</dt><dd>{m.member_name ?? '—'}</dd>
            {m.quota_name && (<><dt>Quota</dt><dd>{m.quota_name}</dd></>)}
            {m.notes && (<><dt>Observações</dt><dd className="prose">{m.notes}</dd></>)}
            <dt>Registado</dt><dd>{formatLisbon(m.created_at)}{m.created_by_name ? ` · ${m.created_by_name}` : ''}</dd>
            {m.updated_by_name && (<><dt>Última alteração</dt><dd>{formatLisbon(m.updated_at)} · {m.updated_by_name}</dd></>)}
          </dl>
          {!m.voided_at && (
            <div className="btn-row">
              <button type="button" className="btn secondary" onClick={() => { act.clear(); setMode('alterar'); }}>Alterar</button>
              <button type="button" className="btn secondary" onClick={() => { act.clear(); setMode('corrigir'); }}>Corrigir</button>
            </div>
          )}
          {!m.voided_at && (
            <div className="fin-void">
              <Field label="Motivo da anulação" htmlFor="fin-void-reason">
                <input id="fin-void-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <ConfirmButton className="btn ghost danger" disabled={reason.trim().length < 3 || act.busy} confirmLabel="Anular movimento"
                description="O movimento fica registado como anulado e deixa de contar nos saldos. Não é apagado."
                onConfirm={() => act.run(() => call('fin_void_movement', { p_section: section, p_id: m.id, p_reason: reason }), 'Movimento anulado.')}>
                Anular…
              </ConfirmButton>
            </div>
          )}
        </div>
      )}

      {mode !== 'ver' && (
        <>
          <div className="row"><button type="button" className="btn ghost" onClick={() => setMode('ver')}>Cancelar</button></div>
          <MovementForm initial={fromMovement(m)} mode={mode} locked={mode === 'alterar' && m.state === 'efetivo'} busy={act.busy}
            submitLabel={mode === 'alterar' ? 'Guardar alterações' : 'Registar correção'}
            onSubmit={async (v) => {
              const base = {
                p_section: section, p_id: m.id, p_kind: v.kind, p_on: v.on, p_description: v.description, p_category: v.category, p_amount: v.cents,
                p_account: v.account, p_state: v.state, p_activity: v.activity || null, p_member: v.member || null, p_notes: v.notes || null,
                p_allow_excess: v.allowExcess,
              };
              if (mode === 'alterar') {
                const r = await act.run(() => call('fin_update_movement', base), 'Alterações guardadas.');
                if (r.ok) setMode('ver');
              } else {
                const r = await act.run(() => call<string>('fin_correct_movement', { ...base, p_reason: v.reason }), 'Correção registada.');
                if (r.ok) { setMode('ver'); nav(`/tesouraria/movimentos/${r.value}`); }
              }
            }} />
        </>
      )}

      <Proofs movementId={m.id} canWrite={!m.voided_at} />
      <History id={m.id} />
    </div>
  );
}

/** Comprovativos (anexos privados: quem gere e o próprio membro). */
export function Proofs({ movementId, canWrite }: { movementId: string; canWrite: boolean }) {
  const section = useSectionId();
  const act = useAction();
  const files = useQuery({ queryKey: ['fin', 'files', section, movementId], queryFn: () => listModuleFiles(section, 'tesouraria', 'movimento', movementId) });
  return (
    <section className="card" aria-labelledby={`proofs-${movementId}`}>
      <h2 id={`proofs-${movementId}`} className="card-title">Comprovativos</h2>
      <ErrorBox error={act.error} />
      {act.success && <Notice kind="success">{act.success}</Notice>}
      {files.isLoading ? <Loading compact /> : files.error ? <ErrorBox error={files.error} /> : !files.data?.length ? (
        <p className="faint">Sem comprovativos.</p>
      ) : (
        <ul className="list">
          {files.data.map((f) => (
            <li key={f.path} className="list-item">
              <FileText size={18} aria-hidden="true" />
              <button type="button" className="btn ghost grow fin-file" onClick={() => act.run(() => openModuleFile(f.path))}>{f.file_name}</button>
              {canWrite && (
                <ConfirmButton className="btn ghost" confirmLabel="Retirar" description="O anexo deixa de estar visível, mas fica registado."
                  onConfirm={() => act.run(() => removeModuleFile(f.path), 'Comprovativo retirado.')}>Retirar</ConfirmButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <label className="btn secondary fin-upload">
          <Paperclip size={18} aria-hidden="true" /> Anexar comprovativo (PDF ou imagem)
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) act.run(() => uploadModuleFile(section, 'tesouraria', 'movimento', movementId, file), 'Comprovativo anexado.');
          }} />
        </label>
      )}
    </section>
  );
}

const ACTION_LABEL: Record<string, string> = {
  criado: 'Criado', alterado: 'Alterado', anulado: 'Anulado', corrigido: 'Corrigido', isentado: 'Isentado', arquivado: 'Arquivado', passado_a_real: 'Passado a dados reais',
};
const FIELD_LABEL: Record<string, string> = {
  kind: 'tipo', occurred_on: 'data', description: 'descrição', category: 'categoria', amount_cents: 'valor', account_id: 'conta', activity_id: 'atividade',
  member_profile_id: 'membro', quota_charge_id: 'quota', state: 'estado', notes: 'notas', void_reason: 'motivo', replaced_by: 'substituído por',
};
const showVal = (k: string, v: unknown) => (v == null ? '—' : k === 'amount_cents' ? formatEuros(Number(v)) : k === 'occurred_on' ? formatDay(String(v))
  : k.endsWith('_id') || k === 'replaced_by' ? 'alterado' : String(v));

export function History({ id }: { id: string }) {
  const h = useHistory(id);
  return (
    <section className="card" aria-labelledby={`hist-${id}`}>
      <h2 id={`hist-${id}`} className="card-title">Histórico</h2>
      {h.isLoading ? <Loading compact /> : h.error ? <ErrorBox error={h.error} /> : (
        <ol className="timeline fin-history">
          {(h.data ?? []).map((r) => {
            const changes = r.action === 'criado' ? [] : Object.keys(r.new_values ?? {}).filter((k) => FIELD_LABEL[k]);
            return (
              <li key={r.id}>
                <strong>{ACTION_LABEL[r.action] ?? r.action}</strong> · {formatLisbon(r.at)}{r.actor_name ? ` · ${r.actor_name}` : ''}
                {changes.length > 0 && (
                  <ul className="fin-changes">
                    {changes.map((k) => (
                      <li key={k}>{FIELD_LABEL[k]}: {showVal(k, r.old_values?.[k])} → {showVal(k, r.new_values?.[k])}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
