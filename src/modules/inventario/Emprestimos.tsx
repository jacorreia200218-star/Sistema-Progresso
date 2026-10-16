// Empréstimos e pedidos, com filtro de estado e «só os meus» no endereço.
import { useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, Loading, PageTitle } from '../../components/ui';
import { InvTabs, LoanCard } from './parts';
import { useLoans, useOverview } from './api';

const FILTERS: [string, string][] = [['', 'Em curso'], ['ativo', 'Emprestados'], ['pedido', 'Pedidos'], ['atrasado', 'Em atraso'], ['fechado', 'Terminados'], ['todos', 'Histórico']];

export function Emprestimos() {
  const [params, setParams] = useSearchParams();
  const estado = params.get('estado') ?? '';
  const mine = params.get('meus') === '1';
  const ov = useOverview();
  const loans = useLoans(estado, mine);
  const set = (k: string, v: string) => setParams(() => {
    const next = new URLSearchParams(window.location.search);
    if (v) next.set(k, v); else next.delete(k);
    return next;
  }, { replace: true });
  const empty = estado === 'pedido' ? 'Não há pedidos por decidir.' : estado === 'atrasado' ? 'Não há devoluções em atraso.'
    : estado === 'fechado' ? 'Ainda não há empréstimos terminados.' : estado === 'ativo' ? 'Não há material emprestado.'
    : estado === 'todos' ? 'Ainda não há empréstimos registados.' : 'Não há material emprestado nem pedidos em curso.';
  return (
    <div className="inv-page">
      <PageTitle title="Empréstimos" subtitle="Material emprestado, pedidos e devoluções." />
      <InvTabs />
      <div className="filter-chips" role="radiogroup" aria-label="Estado dos empréstimos">
        {FILTERS.map(([k, l]) => (
          <label key={k} className="filter-chip">
            <input type="radio" name="inv-estado" checked={estado === k} onChange={() => set('estado', k)} /> {l}
          </label>
        ))}
        <label className="filter-chip">
          <input type="checkbox" checked={mine} onChange={(e) => set('meus', e.target.checked ? '1' : '')} /> Só os meus
        </label>
      </div>
      {!ov.data?.can_manage && (
        <p className="faint prose">Para pedir material, abre o artigo na lista e usa «Pedir empréstimo». Os pedidos ficam a aguardar aprovação.</p>
      )}
      {loans.isLoading || ov.isLoading ? <Loading /> : loans.error ? <ErrorBox error={loans.error} retry={() => loans.refetch()} /> : (loans.data ?? []).length === 0 ? (
        <div className="card"><Empty title={empty} /></div>
      ) : (
        <ul className="inv-cards" aria-label="Empréstimos">
          {loans.data!.map((l) => <LoanCard key={l.id} l={l} canManage={!!ov.data?.can_manage} me={ov.data?.me ?? ''} />)}
        </ul>
      )}
    </div>
  );
}
