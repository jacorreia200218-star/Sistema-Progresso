// Orçamento (previsto) e resultado (efetivo) por atividade do Calendário. Totais para todos;
// linhas de orçamento editáveis só por quem gere.
import { useState, type FormEvent } from 'react';
import { ConfirmButton, Empty, ErrorBox, Field, Loading, Notice } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { formatDay, formatEuros, parseEuros } from '../common';
import { KIND_LABEL, useActivities, useActivityResults, useOptions, useSectionId, type ActivityResult, type Kind } from './api';
import { useCanManage } from './shared';

export function ActivitiesPage() {
  const q = useActivityResults();
  const canManage = useCanManage();
  return (
    <div className="stack">
      <p className="prose faint">
        Para cada atividade, o orçamento (previsto) ao lado do resultado efetivo. Os valores por confirmar (pendentes ou previstos)
        aparecem à parte e não entram no resultado.
      </p>
      {canManage && <BudgetForm />}
      {q.isLoading ? <Loading rows={2} /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : !q.data?.length ? (
        <Empty title="Sem atividades com orçamento ou movimentos">
          <p>{canManage ? 'Junta uma linha de orçamento ou associa movimentos a uma atividade do Calendário.' : 'Quando houver atividades com orçamento ou movimentos, aparecem aqui.'}</p>
        </Empty>
      ) : q.data.map((a) => <ActivityCard key={a.activity_id} a={a} canManage={canManage} />)}
    </div>
  );
}

function Triple({ title, v }: { title: string; v: { receitas: number; despesas: number; resultado: number } }) {
  return (
    <div className="fin-mini">
      <h3>{title}</h3>
      <dl className="fin-dl">
        <dt>Receitas</dt><dd>{formatEuros(v.receitas)}</dd>
        <dt>Despesas</dt><dd>{formatEuros(v.despesas)}</dd>
        <dt>Resultado</dt><dd><strong className={v.resultado < 0 ? 'fin-neg' : undefined}>{formatEuros(v.resultado)}</strong></dd>
      </dl>
    </div>
  );
}

function ActivityCard({ a, canManage }: { a: ActivityResult; canManage: boolean }) {
  const section = useSectionId();
  const act = useAction();
  const diff = a.efetivo.resultado - a.orcamento.resultado;
  return (
    <section className="card stack" id={`a-${a.activity_id}`} aria-labelledby={`t-${a.activity_id}`}>
      <div>
        <h2 id={`t-${a.activity_id}`} className="card-title">{a.title}</h2>
        <p className="faint">{a.day ? formatDay(a.day) : ''}{a.status === 'cancelado' ? ' · atividade cancelada' : ''}</p>
      </div>
      <div className="grid-2">
        <Triple title="Orçamento (previsto)" v={a.orcamento} />
        <Triple title="Efetivo" v={a.efetivo} />
      </div>
      <p className="faint">
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
          <select id="b-act" value={activity} onChange={(e) => setActivity(e.target.value)}>
            <option value="">Escolhe…</option>
            {(acts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </Field>
        <Field label="Tipo" htmlFor="b-kind">
          <select id="b-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
          </select>
        </Field>
        <Field label="Categoria" htmlFor="b-cat">
          <input id="b-cat" list="b-cats" value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} />
          <datalist id="b-cats">{(opts.data?.categories ?? []).map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Valor previsto (€)" htmlFor="b-amount"><input id="b-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
      <Field label="Descrição" htmlFor="b-desc"><input id="b-desc" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="btn-row">
        <button type="submit" className="btn" disabled={act.busy}>Guardar linha</button>
        <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Fechar</button>
      </div>
    </form>
  );
}
