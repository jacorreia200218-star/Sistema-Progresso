// Página inicial: quadro (membros × sessões), sessões, pessoas e resumo para quem regista;
// «As minhas presenças» para os restantes. Filtros e vista ficam no endereço.
import { Link } from 'react-router-dom';
import { BarChart3, CalendarDays, Plus, Table2, Users } from 'lucide-react';
import { Empty, ErrorBox, Loading, PageTitle } from '../../components/ui';
import { useActiveSection } from '../../lib/session';
import { formatDay, todayLisbon } from '../common';
import { useModuleCtx } from '../ModuleShell';
import { formatRate, KIND_LABEL, useBoard, useNarrow, type Board, type Cell, type Stats } from './api';
import { MemberView } from './MemberPage';
import { Filters, Legend, markLabel, periodQuery, StatsTiles, StatusMark, useParam, usePeriod } from './parts';

type View = 'quadro' | 'sessoes' | 'pessoas' | 'resumo';

export function Home() {
  const canRegister = useModuleCtx().can('presencas.registar', true);
  return canRegister ? <RegisterHome /> : <MyHome />;
}

function MyHome() {
  const me = useActiveSection().membership.id;
  return (
    <>
      <PageTitle title="Presenças" />
      <MemberView membershipId={me} self />
    </>
  );
}

function RegisterHome() {
  const today = todayLisbon();
  const period = usePeriod(today);
  const [team] = useParam('equipa');
  const [viewParam, setView] = useParam('vista');
  const narrow = useNarrow();
  const board = useBoard(period.from, period.to, team);
  const view: View = (['quadro', 'sessoes', 'pessoas', 'resumo'] as View[]).includes(viewParam as View)
    ? (narrow && viewParam === 'quadro' ? 'sessoes' : (viewParam as View))
    : narrow ? 'sessoes' : 'quadro';
  const tabs: [View, string, typeof Table2][] = [
    ...(narrow ? [] : [['quadro', 'Quadro', Table2] as [View, string, typeof Table2]]),
    ['sessoes', 'Sessões', CalendarDays], ['pessoas', 'Pessoas', Users], ['resumo', 'Resumo', BarChart3],
  ];
  const d = board.data;
  return (
    <div className="pres-wide">
      <PageTitle title="Presenças"
        actions={<Link to="/presencas/nova" className="btn"><Plus size={16} aria-hidden="true" /> Nova sessão</Link>}
        info={<p>Assiduidade de pioneiros e guias. Cada sessão (reunião ou atividade) conta para quem estava ativo nessa data.</p>} />
      <Filters today={today} teams={d?.teams ?? []} />
      <div className="pres-toolbar">
        <nav className="tabs" aria-label="Vistas das presenças">
          {tabs.map(([k, label, Icon]) => (
            <button key={k} type="button" className="tab" aria-selected={view === k} onClick={() => setView(k)}>
              <Icon size={16} aria-hidden="true" /> {label}
            </button>
          ))}
        </nav>
        <span className="faint pres-small pres-period">{period.label[0].toUpperCase() + period.label.slice(1)}</span>
      </div>
      {board.isLoading && <Loading />}
      <ErrorBox error={board.error} retry={() => board.refetch()} />
      {d && view === 'quadro' && <BoardTable d={d} />}
      {d && view === 'sessoes' && <SessionList d={d} />}
      {d && view === 'pessoas' && <PeopleList d={d} />}
      {d && view === 'resumo' && <Summary d={d} />}
    </div>
  );
}

function NoSessions() {
  return (
    <div className="card">
      <Empty title="Não há sessões neste período.">
        <p className="faint pres-small pres-center">Cria uma com «Nova sessão» ou escolhe outro período.</p>
      </Empty>
    </div>
  );
}

function NoMembers() {
  return (
    <div className="card">
      <Empty title="Não há pioneiros nem guias neste filtro.">
        <p className="faint pres-small pres-center">Experimenta outra equipa ou outro período.</p>
      </Empty>
    </div>
  );
}

const cellKey = (s: string, m: string) => `${s}|${m}`;
/** Dia curto («16/10») para cabeçalhos compactos; a data completa vai no title/aria-label. */
const dm = (d: string) => formatDay(d).slice(0, 5);

/** Quadro (computador): membros nas linhas, sessões nas colunas. */
function BoardTable({ d }: { d: Board }) {
  if (d.sessions.length === 0) return <NoSessions />;
  if (d.members.length === 0) return <NoMembers />;
  const cells = new Map<string, Cell>(d.cells.map((c) => [cellKey(c.s, c.m), c]));
  const q = periodQuery();
  const groups: { team: string; rows: typeof d.members }[] = [];
  for (const m of d.members) {
    const t = m.team_name ?? 'Sem equipa';
    if (groups.at(-1)?.team !== t) groups.push({ team: t, rows: [] });
    groups.at(-1)!.rows.push(m);
  }
  const cols = d.sessions.length + 7;
  return (
    <div className="card flat pres-board">
      <div className="pres-table-wrap" role="region" aria-label="Quadro de presenças" tabIndex={0}>
        <table className="pres-table">
          <caption className="sr-only">Presenças por membro (linhas) e sessão (colunas), ordenadas por equipa e nome.</caption>
          <thead>
            <tr>
              <th scope="col" className="pres-name-col">Membro</th>
              {d.sessions.map((s) => {
                const full = `${formatDay(s.date)} · ${s.title}${s.team_name ? ` · ${s.team_name}` : ''}${s.status === 'cancelada' ? ' (cancelada)' : s.future ? ' (futura)' : ''}`;
                return (
                  <th key={s.id} scope="col" className={`pres-sess-col${s.status === 'cancelada' ? ' cancelled' : ''}${s.future ? ' future' : ''}`}>
                    <Link to={`/presencas/sessoes/${s.id}${q}`} title={full}>
                      <span className="pres-col-date" aria-hidden="true">{dm(s.date)}</span>
                      {d.sessions.length <= 10 && <span className="pres-col-title" aria-hidden="true">{s.title}</span>}
                      <span className="sr-only">{full}</span>
                    </Link>
                  </th>
                );
              })}
              <th scope="col" className="pres-num pres-num-first" title="Presenças">P</th>
              <th scope="col" className="pres-num" title="Faltas justificadas">FJ</th>
              <th scope="col" className="pres-num" title="Faltas injustificadas">FI</th>
              <th scope="col" className="pres-num" title="Por registar">PR</th>
              <th scope="col" className="pres-num" title="Taxa de assiduidade">Taxa</th>
              <th className="pres-fill" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => [
              <tr key={`g-${g.team}`} className="pres-group"><th scope="rowgroup" colSpan={cols}><span>{g.team}</span></th></tr>,
              ...g.rows.map((m) => (
                <tr key={m.membership_id}>
                  <th scope="row" className="pres-name-col" title={`${m.name}${m.active ? '' : ' (saiu)'}`}>
                    <span className="pres-name">
                      <Link to={`/presencas/pessoas/${m.membership_id}${q}`}>{m.name}</Link>
                      {!m.active && <span className="faint pres-small"> (saiu)</span>}
                    </span>
                  </th>
                  {d.sessions.map((s) => {
                    const c = cells.get(cellKey(s.id, m.membership_id));
                    if (!c) return <td key={s.id} className="pres-cell na"><span aria-hidden="true">·</span><span className="sr-only">Não se aplica</span></td>;
                    return (
                      <td key={s.id} className="pres-cell">
                        <Link to={`/presencas/sessoes/${s.id}${q}${q ? '&' : '?'}pessoa=${m.membership_id}`}
                          aria-label={`${m.name}, ${formatDay(s.date)}: ${markLabel(c.category, c.partial)}`}>
                          <StatusMark category={c.category} partial={c.partial} compact />
                        </Link>
                      </td>
                    );
                  })}
                  <Nums s={m.stats} />
                  <td className="pres-fill" aria-hidden="true" />
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <Legend />
    </div>
  );
}

function Nums({ s }: { s: Stats }) {
  return (
    <>
      <td className="pres-num pres-num-first">{s.presencas}{s.parciais > 0 && <span className="faint pres-small" title="parciais"> ({s.parciais}p)</span>}</td>
      <td className="pres-num">{s.justificadas}</td>
      <td className="pres-num">{s.injustificadas}</td>
      <td className="pres-num">{s.por_registar}</td>
      <td className="pres-num"><strong>{formatRate(s.taxa)}</strong></td>
    </>
  );
}

/** Lista de sessões (telemóvel e computador). */
function SessionList({ d }: { d: Board }) {
  if (d.sessions.length === 0) return <NoSessions />;
  const q = periodQuery();
  return (
    <ul className="list card pres-list" aria-label="Sessões">
      {[...d.sessions].reverse().map((s) => (
        <li key={s.id}>
          <Link to={`/presencas/sessoes/${s.id}${q}`} className="list-item pres-row">
            <div className="pres-date-chip" aria-hidden="true">{dm(s.date)}</div>
            <div className="grow">
              <div className="pres-row-title">{s.title}</div>
              <div className="faint pres-small">
                {formatDay(s.date)} · {KIND_LABEL[s.kind]} · {s.team_name ?? 'Secção'}{s.cal_event_id ? ' · Calendário' : ''}
              </div>
            </div>
            <span className="pres-row-side">
              {s.status === 'cancelada' ? <StatusMark category="cancelada" />
                : s.future ? <StatusMark category="futura" />
                : <span className={`pres-count${s.registered < s.applicable ? ' pending' : ''}`}>{s.registered}/{s.applicable} registadas</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Lista de pessoas com contagens (sem ordenação por taxa). */
function PeopleList({ d }: { d: Board }) {
  if (d.members.length === 0) return <NoMembers />;
  const q = periodQuery();
  return (
    <ul className="list card pres-list" aria-label="Pessoas">
      {d.members.map((m) => (
        <li key={m.membership_id}>
          <Link to={`/presencas/pessoas/${m.membership_id}${q}`} className="list-item pres-row">
            <div className="grow">
              <div className="pres-row-title">{m.name}{!m.active && <span className="faint pres-small"> (saiu)</span>}</div>
              <div className="faint pres-small">
                {m.team_name ?? 'Sem equipa'} · {m.stats.presencas} P{m.stats.parciais ? ` (${m.stats.parciais} parc.)` : ''} · {m.stats.justificadas} FJ · {m.stats.injustificadas} FI
                {m.stats.por_registar > 0 && ` · ${m.stats.por_registar} por registar`}
              </div>
            </div>
            <span className="pres-rate-pill" aria-label={`Taxa de assiduidade ${formatRate(m.stats.taxa)}`}>{formatRate(m.stats.taxa)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const monthName = (ym: string) => {
  const m = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'][Number(ym.slice(5, 7)) - 1];
  return `${m} ${ym.slice(0, 4)}`;
};

/** Resumo do período, por equipa e por mês. */
function Summary({ d }: { d: Board }) {
  return (
    <>
      <section className="card">
        <h2 className="pres-h2">Período selecionado</h2>
        <StatsTiles stats={d.totals} label="Indicadores do período" />
      </section>
      <section className="card">
        <h2 className="pres-h2">Por equipa</h2>
        {d.by_team.length === 0 ? <p className="faint pres-small">Sem dados neste período.</p> : (
          <SummaryTable first="Equipa" rows={d.by_team.map((t) => ({ key: t.team_id ?? 'sem', label: t.team_name ?? 'Sem equipa', extra: `${t.members} ${t.members === 1 ? 'pessoa' : 'pessoas'}`, s: t.stats }))} />
        )}
      </section>
      <section className="card">
        <h2 className="pres-h2">Por mês</h2>
        {d.by_month.length === 0 ? <p className="faint pres-small">Sem dados neste período.</p> : (
          <SummaryTable first="Mês" rows={d.by_month.map((m) => ({ key: m.month, label: monthName(m.month), extra: `${m.sessions} ${m.sessions === 1 ? 'sessão' : 'sessões'}`, s: m.stats }))} />
        )}
      </section>
    </>
  );
}

function SummaryTable({ first, rows }: { first: string; rows: { key: string; label: string; extra: string; s: Stats }[] }) {
  return (
    <div className="pres-sum-wrap">
      <table className="pres-sum">
        <thead>
          <tr>
            <th scope="col">{first}</th>
            <th scope="col" className="pres-num" title="Presenças">P</th>
            <th scope="col" className="pres-num" title="Faltas justificadas">FJ</th>
            <th scope="col" className="pres-num" title="Faltas injustificadas">FI</th>
            <th scope="col" className="pres-num" title="Por registar">PR</th>
            <th scope="col" className="pres-num">Taxa</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}<span className="faint pres-small pres-block">{r.extra}</span></th>
              <Nums s={r.s} />
            </tr>
          ))}
        </tbody>
      </table>
      <p className="faint pres-small">P: presenças (parciais entre parênteses) · FJ: faltas justificadas · FI: faltas injustificadas · PR: por registar.</p>
    </div>
  );
}
