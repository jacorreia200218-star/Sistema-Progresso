// Lista «A comprar»: material necessário (existente ou novo), quantidade, motivo e
// prioridade; estados Por comprar, Comprado e Cancelado. Ao comprar, pode acrescentar-se
// ao inventário (uma só vez) e associar a despesa da Tesouraria (existente ou nova).
// A despesa existe uma única vez na Tesouraria: o servidor recusa ligá-la a duas compras.
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { Badge, ConfirmButton, Empty, ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import { formatDay, formatEuros, parseEuros, todayLisbon } from '../common';
import { InvTabs, useFormAction } from './parts';
import {
  PRIORITY_LABEL, PURCHASE_LABEL, norm, qty, useEventOptions, useExpenseOptions, useOverview, usePurchases, useSectionId,
  type Priority, type Purchase,
} from './api';

const STATUS_FILTERS: [string, string][] = [['', 'Por comprar'], ['comprado', 'Compradas'], ['cancelado', 'Canceladas'], ['todos', 'Todas']];

export function Comprar() {
  const [params, setParams] = useSearchParams();
  const estado = params.get('estado') ?? '';
  const prio = (params.get('prioridade') ?? '') as Priority | '';
  const q = params.get('q') ?? '';
  const ov = useOverview();
  const list = usePurchases(estado || 'por_comprar');
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const set = (k: string, v: string) => setParams(() => {
    const next = new URLSearchParams(window.location.search);
    if (v) next.set(k, v); else next.delete(k);
    return next;
  }, { replace: true });
  const manage = !!ov.data?.can_manage;
  const rows = (list.data ?? [])
    .filter((p) => !prio || p.priority === prio)
    .filter((p) => !q.trim() || norm([p.name, p.reason, p.category, p.event].filter(Boolean).join(' ')).includes(norm(q.trim())));
  const empty = q || prio ? 'Nenhuma compra com estes filtros.'
    : estado === 'comprado' ? 'Ainda não há compras registadas como compradas.'
    : estado === 'cancelado' ? 'Não há compras canceladas.'
    : estado === 'todos' ? 'A lista «A comprar» está vazia.' : 'Não há nada por comprar.';
  return (
    <div className="inv-page">
      <PageTitle title="A comprar" subtitle="Material necessário, por prioridade." />
      <InvTabs />
      <div className="filter-chips" role="radiogroup" aria-label="Estado das compras">
        {STATUS_FILTERS.map(([k, l]) => (
          <label key={k} className="filter-chip">
            <input type="radio" name="inv-compra-estado" checked={estado === k} onChange={() => set('estado', k)} /> {l}
          </label>
        ))}
      </div>
      <div className="grid-filters inv-filters">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Pesquisar compras</span>
          <input type="search" placeholder="Pesquisar compras" value={q} onChange={(e) => set('q', e.target.value)} />
        </label>
        <select aria-label="Filtrar por prioridade" value={prio} onChange={(e) => set('prioridade', e.target.value)}>
          <option value="">Todas as prioridades</option>
          <option value="alta">Alta</option>
          <option value="media">Média</option>
          <option value="baixa">Baixa</option>
        </select>
      </div>
      {manage && (
        <div className="btn-row inv-actions">
          <button type="button" className="btn" aria-expanded={adding} onClick={() => { setFlash(null); setAdding(!adding); }}>
            <Plus size={16} aria-hidden="true" /> Nova compra
          </button>
        </div>
      )}
      {flash && <Notice kind="success">{flash}</Notice>}
      {adding && <PurchaseForm onDone={(m) => { setAdding(false); setFlash(m ?? null); }} />}
      {!manage && <p className="faint prose">A lista é preparada pelos dirigentes e pelos responsáveis pelo material. Se precisares de algo, fala com eles.</p>}
      {list.isLoading || ov.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} retry={() => list.refetch()} /> : rows.length === 0 ? (
        <div className="card"><Empty title={empty}>{manage && !q && !prio && estado === '' && <p className="faint">Usa «Nova compra» ou, na ficha de um artigo, «Pôr na lista “A comprar”».</p>}</Empty></div>
      ) : (
        <ul className="inv-cards" aria-label="Compras">
          {rows.map((p) => <PurchaseCard key={p.id} p={p} canManage={manage} finOk={!!ov.data?.fin_ok} />)}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Criar ou editar uma compra
// ---------------------------------------------------------------------------
export function PurchaseForm({ item, purchase, onDone }: {
  item?: { id: string; name: string; unit: string }; purchase?: Purchase; onDone: (msg?: string) => void;
}) {
  const section = useSectionId();
  const ov = useOverview();
  const events = useEventOptions();
  const action = useFormAction(onDone);
  const [itemId, setItemId] = useState(item?.id ?? purchase?.item_id ?? '');
  const [name, setName] = useState(purchase?.new_material ? purchase.name : '');
  const [unit, setUnit] = useState(purchase?.new_material ? purchase.unit : 'un.');
  const [category, setCategory] = useState(purchase?.new_material ? purchase.category_id ?? '' : '');
  const [n, setN] = useState(String(purchase?.quantity ?? 1));
  const [reason, setReason] = useState(purchase?.reason ?? '');
  const [priority, setPriority] = useState<Priority>(purchase?.priority ?? 'media');
  const [needed, setNeeded] = useState(purchase?.needed_by ?? '');
  const [event, setEvent] = useState(purchase?.event_id ?? '');
  const [amount, setAmount] = useState(purchase?.amount_cents != null ? (purchase.amount_cents / 100).toFixed(2).replace('.', ',') : '');
  const [err, setErr] = useState<string | null>(null);
  const fixedItem = !!item;
  const items = (ov.data?.items ?? []).filter((i) => !i.archived_at);
  const sameName = !itemId && name.trim() ? items.find((i) => norm(i.name.trim()) === norm(name.trim())) : undefined;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const qn = Number(n);
    if (!itemId && !name.trim()) return setErr('Escolhe um artigo existente ou escreve o nome do material novo.');
    if (!Number.isInteger(qn) || qn < 1) return setErr('Indica uma quantidade igual ou superior a 1.');
    const cents = amount.trim() ? parseEuros(amount) : null;
    if (amount.trim() && (cents == null || cents <= 0)) return setErr('Indica o valor em euros (por exemplo: 12,50).');
    await action.run(() => call('inv_purchase_save', {
      p_section: section, p_id: purchase?.id ?? null, p_item: itemId || null, p_name: itemId ? null : name, p_quantity: qn,
      p_unit: itemId ? null : unit, p_reason: reason || null, p_priority: priority, p_category: itemId ? null : category || null,
      p_needed_by: needed || null, p_event: event || null, p_amount: cents,
    }), purchase ? 'Compra guardada.' : 'Acrescentado à lista «A comprar».');
  };
  const id = `pur-${purchase?.id ?? item?.id ?? 'nova'}`;
  return (
    <form className="inv-form card flat" onSubmit={submit} noValidate aria-label={purchase ? 'Editar compra' : 'Nova compra'}>
      <h3 className="label">{purchase ? 'Editar compra' : fixedItem ? `Comprar «${item!.name}»` : 'Nova compra'}</h3>
      {err && <Notice kind="error">{err}</Notice>}
      <ErrorBox error={action.error} />
      {!fixedItem && (
        <Field label="Material" htmlFor={`${id}-i`}>
          <select id={`${id}-i`} value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Material novo (ainda não está no inventário)</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </Field>
      )}
      {!itemId && (
        <>
          <div className="grid-2">
            <Field label="Nome do material novo" htmlFor={`${id}-n`}>
              <input id={`${id}-n`} type="text" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Tipo (opcional)" htmlFor={`${id}-c`}>
              <select id={`${id}-c`} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Sem tipo</option>
                {(ov.data?.categories ?? []).filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          {sameName && <p className="faint prose">Já existe «{sameName.name}» no inventário: ao acrescentar a compra, a quantidade soma-se a esse artigo em vez de criar outro.</p>}
        </>
      )}
      <div className="grid-2">
        <Field label={itemId ? `Quantidade (${items.find((i) => i.id === itemId)?.unit ?? item?.unit ?? 'un.'})` : 'Quantidade'} htmlFor={`${id}-q`}>
          <input id={`${id}-q`} type="number" inputMode="numeric" min={1} value={n} onChange={(e) => setN(e.target.value)} />
        </Field>
        {!itemId ? (
          <Field label="Unidade" htmlFor={`${id}-u`}>
            <input id={`${id}-u`} type="text" maxLength={20} value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
        ) : (
          <Field label="Prioridade" htmlFor={`${id}-p`}>
            <PrioritySelect id={`${id}-p`} value={priority} onChange={setPriority} />
          </Field>
        )}
      </div>
      {!itemId && (
        <Field label="Prioridade" htmlFor={`${id}-p2`}><PrioritySelect id={`${id}-p2`} value={priority} onChange={setPriority} /></Field>
      )}
      <Field label="Motivo (opcional)" htmlFor={`${id}-r`}>
        <input id={`${id}-r`} type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Por exemplo: tenda rasgada no último acampamento" />
      </Field>
      <div className="grid-2">
        <Field label="Necessário até (opcional)" htmlFor={`${id}-d`}>
          <input id={`${id}-d`} type="date" value={needed} onChange={(e) => setNeeded(e.target.value)} />
        </Field>
        <Field label="Valor previsto (opcional)" htmlFor={`${id}-v`}>
          <input id={`${id}-v`} type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00 €" />
        </Field>
      </div>
      <Field label="Atividade do calendário (opcional)" htmlFor={`${id}-e`}>
        <select id={`${id}-e`} value={event} onChange={(e) => setEvent(e.target.value)}>
          <option value="">Sem atividade</option>
          {purchase?.event_id && !(events.data ?? []).some((e) => e.id === purchase.event_id) && <option value={purchase.event_id}>{purchase.event ?? 'Atividade ligada'}</option>}
          {(events.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
      </Field>
      <div className="btn-row">
        <button type="submit" className="btn" disabled={action.busy}>{purchase ? 'Guardar' : 'Acrescentar à lista'}</button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>Cancelar</button>
      </div>
    </form>
  );
}

function PrioritySelect({ id, value, onChange }: { id: string; value: Priority; onChange: (p: Priority) => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as Priority)}>
      <option value="alta">Alta</option>
      <option value="media">Média</option>
      <option value="baixa">Baixa</option>
    </select>
  );
}

// ---------------------------------------------------------------------------
// Cartão de uma compra
// ---------------------------------------------------------------------------
export function PurchaseCard({ p, canManage, finOk }: { p: Purchase; canManage: boolean; finOk: boolean }) {
  const section = useSectionId();
  const action = useAction();
  const [open, setOpen] = useState<'comprar' | 'editar' | 'despesa' | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const done = (msg?: string) => { setOpen(null); setFlash(msg ?? null); };
  const toggle = (k: typeof open) => { setFlash(null); action.clear(); setOpen(open === k ? null : k); };
  const st = PURCHASE_LABEL[p.status];
  const pr = PRIORITY_LABEL[p.priority];
  const itemLink = p.stock_item_id ?? p.item_id;
  return (
    <li className={`card inv-loan inv-purchase${p.status === 'por_comprar' && p.priority === 'alta' ? ' inv-high' : ''}`}>
      <div className="row between inv-loan-head">
        <div className="inv-loan-title">
          {itemLink ? <Link to={`/inventario/artigo/${itemLink}`}><strong>{p.name}</strong></Link> : <strong>{p.name}</strong>}
          <span className="faint">
            {qty(p.bought_qty ?? p.quantity, p.unit)}{p.new_material && !p.stock_item_id ? ' · material novo' : ''}{p.category ? ` · ${p.category}` : ''}
          </span>
        </div>
        <div className="row inv-badges">
          {p.status === 'por_comprar' && <Badge label={pr.label} tone={pr.tone} />}
          <Badge label={st.label} tone={st.tone} />
        </div>
      </div>
      {p.reason && <p className="prose inv-reason">{p.reason}</p>}
      <dl className="inv-dl">
        {p.needed_by && p.status === 'por_comprar' && <div><dt>Necessário até</dt><dd>{formatDay(p.needed_by)}</dd></div>}
        {p.event && <div><dt>Atividade</dt><dd>{p.event}</dd></div>}
        {p.amount_cents != null && <div><dt>{p.status === 'comprado' ? 'Valor' : 'Valor previsto'}</dt><dd>{formatEuros(p.amount_cents)}</dd></div>}
        {p.status === 'comprado' && p.bought_on && <div><dt>Comprado em</dt><dd>{formatDay(p.bought_on)}{p.bought_by ? ` · ${p.bought_by}` : ''}</dd></div>}
        {p.status === 'cancelado' && p.cancelled_at && <div><dt>Cancelado</dt><dd>{formatDay(p.cancelled_at.slice(0, 10))}{p.cancelled_by ? ` · ${p.cancelled_by}` : ''}</dd></div>}
        <div><dt>Pedido por</dt><dd>{p.created_by}</dd></div>
      </dl>
      {p.status === 'cancelado' && p.cancel_reason && <p className="faint prose">Motivo: {p.cancel_reason}</p>}
      {p.status === 'comprado' && (
        <ul className="inv-returns" aria-label="Seguimento da compra">
          <li className="faint">{p.stock_added_at ? `Acrescentado ao inventário${p.stock_added_by ? ` por ${p.stock_added_by}` : ''}.` : 'Ainda não acrescentado ao inventário.'}</li>
          <li className="faint">
            {p.expense
              ? `Despesa na Tesouraria: ${p.expense.description} · ${formatDay(p.expense.occurred_on)} · ${formatEuros(p.expense.amount_cents)}${p.expense.account ? ` · ${p.expense.account}` : ''}${p.expense.voided ? ' (anulada)' : ''}`
              : p.has_expense ? 'Despesa associada na Tesouraria.' : 'Sem despesa associada.'}
          </li>
        </ul>
      )}
      <ErrorBox error={action.error} />
      {(action.success || flash) && <Notice kind="success">{action.success ?? flash}</Notice>}
      {canManage && (
        <div className="btn-row">
          {p.status === 'por_comprar' && (
            <>
              <button type="button" className="btn" aria-expanded={open === 'comprar'} onClick={() => toggle('comprar')}>Marcar como comprado</button>
              <button type="button" className="btn secondary" aria-expanded={open === 'editar'} onClick={() => toggle('editar')}>Editar</button>
              <ConfirmButton className="btn ghost" confirmLabel="Cancelar compra" disabled={action.busy} description="A compra fica cancelada (não se apaga) e pode ser reaberta."
                onConfirm={() => action.run(() => call('inv_purchase_cancel', { p_section: section, p_id: p.id, p_reason: null }), 'Compra cancelada.')}>
                Cancelar
              </ConfirmButton>
            </>
          )}
          {p.status === 'cancelado' && (
            <button type="button" className="btn secondary" disabled={action.busy}
              onClick={() => action.run(() => call('inv_purchase_reopen', { p_section: section, p_id: p.id }), 'Compra reaberta.')}>Reabrir</button>
          )}
          {p.status === 'comprado' && !p.stock_added_at && p.tracking !== 'pecas' && (
            <ConfirmButton className="btn secondary" confirmLabel="Acrescentar" disabled={action.busy}
              description={`Soma ${qty(p.bought_qty ?? p.quantity, p.unit)} ao inventário (uma só vez).`}
              onConfirm={() => action.run(() => call('inv_purchase_add_stock', { p_section: section, p_id: p.id, p_category: null }), 'Acrescentado ao inventário.')}>
              Acrescentar ao inventário
            </ConfirmButton>
          )}
          {p.status === 'comprado' && !p.has_expense && finOk && (
            <button type="button" className="btn secondary" aria-expanded={open === 'despesa'} onClick={() => toggle('despesa')}>Associar despesa</button>
          )}
        </div>
      )}
      {open === 'comprar' && <BuyForm p={p} finOk={finOk} onDone={done} />}
      {open === 'editar' && <PurchaseForm purchase={p} onDone={done} />}
      {open === 'despesa' && <ExpenseLater p={p} onDone={done} />}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Despesa: escolher uma existente ou criar uma nova (só quem gere a Tesouraria)
// ---------------------------------------------------------------------------
type ExpenseChoice = { mode: 'nenhuma' | 'existente' | 'nova'; movement: string; account: string; category: string; state: string; description: string };

function ExpenseFields({ p, value, onChange, idp, allowNone }: {
  p: Purchase; value: ExpenseChoice; onChange: (v: ExpenseChoice) => void; idp: string; allowNone: boolean;
}) {
  const opts = useExpenseOptions();
  if (opts.isLoading) return <Loading compact rows={1} />;
  if (opts.error) return <ErrorBox error={opts.error} />;
  const o = opts.data!;
  if (!o.allowed) return <p className="faint prose">{o.reason}</p>;
  const set = (k: Partial<ExpenseChoice>) => onChange({ ...value, ...k });
  return (
    <fieldset className="inv-expense">
      <legend className="label">Despesa na Tesouraria</legend>
      <div className="radio-row">
        {allowNone && <label className="radio"><input type="radio" name={`${idp}-m`} checked={value.mode === 'nenhuma'} onChange={() => set({ mode: 'nenhuma' })} /> Associar depois</label>}
        <label className="radio"><input type="radio" name={`${idp}-m`} checked={value.mode === 'existente'} onChange={() => set({ mode: 'existente' })} /> Despesa já registada</label>
        <label className="radio"><input type="radio" name={`${idp}-m`} checked={value.mode === 'nova'} onChange={() => set({ mode: 'nova' })} /> Registar nova despesa</label>
      </div>
      {value.mode === 'existente' && (
        <Field label="Despesa" htmlFor={`${idp}-mv`} hint={o.expenses.length === 0 ? 'Não há despesas por associar: todas já estão ligadas a uma compra ou anuladas.' : 'Só aparecem despesas ainda não associadas a outra compra.'}>
          <select id={`${idp}-mv`} value={value.movement} onChange={(e) => set({ movement: e.target.value })}>
            <option value="">Escolhe a despesa…</option>
            {o.expenses.map((m) => <option key={m.id} value={m.id}>{formatDay(m.occurred_on)} · {m.description} · {formatEuros(m.amount_cents)}</option>)}
          </select>
        </Field>
      )}
      {value.mode === 'nova' && (
        <>
          {o.accounts.length === 0 && <Notice kind="warn">Ainda não há contas na Tesouraria. Cria primeiro uma conta ou caixa.</Notice>}
          <div className="grid-2">
            <Field label="Conta ou caixa" htmlFor={`${idp}-ac`}>
              <select id={`${idp}-ac`} value={value.account} onChange={(e) => set({ account: e.target.value })}>
                <option value="">Escolhe…</option>
                {o.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Categoria da despesa" htmlFor={`${idp}-ca`}>
              <select id={`${idp}-ca`} value={value.category} onChange={(e) => set({ category: e.target.value })}>
                {o.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Estado" htmlFor={`${idp}-st`}>
              <select id={`${idp}-st`} value={value.state} onChange={(e) => set({ state: e.target.value })}>
                <option value="efetivo">Efetivo (já pago)</option>
                <option value="pendente">Pendente (por pagar)</option>
                <option value="previsto">Previsto</option>
              </select>
            </Field>
            <Field label="Descrição" htmlFor={`${idp}-de`}>
              <input id={`${idp}-de`} type="text" maxLength={200} value={value.description} onChange={(e) => set({ description: e.target.value })} placeholder={`Compra de material: ${p.name}`} />
            </Field>
          </div>
        </>
      )}
    </fieldset>
  );
}

const initialExpense = (allowNone: boolean): ExpenseChoice =>
  ({ mode: allowNone ? 'nenhuma' : 'existente', movement: '', account: '', category: 'Material', state: 'efetivo', description: '' });

function checkExpense(e: ExpenseChoice, cents: number | null): string | null {
  if (e.mode === 'existente' && !e.movement) return 'Escolhe a despesa a associar.';
  if (e.mode === 'nova' && !e.account) return 'Escolhe a conta ou caixa da despesa.';
  if (e.mode === 'nova' && (cents == null || cents <= 0)) return 'Indica o valor pago para registar a despesa.';
  return null;
}

function BuyForm({ p, finOk, onDone }: { p: Purchase; finOk: boolean; onDone: (msg?: string) => void }) {
  const section = useSectionId();
  const ov = useOverview();
  const action = useFormAction(onDone);
  const clientKey = useMemo(() => crypto.randomUUID(), []);
  const [on, setOn] = useState(todayLisbon());
  const [n, setN] = useState(String(p.quantity));
  const [amount, setAmount] = useState(p.amount_cents != null ? (p.amount_cents / 100).toFixed(2).replace('.', ',') : '');
  const byPieces = p.tracking === 'pecas';
  const [add, setAdd] = useState(!byPieces && !p.item_archived);
  const [category, setCategory] = useState(p.category_id ?? '');
  const [exp, setExp] = useState<ExpenseChoice>(initialExpense(true));
  const [err, setErr] = useState<string | null>(null);
  const idp = `buy-${p.id}`;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const qn = Number(n);
    if (!Number.isInteger(qn) || qn < 1) return setErr('Indica a quantidade comprada (1 ou mais).');
    if (!on) return setErr('Indica a data da compra.');
    if (on > todayLisbon()) return setErr('A data da compra não pode ser no futuro.');
    const cents = amount.trim() ? parseEuros(amount) : null;
    if (amount.trim() && (cents == null || cents <= 0)) return setErr('Indica o valor em euros (por exemplo: 12,50).');
    const ex = finOk ? exp : initialExpense(true);
    const bad = checkExpense(ex, cents);
    if (bad) return setErr(bad);
    await action.run(() => call('inv_purchase_buy', {
      p_section: section, p_id: p.id, p_bought_on: on, p_quantity: qn, p_amount: cents, p_add_stock: add,
      p_category: add && p.new_material ? category || null : null,
      p_movement: ex.mode === 'existente' ? ex.movement : null,
      p_expense: ex.mode === 'nova' ? { account: ex.account, category: ex.category, state: ex.state, description: ex.description || null,
        on, amount: cents, client_key: clientKey } : null,
    }), ['Compra registada', add && 'acrescentada ao inventário', ex.mode !== 'nenhuma' && 'despesa associada'].filter(Boolean).join('; ') + '.');
  };
  return (
    <form className="inv-form card flat" onSubmit={submit} noValidate aria-label="Marcar como comprado">
      {err && <Notice kind="error">{err}</Notice>}
      <ErrorBox error={action.error} />
      <div className="grid-2">
        <Field label="Data da compra" htmlFor={`${idp}-d`}><input id={`${idp}-d`} type="date" value={on} max={todayLisbon()} onChange={(e) => setOn(e.target.value)} /></Field>
        <Field label={`Quantidade comprada (${p.unit})`} htmlFor={`${idp}-q`}><input id={`${idp}-q`} type="number" inputMode="numeric" min={1} value={n} onChange={(e) => setN(e.target.value)} /></Field>
      </div>
      <Field label="Valor pago (opcional)" htmlFor={`${idp}-v`}>
        <input id={`${idp}-v`} type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00 €" />
      </Field>
      {byPieces ? (
        <p className="faint prose">Este artigo é controlado por peças: depois de comprado, acrescenta as peças novas na ficha do artigo.</p>
      ) : (
        <label className="checkbox">
          <input type="checkbox" checked={add} onChange={(e) => setAdd(e.target.checked)} disabled={p.item_archived} />
          Acrescentar ao inventário ({p.new_material ? 'cria o artigo novo, ou soma ao que já tiver o mesmo nome' : `soma ${n || 0} ${p.unit} a «${p.name}»`})
        </label>
      )}
      {add && p.new_material && (
        <Field label="Tipo do artigo novo" htmlFor={`${idp}-c`}>
          <select id={`${idp}-c`} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Sem tipo</option>
            {(ov.data?.categories ?? []).filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      {finOk ? <ExpenseFields p={p} value={exp} onChange={setExp} idp={idp} allowNone /> : (
        <p className="faint prose">A despesa pode ser associada mais tarde por quem gere a Tesouraria. Assim é registada uma única vez e nunca conta a dobrar.</p>
      )}
      <div className="btn-row">
        <button type="submit" className="btn" disabled={action.busy}>Confirmar compra</button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>Cancelar</button>
      </div>
    </form>
  );
}

function ExpenseLater({ p, onDone }: { p: Purchase; onDone: (msg?: string) => void }) {
  const section = useSectionId();
  const action = useFormAction(onDone);
  const clientKey = useMemo(() => crypto.randomUUID(), []);
  const [exp, setExp] = useState<ExpenseChoice>(initialExpense(false));
  const [amount, setAmount] = useState(p.amount_cents != null ? (p.amount_cents / 100).toFixed(2).replace('.', ',') : '');
  const [err, setErr] = useState<string | null>(null);
  const idp = `exp-${p.id}`;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const cents = amount.trim() ? parseEuros(amount) : null;
    const bad = checkExpense(exp, cents);
    if (bad) return setErr(bad);
    await action.run(() => exp.mode === 'existente'
      ? call('inv_purchase_link_expense', { p_section: section, p_id: p.id, p_movement: exp.movement })
      : call('inv_purchase_create_expense', {
          p_section: section, p_id: p.id, p_on: p.bought_on, p_description: exp.description || null, p_category: exp.category,
          p_amount: cents, p_account: exp.account, p_state: exp.state, p_notes: null, p_client_key: clientKey,
        }), 'Despesa associada.');
  };
  return (
    <form className="inv-form card flat" onSubmit={submit} noValidate aria-label="Associar despesa">
      {err && <Notice kind="error">{err}</Notice>}
      <ErrorBox error={action.error} />
      <ExpenseFields p={p} value={exp} onChange={setExp} idp={idp} allowNone={false} />
      {exp.mode === 'nova' && (
        <Field label="Valor pago" htmlFor={`${idp}-v`}>
          <input id={`${idp}-v`} type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00 €" />
        </Field>
      )}
      <div className="btn-row">
        <button type="submit" className="btn" disabled={action.busy}>Associar</button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>Cancelar</button>
      </div>
    </form>
  );
}
