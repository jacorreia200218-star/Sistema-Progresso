// Orçamento (previsto) e resultado (efetivo) por atividade do Calendário. Totais para todos;
// linhas de orçamento editáveis só por quem gere.
import { useState, type FormEvent } from 'react';
import { ConfirmButton, Empty, ErrorBox, Field, Loading, Notice } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { formatDay, formatEuros, parseEuros } from '../common';
import { KIND_LABEL, activityChoices, useActivities, useActivityResults, useOptions, useSectionId, type ActivityResult, type Kind } from './api';
import { useCanManage } from './shared';
import { EventSelect } from '../EventSelect';

export function ActivitiesPage() {
  const q = useActivityResults();
  const canManage = useCanManage();
  return (
    <div className="stack">
      {canManage && <BudgetForm />}
      {q.isLoading ? <Loading rows={2} /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : !q.data?.length ? (
        <Empty title="Sem atividades com orçamento ou movimentos">
          <p>{canManage ? 'Junta uma linha de orçamento ou associa movimentos a uma atividade do Calendário.' : 'Quando houver atividades com orçamento ou movimentos, aparecem aqui.'}</p>
        </Empty>
      ) : q.data.map((a) => <ActivityCard key={a.activity_id} a={a} canManage={canManage} />)}
    </div>
  );
}

type Trio = { receitas: number; despesas: number; resultado: number };

/** Orçamento e efetivo lado a lado, valores alinhados à direita. */
function BudgetTable({ orcamento, efetivo }: { orcamento: Trio; efetivo: Trio }) {
  const rows: [string, keyof Trio][] = [['Receitas', 'receitas'], ['Despesas', 'despesas'], ['Resultado', 'resultado']];
  return (
    <div className="fin-table-wrap">
      <table className="fin-table">
        <thead><tr><th scope="col"><span className="sr-only">Valor</span></th><th scope="col">Orçamento (previsto)</th><th scope="col">Efetivo</th></tr></thead>
        <tbody>
          {rows.map(([label, k]) => (
            <tr key={k} className={k === 'resultado' ? 'fin-total' : undefined}>
              <th scope="row">{label}</th>
              <td className={orcamento[k] < 0 && k === 'resultado' ? 'fin-neg' : undefined}>{formatEuros(orcamento[k])}</td>
              <td className={efetivo[k] < 0 && k === 'resultado' ? 'fin-neg' : undefined}>{formatEuros(efetivo[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityCard({ a, canManage }: { a: ActivityResult; canManage: boolean }) {
  const section = useSectionId();
  const act = useAction();
  const diff = a.efetivo.resultado - a.orcamento.resultado;
  return (
    <section className="card stack fin-activity" id={`a-${a.activity_id}`} aria-labelledby={`t-${a.activity_id}`}>
      <div>
        <h2 id={`t-${a.activity_id}`} className="card-title">{a.title}</h2>
        <p className="faint fin-note">{a.day ? formatDay(a.day) : ''}{a.status === 'cancelado' ? ' · atividade cancelada' : ''}</p>
      </div>
      <BudgetTable orcamento={a.orcamento} efetivo={a.efetivo} />
      <p className="faint fin-note">
        Diferença no resultado: <strong>{formatEuros(diff)}</strong>
        {(a.por_confirmar.receitas > 0 || a.por_confirmar.despesas > 0) && <> · por confirmar: {formatEuros(a.por_confirmar.resultado)}</>}
      </p>
      {a.by_category.length > 0 && (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead><tr><th scope="col">Categoria</th><th scope="col">Orçamento</th><th scope="col">Efetivo</th></tr></thead>
            <tbody>
              {a.by_category.map((c) => (
                <tr key={`${c.kind}-${c.category}`}>
                  <th scope="row">{c.category} <span className={`fin-kind fin-${c.kind}`}>{c.kind}</span></th>
                  <td>{formatEuros(c.orcamento)}</td>
                  <td>{formatEuros(c.efetivo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && a.lines.length > 0 && (
        <details>
          <summary>Linhas do orçamento ({a.lines.length})</summary>
          {act.success && <Notice kind="success">{act.success}</Notice>}
          <ErrorBox error={act.error} />
          <ul className="list">
            {a.lines.map((l) => (
              <li key={l.id} className="list-item">
                <span className="grow">{l.description} <span className="faint">· {l.category} · {KIND_LABEL[l.kind]}</span></span>
                <span className="fin-amount">{formatEuros(l.amount_cents)}</span>
                <ConfirmButton className="btn ghost" confirmLabel="Anular linha" description="A linha deixa de contar no orçamento (fica no histórico)."
                  onConfirm={() => act.run(() => call('fin_void_budget_line', { p_section: section, p_id: l.id, p_reason: 'Retirada do orçamento' }), 'Linha anulada.')}>
                  Anular
                </ConfirmButton>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function BudgetForm() {
  const section = useSectionId();
  const acts = useActivities();
  const opts = useOptions();
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState('');
  const [kind, setKind] = useState<Kind>('despesa');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseEuros(amount);
    if (!activity) return setErr('Escolhe a atividade.');
    if (!category.trim() || !description.trim()) return setErr('Indica a categoria e a descrição.');
    if (cents == null || cents <= 0) return setErr('Indica um valor superior a zero.');
    setErr(null);
    const r = await act.run(() => call('fin_save_budget_line', { p_section: section, p_id: null, p_activity: activity, p_kind: kind, p_category: category, p_description: description, p_amount: cents }), 'Linha de orçamento guardada.');
    if (r.ok) { setDescription(''); setAmount(''); }
  };
  if (!open) return <div className="row"><button type="button" className="btn secondary" onClick={() => setOpen(true)}>Juntar linha de orçamento</button></div>;
  return (
    <form className="card stack" onSubmit={submit} noValidate aria-label="Linha de orçamento">
      {err && <Notice kind="error">{err}</Notice>}
      {act.success && <Notice kind="success">{act.success}</Notice>}
      <ErrorBox error={act.error} />
      {!acts.isLoading && !acts.data?.length && <Notice kind="info">Ainda não há atividades no Calendário deste espaço.</Notice>}
      <div className="grid-2">
        <Field label="Atividade" htmlFor="b-act">
          <EventSelect id="b-act" value={activity} onChange={setActivity} events={activityChoices(acts.data)} placeholder="Escolhe…" loading={acts.isLoading} />
        </Field>
        <Field label="Tipo" htmlFor="b-kind">
          <select id="b-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
          </select>
        </Field>
        <Field label="Categoria" htmlFor="b-cat">
          <input type="text" id="b-cat" list="b-cats" value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} />
          <datalist id="b-cats">{(opts.data?.categories ?? []).map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Valor previsto (€)" htmlFor="b-amount"><input type="text" id="b-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
      <Field label="Descrição" htmlFor="b-desc"><input type="text" id="b-desc" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="btn-row">
        <button type="submit" className="btn" disabled={act.busy}>Guardar linha</button>
        <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Fechar</button>
      </div>
    </form>
  );
}
