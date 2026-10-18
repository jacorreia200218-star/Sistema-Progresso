// Configuração da tesouraria (só para quem gere): saldo inicial, contas e caixas, categorias em
// uso. Arquivar/anular em vez de apagar. «?configurar=1» (vindo do painel) abre logo o que falta.
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { ConfirmButton, ErrorBox, Field, Loading, Notice } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { eurosInput, formatDay, formatEuros, formatLisbon, parseEuros, todayLisbon } from '../common';
import { useOpeningBalances, useOptions, useSectionId, type Account, type Opening } from './api';
import { History } from './Movements';
import { DateInput } from '../../components/DateInput';

export function AccountsPage() {
  const opts = useOptions();
  const [params] = useSearchParams();
  const setup = params.get('configurar') === '1';
  const [adding, setAdding] = useState(false);
  // Vindo de «Configurar saldo inicial» com o saldo já definido mas sem contas: abre a nova conta.
  const needsAccount = setup && !!opts.data && !opts.data.accounts.length && opts.data.opening.length > 0;
  useEffect(() => { if (needsAccount) setAdding(true); }, [needsAccount]);
  const categories = opts.data?.categories ?? [];
  return (
    <div className="stack">
      <OpeningSection autoOpen={setup} />
      <section className="card stack" aria-labelledby="fin-acc-t">
        <div className="row between fin-card-head">
          <h2 id="fin-acc-t" className="card-title">Contas e caixas</h2>
          {!adding && <button type="button" className="btn secondary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Nova conta ou caixa</button>}
        </div>
        {adding && <AccountForm onClose={() => setAdding(false)} />}
        {opts.isLoading ? <Loading rows={1} /> : opts.error ? <ErrorBox error={opts.error} retry={opts.refetch} /> : !opts.data?.accounts.length ? (
          <p className="faint">Ainda não há contas nem caixas. Cria, por exemplo, «Caixa» e «Conta bancária».</p>
        ) : (
          <ul className="list">
            {opts.data.accounts.map((a) => <AccountRow key={a.id} a={a} />)}
          </ul>
        )}
      </section>
      <section className="card stack" aria-labelledby="fin-cat-t">
        <h2 id="fin-cat-t" className="card-title">Categorias</h2>
        {categories.length ? (
          <ul className="fin-chips" aria-label="Categorias em uso">
            {categories.map((c) => <li key={c} className="fin-chip">{c}</li>)}
          </ul>
        ) : !opts.isLoading && <p className="faint">Ainda não há categorias.</p>}
        <p className="faint fin-note">Para criar uma nova, escreve-a ao registar o movimento.</p>
      </section>
    </div>
  );
}

function AccountForm({ onClose }: { onClose: () => void }) {
  const section = useSectionId();
  const act = useAction();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'conta' | 'caixa'>('caixa');
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr('Indica o nome.');
    setErr(null);
    const r = await act.run(() => call('fin_save_account', { p_section: section, p_id: null, p_name: name, p_kind: kind, p_archived: false }), 'Conta ou caixa criada.');
    if (r.ok) setName('');
  };
  return (
    <form className="card flat stack" onSubmit={submit} noValidate aria-label="Nova conta ou caixa">
      {err && <Notice kind="error">{err}</Notice>}
      {act.success && <Notice kind="success">{act.success}</Notice>}
      <ErrorBox error={act.error} />
      <div className="grid-2">
        <Field label="Nome" htmlFor="acc-name"><input type="text" id="acc-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Tipo" htmlFor="acc-kind">
          <select id="acc-kind" value={kind} onChange={(e) => setKind(e.target.value as 'conta' | 'caixa')}>
            <option value="caixa">Caixa (numerário)</option>
            <option value="conta">Conta bancária</option>
          </select>
        </Field>
      </div>
      <div className="btn-row">
        <button type="submit" className="btn" disabled={act.busy}>Criar</button>
        <button type="button" className="btn secondary" onClick={onClose}>Fechar</button>
      </div>
    </form>
  );
}

function AccountRow({ a }: { a: Account }) {
  const section = useSectionId();
  const act = useAction();
  return (
    <li>
      <div className="list-item">
        <span className="grow">{a.name} <span className="faint">· {a.kind === 'caixa' ? 'caixa' : 'conta'}{a.archived ? ' · arquivada' : ''}</span></span>
        <button type="button" className="btn ghost" disabled={act.busy}
          onClick={() => act.run(() => call('fin_save_account', { p_section: section, p_id: a.id, p_name: a.name, p_kind: a.kind, p_archived: !a.archived }), a.archived ? 'Reativada.' : 'Arquivada.')}>
          {a.archived ? 'Reativar' : 'Arquivar'}
        </button>
      </div>
      <ErrorBox error={act.error} />
    </li>
  );
}

/** Saldo inicial: global ou por conta/caixa, com data de referência; alterações auditadas, anulação com motivo. */
function OpeningSection({ autoOpen }: { autoOpen?: boolean }) {
  const q = useOpeningBalances();
  const [editing, setEditing] = useState<Opening | 'novo' | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const active = (q.data ?? []).filter((o) => !o.voided_at);
  const voided = (q.data ?? []).filter((o) => o.voided_at);
  const none = !!q.data && active.length === 0;
  useEffect(() => { if (autoOpen && none) setEditing('novo'); }, [autoOpen, none]);
  const perAccount = active.length > 0 && active.every((o) => o.account_id);
  return (
    <section className="card stack" aria-labelledby="fin-open-t">
      <h2 id="fin-open-t" className="card-title">Saldo inicial</h2>
      {q.isLoading ? <Loading rows={1} /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : (
        <>
          {done && <Notice kind="success">{done}</Notice>}
          {!active.length ? <p className="faint" data-testid="saldo-inicial-vazio">Ainda não configurado: o saldo atual não está confirmado.</p> : (
            <ul className="list">
              {active.map((o) => <OpeningRow key={o.id} o={o} onEdit={() => { setDone(null); setEditing(o); }} />)}
            </ul>
          )}
          {editing ? (
            <OpeningForm key={editing === 'novo' ? 'novo' : editing.id} initial={editing === 'novo' ? null : editing}
              hasGlobal={active.some((o) => !o.account_id)} hasAccounts={active.some((o) => o.account_id)} onDone={(m) => { setEditing(null); setDone(m ?? null); }} />
          ) : (
            !active.length ? (
              <div className="row"><button type="button" className="btn" onClick={() => { setDone(null); setEditing('novo'); }}>Configurar saldo inicial</button></div>
            ) : perAccount && (
              <div className="row"><button type="button" className="btn secondary" onClick={() => { setDone(null); setEditing('novo'); }}>Juntar saldo de outra conta</button></div>
            )
          )}
          {voided.length > 0 && (
            <details>
              <summary>Saldos iniciais anulados ({voided.length})</summary>
              <ul className="list">
                {voided.map((o) => (
                  <li key={o.id} className="list-item is-voided">
                    <span className="grow">{o.account_name ?? 'Global'} · {formatEuros(o.amount_cents)} em {formatDay(o.reference_date)}
                      <span className="faint fin-sub">Anulado em {formatLisbon(o.voided_at!)}: {o.void_reason}</span></span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function OpeningRow({ o, onEdit }: { o: Opening; onEdit: () => void }) {
  const section = useSectionId();
  const act = useAction();
  const [reason, setReason] = useState('');
  return (
    <li className="fin-opening-row">
      <div className="list-item">
        <span className="grow">
          <strong>{o.account_name ?? 'Global (todas as contas e caixas)'}</strong>
          <span className="faint fin-sub">
            em {formatDay(o.reference_date)}{o.notes ? ` · ${o.notes}` : ''}
            {o.updated_by_name ? ` · alterado por ${o.updated_by_name}` : o.created_by_name ? ` · definido por ${o.created_by_name}` : ''}
          </span>
        </span>
        <span className="fin-amount" data-testid="saldo-inicial-valor">{formatEuros(o.amount_cents)}</span>
        <button type="button" className="btn ghost" onClick={onEdit}>Alterar</button>
      </div>
      {act.success && <Notice kind="success">{act.success}</Notice>}
      <ErrorBox error={act.error} />
      <details className="fin-opening-more">
        <summary>Histórico e anulação</summary>
        <History id={o.id} />
        <div className="fin-void">
          <Field label="Motivo da anulação" htmlFor={`void-${o.id}`}>
            <input type="text" id={`void-${o.id}`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ConfirmButton className="btn ghost danger" disabled={reason.trim().length < 3 || act.busy} confirmLabel="Anular saldo inicial"
            description="O saldo inicial deixa de contar no cálculo, mas fica registado com o motivo."
            onConfirm={() => act.run(() => call('fin_void_opening_balance', { p_section: section, p_id: o.id, p_reason: reason }), 'Saldo inicial anulado.')}>
            Anular…
          </ConfirmButton>
        </div>
      </details>
    </li>
  );
}

function OpeningForm({ initial, hasGlobal, hasAccounts, onDone }: { initial: Opening | null; hasGlobal: boolean; hasAccounts: boolean; onDone: (msg?: string) => void }) {
  const section = useSectionId();
  const opts = useOptions();
  const act = useAction();
  const [account, setAccount] = useState(initial?.account_id ?? '');
  const [day, setDay] = useState(initial?.reference_date ?? todayLisbon());
  const [amount, setAmount] = useState(initial ? eurosInput(initial.amount_cents) : '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [err, setErr] = useState<string | null>(null);
  const accounts = (opts.data?.accounts ?? []).filter((a) => !a.archived || a.id === initial?.account_id);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseEuros(amount);
    if (!day) return setErr('Indica a data de referência.');
    if (day > todayLisbon()) return setErr('A data de referência não pode ser futura.');
    if (cents == null) return setErr('Indica o valor, por exemplo 250,00 (pode ser 0 ou negativo).');
    setErr(null);
    const r = await act.run(() => call('fin_save_opening_balance', {
      p_section: section, p_id: initial?.id ?? null, p_account: account || null, p_reference_date: day, p_amount: cents, p_notes: notes || null,
    }));
    if (r.ok) onDone(initial ? 'Saldo inicial alterado.' : 'Saldo inicial definido.');
  };
  return (
    <form className="card flat stack" onSubmit={submit} noValidate aria-label={initial ? 'Alterar saldo inicial' : 'Novo saldo inicial'}>
      {err && <Notice kind="error">{err}</Notice>}
      <ErrorBox error={act.error} />
      {!initial && hasGlobal && <Notice kind="info">Já há um saldo inicial global. Para usar saldos por conta, anula-o primeiro.</Notice>}
      {!initial && hasAccounts && <Notice kind="info">Já há saldos iniciais por conta ou caixa: só podes juntar o de outra conta.</Notice>}
      <div className="grid-2">
        <Field label="Aplica-se a" htmlFor="op-account">
          <select id="op-account" value={account} disabled={!!initial} onChange={(e) => setAccount(e.target.value)}>
            <option value="">Global (todas as contas e caixas)</option>
            {accounts.map((a: Account) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Data de referência" htmlFor="op-day" hint="Saldo no início deste dia">
          <DateInput id="op-day" max={todayLisbon()} value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field label="Valor (€)" htmlFor="op-amount" hint="Com vírgula: 250,00">
          <input type="text" id="op-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Notas (opcional)" htmlFor="op-notes">
          <input type="text" id="op-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="btn-row">
        <button type="submit" className="btn" disabled={act.busy}>{initial ? 'Guardar alteração' : 'Guardar saldo inicial'}</button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>Cancelar</button>
      </div>
    </form>
  );
}
