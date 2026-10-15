// Resumo partilhado: totais por estado, por categoria, por atividade e saldo de cada conta.
// Nunca mostra pagamentos individuais (o servidor só devolve totais).
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Plus, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Empty, ErrorBox, Loading } from '../../components/ui';
import { downloadFile, formatEuros, todayLisbon, toCsv } from '../common';
import { csvEuros, filtersFrom, periodLabel, useSummary, type Summary as S } from './api';
import { FiltersBar, useCanManage } from './shared';

export function Summary() {
  const [params] = useSearchParams();
  const f = filtersFrom(params);
  const q = useSummary(f);
  const canManage = useCanManage();
  const s = q.data;

  const exportCsv = (s: S) => {
    const rows: (string | number)[][] = [
      ['Resumo da Tesouraria', periodLabel(f)],
      [],
      ['Estado', 'Receitas (€)', 'Despesas (€)', 'Saldo (€)'],
      ...(['efetivo', 'pendente', 'previsto'] as const).map((k) => [k, csvEuros(s.totals[k].receitas), csvEuros(s.totals[k].despesas), csvEuros(s.totals[k].saldo)]),
      [],
      ['Categoria', 'Tipo', 'Efetivo (€)', 'Pendente (€)', 'Previsto (€)'],
      ...s.by_category.map((c) => [c.category, c.kind, csvEuros(c.efetivo), csvEuros(c.pendente), csvEuros(c.previsto)]),
      [],
      ['Atividade', 'Receitas efetivas (€)', 'Despesas efetivas (€)', 'Resultado (€)'],
      ...s.by_activity.map((a) => [a.title, csvEuros(a.receitas), csvEuros(a.despesas), csvEuros(a.saldo)]),
    ];
    downloadFile(`tesouraria-resumo-${todayLisbon()}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  };

  return (
    <div className="stack">
      <FiltersBar />
      {q.isLoading ? <Loading rows={2} /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : s && (
        <>
          <section aria-labelledby="fin-efetivo">
            <div className="row between fin-section-head">
              <h2 id="fin-efetivo" className="section-title">Efetivo · {periodLabel(f)}</h2>
              <div className="row">
                {canManage && <Link to="/tesouraria/movimentos/novo" className="btn"><Plus size={18} aria-hidden="true" /> Novo movimento</Link>}
                <button type="button" className="btn secondary" onClick={() => exportCsv(s)}>
                  <Download size={18} aria-hidden="true" /> Exportar CSV
                </button>
              </div>
            </div>
            <ul className="stats fin-stats" aria-label="Totais efetivos">
              <li><div className="stat stat-verde"><span className="stat-icon"><TrendingUp size={20} aria-hidden="true" /></span>
                <span className="stat-value">{formatEuros(s.totals.efetivo.receitas)}</span><span className="stat-label">Receitas</span></div></li>
              <li><div className="stat stat-ambar"><span className="stat-icon"><TrendingDown size={20} aria-hidden="true" /></span>
                <span className="stat-value">{formatEuros(s.totals.efetivo.despesas)}</span><span className="stat-label">Despesas</span></div></li>
              <li><div className="stat stat-azul"><span className="stat-icon"><Wallet size={20} aria-hidden="true" /></span>
                <span className="stat-value" data-testid="saldo-efetivo">{formatEuros(s.totals.efetivo.saldo)}</span><span className="stat-label">Saldo efetivo</span></div></li>
            </ul>
            <p className="faint prose">
              O saldo efetivo só conta movimentos efetivos e não anulados. Os valores pendentes e previstos aparecem à parte.
            </p>
          </section>

          <section className="grid-2" aria-label="Pendente e previsto">
            {(['pendente', 'previsto'] as const).map((k) => (
              <div key={k} className="card fin-mini">
                <h3>{k === 'pendente' ? 'Pendente (por confirmar)' : 'Previsto'}</h3>
                <dl className="fin-dl">
                  <dt>Receitas</dt><dd>{formatEuros(s.totals[k].receitas)}</dd>
                  <dt>Despesas</dt><dd>{formatEuros(s.totals[k].despesas)}</dd>
                  <dt>Saldo</dt><dd><strong>{formatEuros(s.totals[k].saldo)}</strong></dd>
                </dl>
              </div>
            ))}
          </section>

          {s.count === 0 ? (
            <Empty title="Sem movimentos neste período">
              <p>{canManage ? 'Regista o primeiro movimento com «Novo movimento».' : 'Quando a tesouraria registar movimentos, os totais aparecem aqui.'}</p>
            </Empty>
          ) : (
            <>
              <section className="card" aria-labelledby="fin-cat">
                <h2 id="fin-cat" className="card-title">Por categoria</h2>
                <div className="fin-table-wrap">
                  <table className="fin-table">
                    <thead><tr><th scope="col">Categoria</th><th scope="col">Efetivo</th><th scope="col">Pendente</th><th scope="col">Previsto</th></tr></thead>
                    <tbody>
                      {s.by_category.map((c) => (
                        <tr key={`${c.kind}-${c.category}`}>
                          <th scope="row">{c.category} <span className={`fin-kind fin-${c.kind}`}>{c.kind === 'receita' ? 'receita' : 'despesa'}</span></th>
                          <td>{formatEuros(c.kind === 'despesa' ? -c.efetivo : c.efetivo)}</td>
                          <td>{formatEuros(c.kind === 'despesa' ? -c.pendente : c.pendente)}</td>
                          <td>{formatEuros(c.kind === 'despesa' ? -c.previsto : c.previsto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              {s.by_activity.length > 0 && (
                <section className="card" aria-labelledby="fin-act">
                  <h2 id="fin-act" className="card-title">Por atividade (efetivo)</h2>
                  <ul className="list">
                    {s.by_activity.map((a) => (
                      <li key={a.activity_id}>
                        <Link className="list-item" to={`/tesouraria/atividades#a-${a.activity_id}`}>
                          <span className="grow">
                            <strong>{a.title}</strong>
                            <span className="faint fin-sub">Receitas {formatEuros(a.receitas)} · Despesas {formatEuros(a.despesas)}</span>
                          </span>
                          <span className={`fin-amount ${a.saldo < 0 ? 'neg' : ''}`}>{formatEuros(a.saldo)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          <section className="card" aria-labelledby="fin-contas">
            <h2 id="fin-contas" className="card-title">Saldo atual por conta ou caixa</h2>
            {s.accounts.length === 0 ? (
              <p className="faint">{canManage ? 'Ainda não há contas nem caixas. Cria-as em «Contas e caixas».' : 'Ainda não há contas nem caixas.'}</p>
            ) : (
              <ul className="list">
                {s.accounts.map((a) => (
                  <li key={a.id} className="list-item">
                    <span className="grow">{a.name} <span className="faint">· {a.kind === 'caixa' ? 'caixa' : 'conta'}</span></span>
                    <span className={`fin-amount ${a.saldo < 0 ? 'neg' : ''}`}>{formatEuros(a.saldo)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
