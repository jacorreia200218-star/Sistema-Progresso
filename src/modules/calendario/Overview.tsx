// Próximas atividades (com «O que te falta») e vista mensal.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Plus } from 'lucide-react';
import { call } from '../../lib/api';
import { useActiveSection } from '../../lib/session';
import { Empty, ErrorBox, Loading, PageTitle } from '../../components/ui';
import { useModuleCtx } from '../ModuleShell';
import { downloadFile, formatDay, formatLisbon, MONTHS, todayLisbon } from '../common';
import { addDays, addMonths, coversDay, eventDays, monthGrid, monthOf, sortKey, weekdayName, whenLabel, type CalListItem, type MyPending } from './cal';
import { buildIcs } from './ics';
import { EventRow, MissingList, useParam } from './shared';

const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;

function useEvents(from: string, to: string, onlyMine: boolean) {
  const section = useActiveSection().membership.section_id;
  const { space } = useModuleCtx();
  return useQuery({
    queryKey: ['cal-events', section, space, from, to, onlyMine],
    queryFn: () => call<CalListItem[]>('cal_events_list', { p_section: section, p_from: from, p_to: to, p_only_mine: onlyMine }),
  });
}

export function Overview() {
  const [view, setView] = useParam('vista', 'proximas');
  const [mine, setMine] = useParam('minhas');
  const { can } = useModuleCtx();
  const canManage = can('calendario.gerir', true);
  return (
    <>
      <PageTitle title="Calendário escutista" subtitle="Atividades da secção, presenças e o que falta a cada pessoa." />
      <div className="cal-toolbar">
        <div className="tabs" role="tablist" aria-label="Vistas do calendário">
          <button type="button" role="tab" className="tab" aria-selected={view !== 'mes'} onClick={() => setView('proximas', { mes: '', dia: '' })}>Próximas</button>
          <button type="button" role="tab" className="tab" aria-selected={view === 'mes'} onClick={() => setView('mes')}>Mês</button>
        </div>
        <label className="checkbox cal-mine">
          <input type="checkbox" checked={mine === '1'} onChange={(e) => setMine(e.target.checked ? '1' : '')} /> Só as minhas
        </label>
        {canManage && (
          <Link to="/calendario/nova" className="btn cal-new"><Plus size={18} aria-hidden="true" /> Nova atividade</Link>
        )}
      </div>
      {view === 'mes' ? <MonthView onlyMine={mine === '1'} /> : <Upcoming onlyMine={mine === '1'} />}
    </>
  );
}

function ExportButton({ events, name }: { events: CalListItem[]; name: string }) {
  if (!events.length) return null;
  return (
    <button type="button" className="btn secondary" onClick={() => downloadFile(`${name}.ics`, buildIcs(events), 'text/calendar;charset=utf-8')}>
      <Download size={16} aria-hidden="true" /> Exportar lista (.ics)
    </button>
  );
}

function MyPendingCard() {
  const section = useActiveSection().membership.section_id;
  const { space } = useModuleCtx();
  const q = useQuery({ queryKey: ['cal-my-pending', section, space], queryFn: () => call<MyPending[]>('cal_my_pending', { p_section: section }) });
  if (!q.data?.length) return null;
  return (
    <section className="card cal-todo" aria-labelledby="cal-todo-h">
      <h2 id="cal-todo-h">O que te falta</h2>
      <ul className="list">
        {q.data.map((p) => (
          <li key={p.id}>
            <Link to={`/calendario/evento/${p.id}`} className="list-item">
              <span className="grow">
                <span className="cal-event-title">{p.title}</span>
                <span className="cal-event-meta faint">
                  {whenLabel(p)}
                  {p.registration_deadline && <> · {p.deadline_passed ? 'Prazo terminou' : 'Prazo'}: {formatLisbon(p.registration_deadline)}</>}
                </span>
                <MissingList missing={p.missing} label="Falta-te" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Upcoming({ onlyMine }: { onlyMine: boolean }) {
  const today = todayLisbon();
  const q = useEvents(today, addDays(today, 365), onlyMine);
  const groups = useMemo(() => {
    const out: { ym: string; items: CalListItem[] }[] = [];
    for (const e of [...(q.data ?? [])].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))) {
      const ym = monthOf(eventDays(e).from < today ? today : eventDays(e).from);
      const g = out.at(-1);
      if (g?.ym === ym) g.items.push(e);
      else out.push({ ym, items: [e] });
    }
    return out;
  }, [q.data, today]);
  return (
    <>
      <MyPendingCard />
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : !groups.length ? (
        <Empty title={onlyMine ? 'Não tens atividades marcadas.' : 'Ainda não há atividades marcadas.'}>
          <p className="faint">As novas atividades aparecem aqui assim que forem criadas.</p>
        </Empty>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.ym} className="card cal-month-group" aria-label={monthLabel(g.ym)}>
              <h2 className="cal-month-title">{monthLabel(g.ym)}</h2>
              <ul className="list">{g.items.map((e) => <EventRow key={e.id} e={e} />)}</ul>
            </section>
          ))}
          <div className="btn-row cal-export"><ExportButton events={q.data ?? []} name="proximas-atividades" /></div>
        </>
      )}
    </>
  );
}

function MonthView({ onlyMine }: { onlyMine: boolean }) {
  const today = todayLisbon();
  const [ym, setYm] = useParam('mes', monthOf(today));
  const [day, setDay] = useParam('dia');
  const month = /^\d{4}-\d{2}$/.test(ym) ? ym : monthOf(today);
  const weeks = monthGrid(month);
  const q = useEvents(weeks[0][0], weeks.at(-1)![6], onlyMine);
  const events = useMemo(() => [...(q.data ?? [])].sort((a, b) => sortKey(a).localeCompare(sortKey(b))), [q.data]);
  const selected = day && day.startsWith(month) ? day : null;
  const dayEvents = selected ? events.filter((e) => coversDay(e, selected)) : events.filter((e) => {
    const r = eventDays(e);
    return r.to >= `${month}-01` && r.from <= `${month}-31`;
  });
  const go = (n: number) => setYm(addMonths(month, n), { dia: '' });

  return (
    <>
      <div className="cal-month-nav">
        <button type="button" className="btn ghost icon-btn" aria-label="Mês anterior" onClick={() => go(-1)}><ChevronLeft size={20} aria-hidden="true" /></button>
        <h2 className="cal-month-heading" aria-live="polite">{monthLabel(month)}</h2>
        <button type="button" className="btn ghost icon-btn" aria-label="Mês seguinte" onClick={() => go(1)}><ChevronRight size={20} aria-hidden="true" /></button>
        {month !== monthOf(today) && <button type="button" className="btn secondary cal-today" onClick={() => setYm(monthOf(today), { dia: '' })}>Hoje</button>}
      </div>
      {q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : (
        <div className="cal-grid" role="grid" aria-label={`Calendário de ${monthLabel(month)}`} aria-busy={q.isLoading}>
          <div className="cal-grid-row cal-grid-head" role="row">
            {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => <span key={d} role="columnheader" className="cal-wd">{d}</span>)}
          </div>
          {weeks.map((w) => (
            <div key={w[0]} className="cal-grid-row" role="row">
              {w.map((d) => {
                const evs = events.filter((e) => coversDay(e, d));
                const out = !d.startsWith(month);
                return (
                  <button key={d} type="button" role="gridcell" aria-selected={selected === d}
                    className={`cal-day${out ? ' is-out' : ''}${d === today ? ' is-today' : ''}${selected === d ? ' is-selected' : ''}`}
                    aria-label={`${weekdayName(d)}, ${formatDay(d)}${evs.length ? `, ${evs.length} ${evs.length === 1 ? 'atividade' : 'atividades'}` : ''}`}
                    onClick={() => setDay(selected === d ? '' : d, d.startsWith(month) ? {} : { mes: monthOf(d) })}>
                    <span className="cal-day-n">{Number(d.slice(8))}</span>
                    <span className="cal-day-events" aria-hidden="true">
                      {evs.slice(0, 3).map((e) => (
                        <span key={e.id} className={`cal-chip${e.status === 'cancelado' ? ' is-cancelled' : ''}${e.my_missing?.length ? ' has-missing' : ''}`}>{e.title}</span>
                      ))}
                      {evs.length > 3 && <span className="cal-more">+{evs.length - 3}</span>}
                    </span>
                    {evs.length > 0 && <span className="cal-dots" aria-hidden="true">{evs.slice(0, 3).map((e) => <i key={e.id} />)}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <section className="card cal-day-list" aria-labelledby="cal-day-h">
        <div className="row between">
          <h2 id="cal-day-h">{selected ? `${weekdayName(selected)}, ${formatDay(selected)}` : `Atividades de ${monthLabel(month)}`}</h2>
          {selected && <button type="button" className="btn ghost" onClick={() => setDay('')}>Ver o mês todo</button>}
        </div>
        {q.isLoading ? <Loading compact /> : dayEvents.length ? (
          <ul className="list">{dayEvents.map((e) => <EventRow key={e.id} e={e} />)}</ul>
        ) : (
          <p className="faint">{selected ? 'Sem atividades neste dia.' : 'Sem atividades neste mês.'}</p>
        )}
        <div className="btn-row"><ExportButton events={dayEvents} name={`atividades-${month}`} /></div>
      </section>
    </>
  );
}
