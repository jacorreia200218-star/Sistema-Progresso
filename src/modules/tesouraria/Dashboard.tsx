// Painel financeiro: saldo atual com a fórmula e o saldo inicial identificado, receitas e
// despesas do período, resultado, evolução do saldo, últimos movimentos, resultado da
// atividade, totais por categoria e saldo por conta. Filtros (ano escutista, mês, atividade) no URL.
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Minus, Plus, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Badge, Empty, ErrorBox, Loading, MoreInfo, MoreMenu, Notice } from '../../components/ui';
import { downloadFile, formatDay, formatEuros, todayLisbon, toCsv } from '../common';
import { STATE_LABEL, STATE_TONE, csvEuros, filtersFrom, periodLabel, useDashboard, type Dashboard as D, type SharedMovement } from './api';
import { BalanceChart } from './BalanceChart';
import { FiltersBar, useCanManage } from './shared';

/** Ações do título: «Novo movimento» (quem gere) e, em «Mais», receita/despesa e CSV do painel. */
export function DashboardActions() {
  const [params] = useSearchParams();
  const f = filtersFrom(params);
  const d = useDashboard(f).data;
  const canManage = useCanManage();

  const exportCsv = (d: D) => {
    const rows: (string | number)[][] = [
      ['Painel da Tesouraria', periodLabel(f)],
      [],
      ['Saldo inicial (€)', 'Receitas (€)', 'Despesas (€)', 'Saldo atual (€)'],
      [csvEuros(d.current.saldo_inicial), csvEuros(d.current.receitas), csvEuros(d.current.despesas), csvEuros(d.current.saldo)],
      [],
      ['Estado', 'Receitas do período (€)', 'Despesas do período (€)', 'Resultado (€)'],
      ...(['efetivo', 'pendente', 'previsto'] as const).map((k) => [k, csvEuros(d.totals[k].receitas), csvEuros(d.totals[k].despesas), csvEuros(d.totals[k].saldo)]),
      [],
      ['Categoria', 'Tipo', 'Efetivo (€)', 'Pendente (€)', 'Previsto (€)'],
      ...d.by_category.map((c) => [c.category, c.kind, csvEuros(c.efetivo), csvEuros(c.pendente), csvEuros(c.previsto)]),
      [],
      ['Data', 'Saldo (€)'],
      ...d.evolution.points.map((p) => [formatDay(p.date), csvEuros(p.saldo)]),
    ];
    downloadFile(`tesouraria-painel-${todayLisbon()}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  };

  return <TitleActions canManage={canManage} onExport={d ? () => exportCsv(d) : undefined} />;
}

/** «Novo movimento» à vista; o resto no menu «Mais». */
export function TitleActions({ canManage, onExport }: { canManage: boolean; onExport?: () => void }) {
  return (
    <>
      {canManage && <Link to="/tesouraria/movimentos/novo" className="btn"><Plus size={18} aria-hidden="true" /> Novo movimento</Link>}
      <MoreMenu>
        {canManage && (
          <>
            <Link to="/tesouraria/movimentos/novo?tipo=receita" className="btn"><Plus size={16} aria-hidden="true" /> Nova receita</Link>
            <Link to="/tesouraria/movimentos/novo?tipo=despesa" className="btn"><Minus size={16} aria-hidden="true" /> Nova despesa</Link>
            <hr />
          </>
        )}
        <button type="button" className="btn" onClick={onExport} disabled={!onExport}><Download size={16} aria-hidden="true" /> Exportar CSV</button>
      </MoreMenu>
    </>
  );
}

export function Dashboard() {
  const [params] = useSearchParams();
  const f = filtersFrom(params);
  const q = useDashboard(f);
  const canManage = useCanManage();
  const d = q.data;
  const qs = params.toString();
  const hasOpen = d && (['pendente', 'previsto'] as const).some((k) => d.totals[k].receitas || d.totals[k].despesas);

  return (
    <div className="stack fin-dash">
      <FiltersBar years={d?.years} />
      {q.isLoading ? <Loading rows={3} /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : d && (
        <>
          <section aria-label="Indicadores">
            <ul className="stats fin-stats fin-kpis">
              <li><div className="stat stat-azul"><span className="stat-icon"><Wallet size={18} aria-hidden="true" /></span>
                <span className="stat-value" data-testid="saldo-atual">{formatEuros(d.current.saldo)}</span><span className="stat-label">Saldo atual</span>
                <span className="stat-hint">hoje, {formatDay(d.today)}</span></div></li>
              <li><div className="stat stat-verde"><span className="stat-icon"><TrendingUp size={18} aria-hidden="true" /></span>
                <span className="stat-value" data-testid="receitas-periodo">{formatEuros(d.totals.efetivo.receitas)}</span><span className="stat-label">Receitas</span>
                <span className="stat-hint">no período</span></div></li>
              <li><div className="stat stat-ambar"><span className="stat-icon"><TrendingDown size={18} aria-hidden="true" /></span>
                <span className="stat-value" data-testid="despesas-periodo">{formatEuros(d.totals.efetivo.despesas)}</span><span className="stat-label">Despesas</span>
                <span className="stat-hint">no período</span></div></li>
            </ul>
            <p className="fin-result">
              Resultado do período:{' '}
              <strong className={`fin-num${d.totals.efetivo.saldo < 0 ? ' fin-neg' : ''}`} data-testid="resultado-periodo">{formatEuros(d.totals.efetivo.saldo)}</strong>
            </p>
            <Formula d={d} canManage={canManage} />
          </section>

          {d.activity && (
            <section className="card" aria-labelledby="fin-act-res">
              <h2 id="fin-act-res" className="card-title">Resultado da atividade: {d.activity.title}</h2>
              <ul className="fin-act-result">
                <li><span className="faint">Orçamento</span><strong>{formatEuros(d.activity.orcamento.resultado)}</strong></li>
                <li><span className="faint">Efetivo</span><strong className={d.activity.efetivo.resultado < 0 ? 'fin-neg' : undefined} data-testid="resultado-atividade">{formatEuros(d.activity.efetivo.resultado)}</strong></li>
                <li><span className="faint">Por confirmar</span><strong>{formatEuros(d.activity.por_confirmar.resultado)}</strong></li>
              </ul>
              <p className="faint fin-note">
                Receitas {formatEuros(d.activity.efetivo.receitas)} − despesas {formatEuros(d.activity.efetivo.despesas)} desta atividade, em todos os períodos.{' '}
                <Link to={`/tesouraria/atividades#a-${d.activity.activity_id}`}>Ver orçamento e categorias</Link>
              </p>
            </section>
          )}

          <section className="card" aria-labelledby="fin-latest">
            <div className="row between fin-card-head">
              <h2 id="fin-latest" className="card-title">Últimos movimentos</h2>
              <Link to={`/tesouraria/movimentos${qs ? `?${qs}` : ''}`} className="btn ghost">Ver todos</Link>
            </div>
            {d.latest.length === 0 ? (
              <Empty title="Sem movimentos neste período">
                <p>{canManage ? 'Regista uma receita ou despesa com «Novo movimento».' : 'Quando a tesouraria registar movimentos, aparecem aqui.'}</p>
              </Empty>
            ) : <MovementList items={d.latest} canManage={canManage} label="Últimos movimentos" />}
          </section>

          <section className="card" aria-labelledby="fin-evo">
            <h2 id="fin-evo" className="card-title">Evolução do saldo</h2>
            {d.evolution.points.length ? (
              <>
                <BalanceChart points={d.evolution.points} granularity={d.evolution.granularity} />
                <p className="faint fin-note">
                  {d.evolution.granularity === 'mes' ? 'Saldo no fim de cada mês' : 'Saldo em cada dia com movimentos'}, de {formatDay(d.evolution.from!)} a {formatDay(d.evolution.to!)}.
                  {f.atividade ? ' A evolução é sempre da tesouraria toda: o filtro de atividade só se aplica aos totais e aos movimentos.' : ''}
                </p>
              </>
            ) : (
              <p className="faint fin-note">
                {d.opening.reference_date && f.ate && f.ate < d.opening.reference_date
                  ? `Este período é anterior ao saldo inicial (${formatDay(d.opening.reference_date)}): o saldo só é calculado a partir dessa data.`
                  : 'Sem dados de saldo para este período.'}
              </p>
            )}
          </section>

          {(hasOpen || d.by_category.length > 0) && (
            <section className="card" aria-labelledby="fin-cat">
              <h2 id="fin-cat" className="card-title">Por categoria e estado</h2>
              {hasOpen && (
                <div className="fin-table-wrap">
                  <table className="fin-table" aria-label="Pendente e previsto no período">
                    <thead><tr><th scope="col">Por confirmar</th><th scope="col">Receitas</th><th scope="col">Despesas</th><th scope="col">Resultado</th></tr></thead>
                    <tbody>
                      {(['pendente', 'previsto'] as const).map((k) => (
                        <tr key={k}>
                          <th scope="row">{k === 'pendente' ? 'Pendente' : 'Previsto'}</th>
                          <td>{formatEuros(d.totals[k].receitas)}</td><td>{formatEuros(d.totals[k].despesas)}</td><td>{formatEuros(d.totals[k].saldo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {d.by_category.length > 0 && (
                <div className="fin-table-wrap">
                  <table className="fin-table">
                    <thead><tr><th scope="col">Categoria</th><th scope="col">Efetivo</th><th scope="col">Pendente</th><th scope="col">Previsto</th></tr></thead>
                    <tbody>
                      {d.by_category.map((c) => (
                        <tr key={`${c.kind}-${c.category}`}>
                          <th scope="row">{c.category} <span className="fin-kind">{c.kind}</span></th>
                          <td>{formatEuros(c.kind === 'despesa' ? -c.efetivo : c.efetivo)}</td>
                          <td>{formatEuros(c.kind === 'despesa' ? -c.pendente : c.pendente)}</td>
                          <td>{formatEuros(c.kind === 'despesa' ? -c.previsto : c.previsto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <section className="card" aria-labelledby="fin-contas">
            <h2 id="fin-contas" className="card-title">Saldo por conta ou caixa</h2>
            {d.accounts.length === 0 ? (
              <p className="faint">{canManage ? 'Ainda não há contas nem caixas. Cria-as em «Contas e saldo inicial».' : 'Ainda não há contas nem caixas.'}</p>
            ) : (
              <ul className="list fin-accounts">
                {d.opening.mode === 'global' && (
                  <li className="list-item">
                    <span className="grow">Saldo inicial (global) <span className="faint fin-sub">em {formatDay(d.opening.reference_date!)}</span></span>
                    <span className="fin-amount">{formatEuros(d.opening.total)}</span>
                  </li>
                )}
                {d.accounts.map((a) => (
                  <li key={a.id} className="list-item">
                    <span className="grow">
                      {a.name} <span className="faint">· {a.kind === 'caixa' ? 'caixa' : 'conta'}{a.archived ? ' · arquivada' : ''}</span>
                      {a.opening && <span className="faint fin-sub">Saldo inicial {formatEuros(a.opening.amount_cents)} em {formatDay(a.opening.reference_date)} + movimentos {formatEuros(a.movimentos)}</span>}
                    </span>
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

/** A fórmula do saldo atual, com os números e a regra do saldo inicial. */
function Formula({ d, canManage }: { d: D; canManage: boolean }) {
  const c = d.current;
  const o = d.opening;
  return (
    <MoreInfo label="Como se calcula o saldo atual">
      <div className="fin-formula">
      <p className="fin-formula-text" data-testid="formula">
        <span>Saldo atual</span> = <span>Saldo inicial</span> + <span>Receitas</span> − <span>Despesas</span>
      </p>
      <p className="fin-formula-nums" data-testid="formula-valores">
        <strong>{formatEuros(c.saldo)}</strong> = {formatEuros(c.saldo_inicial)} + {formatEuros(c.receitas)} − {formatEuros(c.despesas)}
      </p>
      {o.mode === 'nenhum' ? (
        <Notice kind="info">
          Ainda não foi definido um saldo inicial: o cálculo parte de 0,00 € e soma todos os movimentos efetivos.
          {canManage && <> <Link to="/tesouraria/contas">Definir o saldo inicial</Link>.</>}
        </Notice>
      ) : (
        <div className="fin-opening" data-testid="saldo-inicial">
          <strong>Saldo inicial:</strong>{' '}
          {o.mode === 'global'
            ? <>{formatEuros(o.total)} em {formatDay(o.reference_date!)} (todas as contas e caixas)</>
            : (
              <ul className="fin-opening-list">
                {o.items.map((i) => <li key={i.id}>{i.account_name}: {formatEuros(i.amount_cents)} em {formatDay(i.reference_date)}</li>)}
              </ul>
            )}
        </div>
      )}
      <p>
        Receitas e despesas são os movimentos <strong>efetivos</strong> e não anulados desde a data do saldo inicial, em todos os períodos
        (não dependem dos filtros). Os pendentes e previstos aparecem à parte e não entram no saldo. O saldo inicial é o dinheiro que havia
        no início desse dia: os movimentos com data anterior já estão incluídos nele, por isso ficam registados mas não somam outra vez.
      </p>
      {d.before_opening.count > 0 && (
        <p data-testid="anteriores">
          {d.before_opening.count === 1 ? 'Há 1 movimento efetivo' : `Há ${d.before_opening.count} movimentos efetivos`} com data anterior ao saldo
          inicial (receitas {formatEuros(d.before_opening.receitas)}, despesas {formatEuros(d.before_opening.despesas)}): já incluídos no saldo inicial, não contam de novo.
        </p>
      )}
      </div>
    </MoreInfo>
  );
}

/**
 * Lista de movimentos: data, descrição e categoria, valor alinhado à direita (algarismos tabulares).
 * Receita com «+», despesa com «−»; o estado só aparece quando não é efetivo.
 * Quem gere abre o detalhe; quem consulta vê só os dados partilhados.
 */
export function MovementList({ items, canManage, label }: { items: SharedMovement[]; canManage: boolean; label: string }) {
  return (
    <ul className="list fin-movs" aria-label={label}>
      {items.map((m) => {
        const signed = m.kind === 'despesa' ? -m.amount_cents : m.amount_cents;
        const content = (
          <>
            <span className="fin-row-date">{formatDay(m.occurred_on)}</span>
            <span className="fin-row-main">
              <span className="fin-desc">{m.description}</span>
              <span className="faint fin-sub">
                {m.category}{m.activity_title ? ` · ${m.activity_title}` : ''}
                {canManage && m.member_name ? ` · ${m.member_name}` : ''}
                {m.mine ? ' · o teu pagamento' : ''}
                {m.before_opening ? ' · anterior ao saldo inicial' : ''}
              </span>
            </span>
            <span className="fin-row-end">
              <span className={`fin-amount ${m.kind === 'despesa' ? 'neg' : 'pos'}`}>
                {signed > 0 ? '+' : ''}{formatEuros(signed)}
              </span>
              {m.voided_at ? <Badge label={m.replaced_by ? 'Corrigido' : 'Anulado'} tone="muted" />
                : m.state !== 'efetivo' ? <Badge label={STATE_LABEL[m.state]} tone={STATE_TONE[m.state]} /> : null}
            </span>
          </>
        );
        return (
          <li key={m.id} className={m.voided_at ? 'is-voided' : undefined}>
            {canManage ? <Link className="fin-row" to={`/tesouraria/movimentos/${m.id}`}>{content}</Link>
              : m.mine ? <Link className="fin-row" to="/tesouraria/minha">{content}</Link>
              : <div className="fin-row">{content}</div>}
          </li>
        );
      })}
    </ul>
  );
}
