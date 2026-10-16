// Quotas (só para quem gere): definir por período e valor, aplicar a membros (com fração
// opcional), registar pagamentos (o pagamento é o movimento), isentar e anular.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Badge, ConfirmButton, Empty, ErrorBox, Field, Loading, Notice } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { eurosInput, formatDay, formatEuros, parseEuros, todayLisbon } from '../common';
import { newClientKey, useMembersFin, useOptions, useQuotas, useSectionId, type Charge, type MovState, type Quota } from './api';
import { DateInput } from '../../components/DateInput';

export function QuotasPage() {
  const q = useQuotas();
  const [showNew, setShowNew] = useState(false);
  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="btn" aria-expanded={showNew} onClick={() => setShowNew((x) => !x)}><Plus size={18} aria-hidden="true" /> Nova quota</button>
      </div>
      {showNew && <QuotaForm onDone={() => setShowNew(false)} />}
      {q.isLoading ? <Loading rows={2} /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : !q.data?.length ? (
        <Empty title="Ainda não há quotas"><p>Cria uma quota (por exemplo, a quota anual) e aplica-a aos membros.</p></Empty>
      ) : q.data.map((quota) => <QuotaCard key={quota.id} quota={quota} />)}
    </div>
  );
}

function QuotaForm({ quota, onDone }: { quota?: Quota; onDone: () => void }) {
  const section = useSectionId();
  const act = useAction();
  const [name, setName] = useState(quota?.name ?? '');
  const [start, setStart] = useState(quota?.period_start ?? '');
  const [end, setEnd] = useState(quota?.period_end ?? '');
  const [due, setDue] = useState(quota?.due_date ?? '');
  const [amount, setAmount] = useState(quota ? eurosInput(quota.amount_cents) : '');
  const [err, setErr] = useState<string | null>(null);
  const idp = quota ? `q-${quota.id}` : 'q-novo';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseEuros(amount);
    if (!name.trim()) return setErr('Indica o nome da quota.');
    if (!start || !end || end < start) return setErr('Indica um período válido (o fim não pode ser antes do início).');
    if (!due) return setErr('Indica a data limite de pagamento.');
    if (cents == null || cents <= 0) return setErr('Indica um valor superior a zero, por exemplo 25,00.');
    setErr(null);
    const r = await act.run(() => call('fin_save_quota', { p_section: section, p_id: quota?.id ?? null, p_name: name, p_period_start: start, p_period_end: end, p_amount: cents, p_due_date: due }), 'Quota guardada.');
    if (r.ok) onDone();
  };
  return (
    <form className="card stack" onSubmit={submit} noValidate aria-label={quota ? 'Alterar quota' : 'Nova quota'}>
      {err && <Notice kind="error">{err}</Notice>}
      <ErrorBox error={act.error} />
      <Field label="Nome" htmlFor={`${idp}-name`}><input type="text" id={`${idp}-name`} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Quota anual 2026/27" /></Field>
      <div className="grid-2">
        <Field label="Início do período" htmlFor={`${idp}-start`}><DateInput id={`${idp}-start`} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Fim do período" htmlFor={`${idp}-end`}><DateInput id={`${idp}-end`} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Valor por membro (€)" htmlFor={`${idp}-amount`}><input type="text" id={`${idp}-amount`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Data limite" htmlFor={`${idp}-due`}><DateInput id={`${idp}-due`} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      </div>
      {quota && <p className="faint prose">Alterar o valor não muda o devido por quem já tem a quota aplicada.</p>}
      <div className="btn-row">
        <button type="submit" className="btn" disabled={act.busy}>Guardar quota</button>
        <button type="button" className="btn secondary" onClick={onDone}>Cancelar</button>
      </div>
    </form>
  );
}

function QuotaCard({ quota }: { quota: Quota }) {
  const section = useSectionId();
  const act = useAction();
  const [panel, setPanel] = useState<'none' | 'apply' | 'edit'>('none');
  const [voidReason, setVoidReason] = useState('');
  const active = quota.status === 'ativa';
  const paid = quota.charges.filter((c) => c.status === 'ativa' && c.em_falta === 0).length;
  const live = quota.charges.filter((c) => c.status === 'ativa').length;
  return (
    <section className="card stack" aria-labelledby={`quota-${quota.id}`}>
      <div className="row between">
        <div>
          <h2 id={`quota-${quota.id}`} className="card-title">{quota.name}</h2>
          <p className="faint">
            {formatDay(quota.period_start)} a {formatDay(quota.period_end)} · {formatEuros(quota.amount_cents)} por membro · limite {formatDay(quota.due_date)}
          </p>
        </div>
        {active ? <Badge label={`${paid} de ${live} pagas`} tone={paid === live && live > 0 ? 'ok' : 'progress'} /> : <Badge label="Anulada" tone="muted" />}
      </div>
      {!active && quota.void_reason && <p className="faint">Motivo: {quota.void_reason}</p>}
      {act.success && <Notice kind="success">{act.success}</Notice>}
      <ErrorBox error={act.error} />
      {active && (
        <div className="btn-row">
          <button type="button" className="btn secondary" aria-expanded={panel === 'apply'} onClick={() => setPanel(panel === 'apply' ? 'none' : 'apply')}>Aplicar a membros</button>
          <button type="button" className="btn secondary" aria-expanded={panel === 'edit'} onClick={() => setPanel(panel === 'edit' ? 'none' : 'edit')}>Alterar</button>
        </div>
      )}
      {panel === 'apply' && <ApplyForm quota={quota} onDone={() => setPanel('none')} />}
      {panel === 'edit' && <QuotaForm quota={quota} onDone={() => setPanel('none')} />}
      {quota.charges.length === 0 ? <p className="faint">Ainda não foi aplicada a nenhum membro.</p> : (
        <ul className="list" aria-label={`Membros com a quota ${quota.name}`}>
          {quota.charges.map((c) => <ChargeRow key={c.id} charge={c} quotaActive={active} />)}
        </ul>
      )}
      {active && (
        <div className="fin-void">
          <Field label="Motivo para anular a quota" htmlFor={`void-q-${quota.id}`}>
            <input type="text" id={`void-q-${quota.id}`} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={500} />
          </Field>
          <ConfirmButton className="btn ghost danger" disabled={voidReason.trim().length < 3} confirmLabel="Anular quota"
            description="A quota deixa de estar em dívida. Os pagamentos já registados mantêm-se como movimentos."
            onConfirm={() => act.run(() => call('fin_void_quota', { p_section: section, p_id: quota.id, p_reason: voidReason }), 'Quota anulada.')}>
            Anular quota…
          </ConfirmButton>
        </div>
      )}
    </section>
  );
}

function ApplyForm({ quota, onDone }: { quota: Quota; onDone: () => void }) {
  const section = useSectionId();
  const members = useMembersFin(true);
  const act = useAction();
  const already = new Set(quota.charges.map((c) => c.profile_id));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [fraction, setFraction] = useState('1/1');
  const available = (members.data ?? []).filter((m) => !already.has(m.profile_id));
  const [num, den] = fraction.split('/').map(Number);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await act.run(() => call<number>('fin_apply_quota', { p_section: section, p_quota: quota.id, p_profiles: [...sel], p_num: num, p_den: den }), 'Quota aplicada. Os membros foram avisados.');
    if (r.ok) onDone();
  };
  return (
    <form className="card flat stack" onSubmit={submit} aria-label="Aplicar quota a membros">
      <ErrorBox error={act.error} />
      {members.isLoading ? <Loading compact /> : !available.length ? <p className="faint">Todos os membros ativos já têm esta quota.</p> : (
        <>
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setSel(new Set(available.map((m) => m.profile_id)))}>Selecionar todos</button>
            <button type="button" className="btn ghost" onClick={() => setSel(new Set())}>Limpar</button>
          </div>
          <fieldset className="fin-fieldset fin-members">
            <legend className="label">Membros</legend>
            {available.map((m) => (
              <label key={m.profile_id} className="checkbox">
                <input type="checkbox" checked={sel.has(m.profile_id)} onChange={(e) => {
                  const next = new Set(sel);
                  if (e.target.checked) next.add(m.profile_id); else next.delete(m.profile_id);
                  setSel(next);
                }} />
                <span>{m.full_name}</span>
              </label>
            ))}
          </fieldset>
          <Field label="Valor devido" htmlFor={`frac-${quota.id}`} hint="Para quem entra a meio do período, aplica só uma parte (arredondada ao cêntimo).">
            <select id={`frac-${quota.id}`} value={fraction} onChange={(e) => setFraction(e.target.value)}>
              {['1/1', '3/4', '2/3', '1/2', '1/3', '1/4'].map((x) => {
                const [n, d] = x.split('/').map(Number);
                const v = Math.floor((quota.amount_cents * n * 2 + d) / (2 * d));
                return <option key={x} value={x}>{x === '1/1' ? 'Valor completo' : x} · {formatEuros(v)}</option>;
              })}
            </select>
          </Field>
          <div className="btn-row">
            <button type="submit" className="btn" disabled={!sel.size || act.busy}>Aplicar a {sel.size} {sel.size === 1 ? 'membro' : 'membros'}</button>
          </div>
        </>
      )}
    </form>
  );
}

function ChargeRow({ charge: c, quotaActive }: { charge: Charge; quotaActive: boolean }) {
  const section = useSectionId();
  const opts = useOptions();
  const act = useAction();
  const [open, setOpen] = useState<'none' | 'pay' | 'waive'>('none');
  const [on, setOn] = useState(todayLisbon());
  const [amount, setAmount] = useState(eurosInput(Math.max(c.em_falta - c.pendente, 0) || c.em_falta));
  const [account, setAccount] = useState('');
  const [state, setState] = useState<MovState>('efetivo');
  const [excess, setExcess] = useState(false);
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(newClientKey);
  const [err, setErr] = useState<string | null>(null);
  const tone = c.status === 'isenta' ? 'muted' : c.em_falta === 0 ? 'ok' : c.pendente > 0 ? 'attention' : 'progress';
  const label = c.status === 'isenta' ? 'Isento' : c.em_falta === 0 ? 'Paga' : c.pendente > 0 ? 'Pagamento pendente' : 'Em falta';
  const pay = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseEuros(amount);
    if (cents == null || cents <= 0) return setErr('Indica um valor superior a zero.');
    if (!account) return setErr('Escolhe a conta ou caixa.');
    setErr(null);
    const r = await act.run(() => call('fin_register_payment', {
      p_section: section, p_charge: c.id, p_on: on, p_account: account, p_amount: cents, p_state: state, p_allow_excess: excess, p_client_key: key,
    }), 'Pagamento registado.');
    if (r.ok) { setOpen('none'); setKey(newClientKey()); setExcess(false); }
  };
  const id = `ch-${c.id}`;
  return (
    <li className="fin-charge">
      <div className="list-item">
        <span className="grow">
          <strong>{c.member_name}</strong>
          <span className="faint fin-sub">
            Devido {formatEuros(c.amount_cents)} · pago {formatEuros(c.pago)}{c.pendente > 0 ? ` · pendente ${formatEuros(c.pendente)}` : ''}
            {c.excesso > 0 ? ` · excesso ${formatEuros(c.excesso)}` : ''}
          </span>
        </span>
        <Badge label={label} tone={tone} />
      </div>
      {act.success && <Notice kind="success">{act.success}</Notice>}
      {quotaActive && c.status === 'ativa' && (
        <div className="row fin-charge-actions">
          <button type="button" className="btn ghost" aria-expanded={open === 'pay'} onClick={() => setOpen(open === 'pay' ? 'none' : 'pay')}>Registar pagamento</button>
          <button type="button" className="btn ghost" aria-expanded={open === 'waive'} onClick={() => setOpen(open === 'waive' ? 'none' : 'waive')}>Isentar</button>
        </div>
      )}
      {open === 'pay' && (
        <form className="card flat stack" onSubmit={pay} noValidate aria-label={`Pagamento de ${c.member_name}`}>
          {err && <Notice kind="error">{err}</Notice>}
          <ErrorBox error={act.error} />
          <div className="grid-2">
            <Field label="Data" htmlFor={`${id}-on`}><DateInput id={`${id}-on`} value={on} onChange={(e) => setOn(e.target.value)} /></Field>
            <Field label="Valor (€)" htmlFor={`${id}-amount`}><input type="text" id={`${id}-amount`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Conta ou caixa" htmlFor={`${id}-acc`}>
              <select id={`${id}-acc`} value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="">Escolhe…</option>
                {(opts.data?.accounts ?? []).filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {!opts.isLoading && !opts.data?.accounts.length && <span className="hint"><Link to="/tesouraria/contas">Criar conta ou caixa</Link></span>}
            </Field>
            <Field label="Estado" htmlFor={`${id}-state`}>
              <select id={`${id}-state`} value={state} onChange={(e) => setState(e.target.value as MovState)}>
                <option value="efetivo">Efetivo (recebido)</option>
                <option value="pendente">Pendente (por confirmar)</option>
              </select>
            </Field>
          </div>
          {(excess || /excede|totalmente paga/.test(act.error ?? '')) && (
            <label className="checkbox">
              <input type="checkbox" checked={excess} onChange={(e) => setExcess(e.target.checked)} />
              <span>Confirmo que o valor fica acima do que está em falta</span>
            </label>
          )}
          <div className="btn-row"><button type="submit" className="btn" disabled={act.busy}>Registar pagamento</button></div>
        </form>
      )}
      {open === 'waive' && (
        <div className="card flat stack">
          <Field label="Motivo da isenção" htmlFor={`${id}-reason`}><input type="text" id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
          <ConfirmButton disabled={reason.trim().length < 3} confirmLabel="Isentar" description="O membro deixa de dever esta quota."
            onConfirm={() => act.run(() => call('fin_waive_charge', { p_section: section, p_charge: c.id, p_reason: reason }), 'Membro isento desta quota.')}>
            Isentar…
          </ConfirmButton>
        </div>
      )}
    </li>
  );
}
