// Contas e caixas (só para quem gere). Arquivar em vez de apagar.
import { useState, type FormEvent } from 'react';
import { Empty, ErrorBox, Field, Loading, Notice } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { useOptions, useSectionId, type Account } from './api';

export function AccountsPage() {
  const opts = useOptions();
  return (
    <div className="stack">
      <AccountForm />
      {opts.isLoading ? <Loading rows={1} /> : opts.error ? <ErrorBox error={opts.error} retry={opts.refetch} /> : !opts.data?.accounts.length ? (
        <Empty title="Ainda não há contas nem caixas"><p>Cria, por exemplo, «Caixa» (numerário) e «Conta bancária».</p></Empty>
      ) : (
        <ul className="list card">
          {opts.data.accounts.map((a) => <AccountRow key={a.id} a={a} />)}
        </ul>
      )}
    </div>
  );
}

function AccountForm() {
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
    <form className="card stack" onSubmit={submit} noValidate aria-label="Nova conta ou caixa">
      {err && <Notice kind="error">{err}</Notice>}
      {act.success && <Notice kind="success">{act.success}</Notice>}
      <ErrorBox error={act.error} />
      <div className="grid-2">
        <Field label="Nome" htmlFor="acc-name"><input id="acc-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Tipo" htmlFor="acc-kind">
          <select id="acc-kind" value={kind} onChange={(e) => setKind(e.target.value as 'conta' | 'caixa')}>
            <option value="caixa">Caixa (numerário)</option>
            <option value="conta">Conta bancária</option>
          </select>
        </Field>
      </div>
      <div className="btn-row"><button type="submit" className="btn" disabled={act.busy}>Criar</button></div>
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
