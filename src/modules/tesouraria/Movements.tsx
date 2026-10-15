// Movimentos (só para quem gere): lista com filtros e CSV, registo, alteração,
// correção ligada ao original, anulação com motivo, comprovativos e histórico.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Paperclip, Plus } from 'lucide-react';
import { Badge, ConfirmButton, Empty, ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { downloadFile, eurosInput, formatDay, formatEuros, formatLisbon, parseEuros, todayLisbon, toCsv } from '../common';
import { listModuleFiles, openModuleFile, removeModuleFile, uploadModuleFile } from '../files';
import {
  KIND_LABEL, STATE_LABEL, STATE_TONE, csvEuros, filtersFrom, newClientKey, periodLabel, useActivities, useHistory, useMembersFin,
  useMovements, useOptions, useSectionId, type Kind, type MovState, type Movement,
} from './api';
import { FiltersBar } from './shared';

export function MovementsPage() {
  const [params] = useSearchParams();
  const f = filtersFrom(params);
  const q = useMovements(f);
  const list = q.data ?? [];

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [
      ['Data', 'Tipo', 'Descrição', 'Categoria', 'Valor (€)', 'Estado', 'Conta/caixa', 'Atividade', 'Membro', 'Quota', 'Anulado', 'Motivo', 'Registado por', 'Registado em'],
      ...list.map((m) => [
        formatDay(m.occurred_on), KIND_LABEL[m.kind], m.description, m.category, csvEuros(m.kind === 'despesa' ? -m.amount_cents : m.amount_cents),
        STATE_LABEL[m.state], m.account_name, m.activity_title, m.member_name, m.quota_name, m.voided_at ? 'sim' : 'não', m.void_reason,
        m.created_by_name, formatLisbon(m.created_at),
      ]),
    ];
    downloadFile(`tesouraria-movimentos-${todayLisbon()}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  };

  return (
    <div className="stack">
      <FiltersBar withState />
      <div className="row between fin-section-head">
        <h2 className="section-title">Movimentos · {periodLabel(f)}</h2>
        <div className="row">
          <Link to="/tesouraria/movimentos/novo" className="btn"><Plus size={18} aria-hidden="true" /> Novo movimento</Link>
          <button type="button" className="btn secondary" onClick={exportCsv} disabled={!list.length}>
            <Download size={18} aria-hidden="true" /> Exportar CSV
          </button>
        </div>
      </div>
      {q.isLoading ? <Loading rows={2} /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : !list.length ? (
        <Empty title="Sem movimentos">
          <p>Não há movimentos com estes filtros. Regista um com «Novo movimento» ou limpa os filtros.</p>
        </Empty>
      ) : (
        <ul className="list card fin-movs" aria-label="Lista de movimentos">
          {list.map((m) => (
            <li key={m.id} className={m.voided_at ? 'is-voided' : undefined}>
              <Link className="list-item" to={`/tesouraria/movimentos/${m.id}`}>
                <span className="fin-date">{formatDay(m.occurred_on)}</span>
                <span className="grow">
                  <span className="fin-desc">{m.description}</span>
                  <span className="faint fin-sub">
                    {m.category}{m.activity_title ? ` · ${m.activity_title}` : ''}{m.member_name ? ` · ${m.member_name}` : ''}
                    {m.files > 0 && <> · <Paperclip size={12} aria-label="Com comprovativo" /></>}
                  </span>
                </span>
                {m.voided_at ? <Badge label={m.replaced_by ? 'Corrigido' : 'Anulado'} tone="muted" /> : <Badge label={STATE_LABEL[m.state]} tone={STATE_TONE[m.state]} />}
                <span className={`fin-amount ${m.kind === 'despesa' ? 'neg' : 'pos'}`}>{formatEuros(m.kind === 'despesa' ? -m.amount_cents : m.amount_cents)}</span>
              </Link>
            </li>
          ))}
        </ul>
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
  onSubmit: (v: FormValues & { cents: number; reason: string; allowExcess: boolean }) => void;
}) {
  const opts = useOptions();
  const acts = useActivities();
  const members = useMembersFin(true);
  const [v, setV] = useState<FormValues>(initial);
  const [reason, setReason] = useState('');
  const [allowExcess, setAllowExcess] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof FormValues>(k: K, val: FormValues[K]) => setV((x) => ({ ...x, [k]: val }));
  const accounts = (opts.data?.accounts ?? []).filter((a) => !a.archived || a.id === initial.account);
  const id = (k: string) => `fin-${mode}-${k}`;

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
    setErrors(err);
    if (Object.keys(err).length) return;
    onSubmit({ ...v, cents: cents!, reason, allowExcess });
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
          <input id={id('on')} type="date" value={v.on} disabled={locked} onChange={(e) => set('on', e.target.value)} aria-invalid={!!errors.on} />
          {fe('on')}
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
      <fieldset className="fin-fieldset" disabled={locked}>
        <legend className="label">Estado</legend>
        <div className="segmented" role="radiogroup" aria-label="Estado">
          {(['previsto', 'pendente', 'efetivo'] as const).map((k) => (
            <label key={k} className="segment"><input type="radio" name={id('state')} checked={v.state === k} onChange={() => set('state', k)} /> <span>{STATE_LABEL[k]}</span></label>
          ))}
        </div>
        <span className="hint prose">Só os efetivos contam no saldo. Pendente: aguarda confirmação; previsto: ainda vai acontecer.</span>
      </fieldset>
      <div className="grid-2">
        <Field label="Atividade (opcional)" htmlFor={id('activity')}>
          <select id={id('activity')} value={v.activity} onChange={(e) => set('activity', e.target.value)}>
            <option value="">Nenhuma</option>
            {(acts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.title}{a.day ? ` · ${formatDay(a.day)}` : ''}{a.status === 'cancelado' ? ' (cancelada)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Membro (pagamento individual, opcional)" htmlFor={id('member')}>
          <select id={id('member')} value={v.member} disabled={locked} onChange={(e) => set('member', e.target.value)}>
            <option value="">Nenhum</option>
            {(members.data ?? []).map((m) => <option key={m.profile_id} value={m.profile_id}>{m.full_name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notas (opcional)" htmlFor={id('notes')}>
        <textarea id={id('notes')} rows={2} maxLength={1000} value={v.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
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
  const [key] = useState(newClientKey);
  const initial: FormValues = { kind: 'despesa', on: todayLisbon(), description: '', category: '', amount: '', account: '', state: 'efetivo', activity: '', member: '', notes: '' };
  return (
    <div className="fin-page">
      <PageTitle title="Novo movimento" back="/tesouraria/movimentos" />
      <ErrorBox error={act.error} />
      <MovementForm initial={initial} mode="novo" busy={act.busy} submitLabel="Registar movimento" onSubmit={async (v) => {
        const r = await act.run(() => call<string>('fin_create_movement', {
          p_section: section, p_kind: v.kind, p_on: v.on, p_description: v.description, p_category: v.category, p_amount: v.cents,
          p_account: v.account, p_state: v.state, p_activity: v.activity || null, p_member: v.member || null, p_notes: v.notes || null, p_client_key: key,
        }));
        if (r.ok) nav(`/tesouraria/movimentos/${r.value}?registado=1`, { replace: true });
      }} />
    </div>
  );
}

export function MovementDetail() {
  const { id = '' } = useParams();
  const section = useSectionId();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const q = useMovements({ de: null, ate: null, categoria: null, atividade: null, estado: null });
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
            {m.notes && (<><dt>Notas</dt><dd className="prose">{m.notes}</dd></>)}
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

function History({ id }: { id: string }) {
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
