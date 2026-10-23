// Vista principal: calendário anual (ano civil ou ano escutista) ou de um mês (grelha grande
// com as atividades nos dias e a lista do mês por baixo), com feriados, fins de
// semana, dias com atividades e dias sem atividades registadas; por baixo (no telemóvel,
// «O que te falta» por cima), um resumo curto: as três pendências mais próximas, as próximas
// atividades e as datas para planear. Vista secundária: lista completa das próximas atividades.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, ChevronLeft, ChevronRight, Download, Plus, Settings, X } from 'lucide-react';
import { call } from '../../lib/api';
import { useActiveSection } from '../../lib/session';
import { Empty, ErrorBox, Loading, MoreMenu, Notice, PageTitle } from '../../components/ui';
import { useModuleCtx } from '../ModuleShell';
import { downloadFile, formatDay, lisbonTime, MONTHS, todayLisbon } from '../common';
import {
  addDays, addMonths, busyDays, coversDay, eventDays, monthOf, period, sortKey, weekday, weekdayName, yearOf,
  type CalListItem, type Period, type YearMode,
} from './cal';
import { dayMarks, freeSlots, isHoliday, MARK_LABEL, type DayMark, type FreeSlot, type SpecialDay } from './holidays';
import { buildIcs } from './ics';
import { EventRow, useParam } from './shared';
import { PendingCard, PendingStrip, usePendingSummary } from './Pending';

export interface CalConfig { year_start_month: number; can_manage: boolean; special_days: SpecialDay[] }

const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;

function useEvents(from: string, to: string, enabled = true) {
  const section = useActiveSection().membership.section_id;
  const { space } = useModuleCtx();
  return useQuery({
    queryKey: ['cal-events', section, space, from, to],
    queryFn: () => call<CalListItem[]>('cal_events_list', { p_section: section, p_from: from, p_to: to, p_only_mine: false }),
    enabled,
  });
}

export function useCalConfig() {
  const section = useActiveSection().membership.section_id;
  const { space } = useModuleCtx();
  return useQuery({ queryKey: ['cal-config', section, space], queryFn: () => call<CalConfig>('cal_config', { p_section: section }) });
}

export function Overview() {
  const [view, setView] = useParam('vista', 'ano');
  const [mode] = useParam('tipo', 'escutista');
  const [mine, setMine] = useParam('minhas');
  const { can } = useModuleCtx();
  const canManage = can('calendario.gerir', true);
  const current = view === 'lista' ? 'lista' : view === 'mes' ? 'mes' : mode === 'civil' ? 'civil' : 'escutista';
  const flash = (useLocation().state as { flash?: string } | null)?.flash;
  return (
    <div className="cal-page">
      <PageTitle title="Calendário escutista" actions={canManage && (
        <>
          <Link to="/calendario/nova" className="btn"><Plus size={18} aria-hidden="true" /> Nova atividade</Link>
          <MoreMenu>
            <Link to="/calendario/configurar" className="btn"><Settings size={16} aria-hidden="true" /> Dias especiais</Link>
          </MoreMenu>
        </>
      )} />
      {flash && <Notice kind="success">{flash}</Notice>}
      <div className="cal-toolbar">
        <div className="tabs" role="tablist" aria-label="Vistas do calendário">
          <button type="button" role="tab" className="tab" aria-selected={current === 'escutista'} onClick={() => setView('ano', { tipo: '', ano: '', dia: '', mes: '' })}>Ano escutista</button>
          <button type="button" role="tab" className="tab" aria-selected={current === 'mes'} onClick={() => setView('mes', { tipo: '', ano: '', dia: '' })}>Mês</button>
          <button type="button" role="tab" className="tab" aria-selected={current === 'civil'} onClick={() => setView('ano', { tipo: 'civil', ano: '', dia: '', mes: '' })}>Ano civil</button>
          <button type="button" role="tab" className="tab" aria-selected={current === 'lista'} onClick={() => setView('lista', { dia: '', mes: '' })}>Lista</button>
        </div>
        <label className="checkbox cal-mine">
          <input type="checkbox" checked={mine === '1'} onChange={(e) => setMine(e.target.checked ? '1' : '')} /> Só as minhas
        </label>
      </div>
      {current === 'lista' ? <Upcoming onlyMine={mine === '1'} />
        : current === 'mes' ? <MonthView onlyMine={mine === '1'} />
        : <YearView mode={current} onlyMine={mine === '1'} />}
    </div>
  );
}

function ExportButton({ events, name, label = 'Exportar lista (.ics)' }: { events: CalListItem[]; name: string; label?: string }) {
  if (!events.length) return null;
  return (
    <button type="button" className="btn secondary" onClick={() => downloadFile(`${name}.ics`, buildIcs(events), 'text/calendar;charset=utf-8')}>
      <Download size={16} aria-hidden="true" /> {label}
    </button>
  );
}

/** Ecrã estreito (telemóvel). */
function useNarrow(query = '(max-width: 640px)') {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

// ---------------------------------------------------------------------------
// Lista completa das próximas atividades (vista secundária)
// ---------------------------------------------------------------------------
function Upcoming({ onlyMine }: { onlyMine: boolean }) {
  const today = todayLisbon();
  const q = useEvents(today, addDays(today, 365));
  const groups = useMemo(() => {
    const out: { ym: string; items: CalListItem[] }[] = [];
    const items = (q.data ?? []).filter((e) => !onlyMine || e.involved);
    for (const e of [...items].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))) {
      const ym = monthOf(eventDays(e).from < today ? today : eventDays(e).from);
      const g = out.at(-1);
      if (g?.ym === ym) g.items.push(e);
      else out.push({ ym, items: [e] });
    }
    return out;
  }, [q.data, today, onlyMine]);
  const pending = usePendingSummary();
  return (
    <>
      <PendingCard s={pending} />
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
          <div className="btn-row cal-export"><ExportButton events={groups.flatMap((g) => g.items)} name="proximas-atividades" /></div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Calendário anual
// ---------------------------------------------------------------------------
function YearView({ mode, onlyMine }: { mode: YearMode; onlyMine: boolean }) {
  const today = todayLisbon();
  const cfg = useCalConfig();
  const [yearParam, setYear] = useParam('ano');
  const [day, setDay] = useParam('dia');
  const [range, setRange] = useParam('livres_de');
  const narrow = useNarrow();
  const pending = usePendingSummary();
  const thisYear = yearOf(today, mode);
  const year = /^\d{4}$/.test(yearParam) ? Number(yearParam) : thisYear;
  const p = period(mode, year);
  const q = useEvents(p.from, p.to, !cfg.isLoading);
  const all = useMemo(() => [...(q.data ?? [])].sort((a, b) => sortKey(a).localeCompare(sortKey(b))), [q.data]);
  const shown = useMemo(() => (onlyMine ? all.filter((e) => e.involved) : all), [all, onlyMine]);
  const marks = useMemo(() => dayMarks(p.from, p.to, cfg.data?.special_days ?? []), [p.from, p.to, cfg.data]);
  const busyAll = useMemo(() => busyDays(all, p.from, p.to), [all, p.from, p.to]);
  const busyShown = useMemo(() => (onlyMine ? busyDays(shown, p.from, p.to) : busyAll), [onlyMine, shown, busyAll, p.from, p.to]);
  // Datas sem atividades: por omissão só a partir de hoje (se o período já começou e ainda não acabou).
  const canFuture = p.from < today && today <= p.to;
  const futureOnly = canFuture && range !== 'inicio';
  const freeFrom = futureOnly ? today : p.from;
  const free = useMemo(() => freeSlots(freeFrom, p.to, busyAll, marks), [freeFrom, p.to, busyAll, marks]);
  const freeAll = useMemo(() => (freeFrom === p.from ? free : freeSlots(p.from, p.to, busyAll, marks)), [free, freeFrom, p.from, p.to, busyAll, marks]);
  const freeAllDays = useMemo(() => slotDays(freeAll), [freeAll]);
  const selected = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  const ready = !cfg.isLoading && !q.isLoading;
  const pickRef = useRef(setDay);
  pickRef.current = setDay;
  const pick = useCallback((d: string) => pickRef.current(d), []);

  // «Hoje» abre o dia de hoje; «Ir para o mês atual» desloca até ao mês atual. Ambos mantêm a vista anual.
  const toMonth = useRef(false);
  const scrollToCurrent = () => {
    document.getElementById(`mes-${monthOf(today)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelector<HTMLElement>(`button[data-day="${today}"]`)?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (toMonth.current && year === thisYear) { toMonth.current = false; scrollToCurrent(); }
  });
  const go = (y: number) => setYear(y === thisYear ? '' : String(y), { dia: '' });
  const goToday = () => (year === thisYear ? setDay(today) : setYear('', { dia: today }));
  const goMonth = () => {
    if (year === thisYear) scrollToCurrent();
    else { toMonth.current = true; go(thisYear); }
  };

  return (
    <>
      <div className="cal-year-nav">
        <div className="cal-year-step">
          <button type="button" className="btn ghost icon-btn" aria-label="Ano anterior" onClick={() => go(year - 1)}><ChevronLeft size={20} aria-hidden="true" /></button>
          <h2 className="cal-year-heading" aria-live="polite">{mode === 'escutista' ? `Ano escutista ${p.label}` : `Ano ${p.label}`}</h2>
          <button type="button" className="btn ghost icon-btn" aria-label="Ano seguinte" onClick={() => go(year + 1)}><ChevronRight size={20} aria-hidden="true" /></button>
        </div>
        <div className="cal-year-jump">
          <button type="button" className="btn secondary cal-today" onClick={goToday}><CalendarCheck size={16} aria-hidden="true" /> Hoje</button>
          <button type="button" className="btn ghost cal-to-month" onClick={goMonth}>Ir para o mês atual</button>
        </div>
      </div>
      {mode === 'escutista' && (
        <p className="faint cal-period-hint">De {formatDay(p.from)} a {formatDay(p.to)}</p>
      )}
      {cfg.error || q.error ? <ErrorBox error={cfg.error ?? q.error} retry={() => { cfg.refetch(); q.refetch(); }} /> : (
        <div className="cal-year-layout">
          {!narrow && <PendingStrip s={pending} />}
          <div className="cal-year-main">
            <MonthJump months={p.months} today={today} />
            {/* Os meses abertos, um por baixo do outro, como na vista «Mês». */}
            <div className="cal-year-open" aria-busy={!ready}>
              {p.months.map((ym) => (
                <section key={ym} id={`mes-${ym}`} className="cal-year-month" aria-labelledby={`cal-om-${ym}`}>
                  <h3 id={`cal-om-${ym}`} className="cal-year-month-title">
                    <Link to={`/calendario?vista=mes&mes=${ym}`} className="cal-mm-link">{monthLabel(ym)}</Link>
                  </h3>
                  <MonthGrid ym={ym} events={shown.filter((e) => { const r = eventDays(e); return r.from <= `${ym}-31` && r.to >= `${ym}-01`; })}
                    marks={marks} busy={busyShown} today={today} selected={selected && monthOf(selected) === ym ? selected : null}
                    onPick={pick} narrow={narrow} busyState={!ready} />
                </section>
              ))}
            </div>
          </div>
          <div className="cal-summary" role="region" aria-label="Resumo">
            <PendingCard s={pending} counters={narrow} />
            <NextEvents onlyMine={onlyMine} exclude={pending.shownIds} />
            <FreeCard free={free} p={p} from={freeFrom} canFuture={canFuture} futureOnly={futureOnly}
              setFutureOnly={(on) => setRange(on ? '' : 'inicio')} onPick={(d) => setDay(d)} />
          </div>
          <MarksList p={p} marks={marks} busy={busyAll} onPick={(d) => setDay(d)} />
          {ready && shown.length > 0 && (
            <div className="btn-row cal-export"><ExportButton events={shown} name={`atividades-${p.label.replace('/', '-')}`} label={`Exportar ${p.label} (.ics)`} /></div>
          )}
        </div>
      )}
      {selected && (
        <DayDialog day={selected} events={shown.filter((e) => coversDay(e, selected))} marks={marks.get(selected) ?? []}
          free={freeAllDays.has(selected)} onClose={() => setDay('')} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Mês: grelha grande com as atividades nos dias e a lista do mês por baixo
// ---------------------------------------------------------------------------
function MonthView({ onlyMine }: { onlyMine: boolean }) {
  const today = todayLisbon();
  const cfg = useCalConfig();
  const [monthParam, setMonth] = useParam('mes');
  const [day, setDay] = useParam('dia');
  const narrow = useNarrow();
  const ym = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : monthOf(today);
  const from = `${ym}-01`;
  const to = addDays(`${addMonths(ym, 1)}-01`, -1);
  const q = useEvents(from, to, !cfg.isLoading);
  const shown = useMemo(() => (q.data ?? []).filter((e) => !onlyMine || e.involved).sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
    [q.data, onlyMine]);
  const marks = useMemo(() => dayMarks(from, to, cfg.data?.special_days ?? []), [from, to, cfg.data]);
  const busy = useMemo(() => busyDays(shown, from, to), [shown, from, to]);
  const selected = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  const go = (m: string) => setMonth(m === monthOf(today) ? '' : m, { dia: '' });
  const active = shown.filter((e) => e.status === 'ativo');
  return (
    <>
      <div className="cal-year-nav">
        <div className="cal-year-step">
          <button type="button" className="btn ghost icon-btn" aria-label="Mês anterior" onClick={() => go(addMonths(ym, -1))}><ChevronLeft size={20} aria-hidden="true" /></button>
          <h2 className="cal-year-heading cal-month-heading" aria-live="polite">{monthLabel(ym)}</h2>
          <button type="button" className="btn ghost icon-btn" aria-label="Mês seguinte" onClick={() => go(addMonths(ym, 1))}><ChevronRight size={20} aria-hidden="true" /></button>
        </div>
        <div className="cal-year-jump">
          <button type="button" className="btn secondary cal-today" onClick={() => setMonth('', { dia: today })}><CalendarCheck size={16} aria-hidden="true" /> Hoje</button>
        </div>
      </div>
      {cfg.error || q.error ? <ErrorBox error={cfg.error ?? q.error} retry={() => { cfg.refetch(); q.refetch(); }} /> : (
        <>
          <MonthGrid ym={ym} events={shown} marks={marks} busy={busy} today={today} selected={selected} onPick={setDay} narrow={narrow} busyState={q.isLoading} />
          <section className="card cal-month-group" aria-labelledby="cal-month-list-h">
            <h2 id="cal-month-list-h" className="cal-month-title">Atividades de {MONTHS[Number(ym.slice(5, 7)) - 1]}</h2>
            {q.isLoading ? <Loading compact rows={2} /> : shown.length ? (
              <ul className="list">{shown.map((e) => <EventRow key={e.id} e={e} />)}</ul>
            ) : <p className="faint">{onlyMine ? 'Não tens atividades neste mês.' : 'Sem atividades neste mês.'}</p>}
          </section>
          {active.length > 0 && (
            <div className="btn-row cal-export"><ExportButton events={active} name={`atividades-${ym}`} label={`Exportar ${MONTHS[Number(ym.slice(5, 7)) - 1]} (.ics)`} /></div>
          )}
        </>
      )}
      {selected && (
        <DayDialog day={selected} events={shown.filter((e) => coversDay(e, selected))} marks={marks.get(selected) ?? []} free={false} onClose={() => setDay('')} />
      )}
    </>
  );
}

/** Mês aberto: grelha grande com as atividades dentro dos dias (vista «Mês» e, no telemóvel, o ano). */
function MonthGrid({ ym, events, marks, busy, today, selected, onPick, narrow, busyState }: {
  ym: string; events: CalListItem[]; marks: Map<string, DayMark[]>; busy: Map<string, number>; today: string;
  selected: string | null; onPick: (d: string) => void; narrow: boolean; busyState: boolean;
}) {
  const from = `${ym}-01`;
  const to = addDays(`${addMonths(ym, 1)}-01`, -1);
  const lead = weekday(from);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const trail = (7 - ((lead + days.length) % 7)) % 7;
  return (
    <div className={`card cal-month${narrow ? ' is-narrow' : ''}`} aria-busy={busyState}>
      <div className="cal-month-grid" aria-label={monthLabel(ym)}>
        {WD_SHORT.map((w, i) => <abbr key={w} title={WD_FULL[i]} className={`cal-month-wd${i >= 5 ? ' is-weekend' : ''}`}>{narrow ? WD[i] : w}</abbr>)}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} className="cal-month-blank" aria-hidden="true" />)}
        {days.map((d) => {
          const m = marks.get(d) ?? [];
          const evs = events.filter((e) => coversDay(e, d));
          const cls = ['cal-month-day'];
          if (weekday(d) >= 5) cls.push('is-weekend');
          if (isHoliday(m)) cls.push('is-holiday');
          if (d === today) cls.push('is-today');
          if (selected === d) cls.push('is-selected');
          const label = dayLabel(d, m, busy.get(d) ?? 0, false, today);
          return (
            <div key={d} className={cls.join(' ')}>
              {narrow ? (
                // Telemóvel: o dia inteiro é o botão (abre o dia); dentro, os nomes das atividades
                <button type="button" className="cal-month-cell" data-day={d} aria-label={label} title={label}
                  aria-current={d === today ? 'date' : undefined} onClick={() => onPick(d)}>
                  <span className="cal-month-dn">{Number(d.slice(8))}</span>
                  {evs.slice(0, 3).map((e) => (
                    <span key={e.id} className={`cal-chip${e.status === 'cancelado' ? ' is-cancelled' : ''}`} aria-hidden="true">{e.title}</span>
                  ))}
                  {evs.length > 3 && <span className="cal-chip-more" aria-hidden="true">+{evs.length - 3}</span>}
                </button>
              ) : (
                <button type="button" className="cal-month-dn" data-day={d} aria-label={label} title={label}
                  aria-current={d === today ? 'date' : undefined} onClick={() => onPick(d)}>
                  {Number(d.slice(8))}
                </button>
              )}
              {!narrow && (
                <>
                  {m.length > 0 && <span className="cal-month-mark">{m[0].name}</span>}
                  <ul className="cal-month-events">
                    {evs.slice(0, 3).map((e) => (
                      <li key={e.id}>
                        <Link to={`/calendario/evento/${e.id}`} className={`cal-chip${e.status === 'cancelado' ? ' is-cancelled' : ''}`} title={e.title}>
                          {!e.all_day && eventDays(e).from === d && <span className="cal-chip-time">{lisbonTime(e.starts_at!)}</span>}
                          {e.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {evs.length > 3 && <button type="button" className="cal-chip-more" onClick={() => onPick(d)}>+{evs.length - 3}</button>}
                </>
              )}
            </div>
          );
        })}
        {Array.from({ length: trail }, (_, i) => <span key={`t${i}`} className="cal-month-blank" aria-hidden="true" />)}
      </div>
    </div>
  );
}

function slotDays(slots: FreeSlot[]) {
  const s = new Set<string>();
  for (const f of slots) for (let d = f.from; d <= f.to; d = addDays(d, 1)) s.add(d);
  return s;
}

const WD = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
const WD_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const WD_FULL = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function dayLabel(d: string, marks: DayMark[], n: number, free: boolean, today: string) {
  const parts = [`${weekdayName(d)}, ${formatDay(d)}`];
  if (d === today) parts.push('hoje');
  for (const m of marks) parts.push(`${m.kind === 'relevante' ? '' : `${MARK_LABEL[m.kind].toLowerCase()}: `}${m.name}`);
  if (n) parts.push(`${n} ${n === 1 ? 'atividade' : 'atividades'}`);
  else if (free) parts.push('sem atividades registadas');
  return parts.join(', ');
}

/** Telemóvel: atalhos para cada mês (os meses ficam em coluna, com os dias em tamanho confortável). */
function MonthJump({ months, today }: { months: string[]; today: string }) {
  return (
    <nav className="cal-month-jump" aria-label="Ir para o mês">
      {months.map((ym) => (
        <a key={ym} href={`#mes-${ym}`} className={`cal-jump${monthOf(today) === ym ? ' is-current' : ''}`}
          onClick={(e) => { e.preventDefault(); document.getElementById(`mes-${ym}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
          {MONTH_SHORT[Number(ym.slice(5, 7)) - 1]}
        </a>
      ))}
    </nav>
  );
}

function MarksList({ p, marks, busy, onPick }: { p: Period; marks: Map<string, DayMark[]>; busy: Map<string, number>; onPick: (d: string) => void }) {
  const rows = [...marks].sort(([a], [b]) => a.localeCompare(b));
  return (
    <details className="card cal-marks">
      <summary>Feriados e dias relevantes ({p.label})</summary>
      <ul className="cal-marks-list">
        {rows.flatMap(([d, ms]) => ms.map((m, i) => (
          <li key={`${d}-${i}`}>
            <button type="button" className="cal-mark-btn" onClick={() => onPick(d)}>
              <span className={`cal-key ${m.kind === 'relevante' ? 'key-relevant' : 'key-holiday'}`} aria-hidden="true" />
              <span className="cal-mark-date">{formatDay(d)}</span>
              <span className="grow">{m.name}<span className="faint"> · {MARK_LABEL[m.kind]}{m.movable ? ' (móvel)' : ''}{busy.get(d) ? ' · com atividades' : ''}</span></span>
            </button>
          </li>
        )))}
      </ul>
    </details>
  );
}

/** Próximas atividades (até três), sem repetir as que já aparecem em «O que te falta». */
function NextEvents({ onlyMine, exclude }: { onlyMine: boolean; exclude: Set<string> }) {
  const today = todayLisbon();
  const q = useEvents(today, addDays(today, 365));
  const next = (q.data ?? []).filter((e) => e.status === 'ativo' && (!onlyMine || e.involved) && !exclude.has(e.id))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b))).slice(0, 3);
  return (
    <section className="card cal-next" aria-labelledby="cal-next-h">
      <h2 id="cal-next-h">Próximas atividades</h2>
      {q.isLoading ? <Loading compact rows={2} /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : next.length ? (
        <>
          <ul className="list">{next.map((e) => <EventRow key={e.id} e={e} />)}</ul>
          <Link to="/calendario?vista=lista" className="btn ghost cal-see-all">Ver todas</Link>
        </>
      ) : <p className="faint">{exclude.size ? 'Sem outras atividades marcadas.' : onlyMine ? 'Não tens atividades marcadas.' : 'Ainda não há atividades marcadas.'}</p>}
    </section>
  );
}

/** Fins de semana e feriados sem atividades registadas da secção (não é disponibilidade confirmada). */
function FreeCard({ free, p, from, canFuture, futureOnly, setFutureOnly, onPick }: {
  free: FreeSlot[]; p: Period; from: string; canFuture: boolean; futureOnly: boolean; setFutureOnly: (on: boolean) => void; onPick: (d: string) => void;
}) {
  const weekends = free.filter((f) => f.kind === 'fim_de_semana').length;
  const holidays = free.filter((f) => f.kind === 'feriado').length;
  const list = free.slice(0, 4);
  return (
    <section className="card cal-free" aria-labelledby="cal-free-h">
      <div className="cal-card-head">
        <h2 id="cal-free-h">Sem atividades registadas</h2>
        {canFuture && (
          <select className="cal-horizon" aria-label="Período considerado" value={futureOnly ? 'futuro' : 'todo'}
            onChange={(e) => setFutureOnly(e.target.value === 'futuro')}>
            <option value="futuro">A partir de hoje</option>
            <option value="todo">Todo o período</option>
          </select>
        )}
      </div>
      <p className="faint cal-free-note">De {formatDay(from)} a {formatDay(p.to)} · não confirma a disponibilidade de cada pessoa</p>
      <ul className="cal-free-counts">
        <li><strong>{weekends}</strong> {weekends === 1 ? 'Fim de semana' : 'Fins de semana'}</li>
        <li><strong>{holidays}</strong> {holidays === 1 ? 'Feriado em dia útil' : 'Feriados em dias úteis'}</li>
      </ul>
      {list.length > 0 && (
        <ul className="cal-free-list">
          {list.map((f) => (
            <li key={f.from}>
              <button type="button" className="cal-mark-btn" onClick={() => onPick(f.from)}>
                <span className="cal-key key-free" aria-hidden="true" />
                <span className="grow">
                  {f.from === f.to ? `${weekdayName(f.from)}, ${formatDay(f.from)}` : `${formatDay(f.from)} a ${formatDay(f.to)}`}
                  {f.names.length > 0 && <span className="faint"> · {f.names.join(', ')}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DayDialog({ day, events, marks, free, onClose }: { day: string; events: CalListItem[]; marks: DayMark[]; free: boolean; onClose: () => void }) {
  const { can } = useModuleCtx();
  const canManage = can('calendario.gerir', true);
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const back = document.querySelector<HTMLElement>(`[data-day="${day}"]`) ?? opener;
      back?.focus();
    };
  }, [day]);
  const weekend = weekday(day) >= 5;
  return (
    <div className="cal-dialog-backdrop" onClick={onClose}>
      <div className="cal-dialog card" role="dialog" aria-modal="true" aria-labelledby="cal-dialog-h" tabIndex={-1} ref={ref}
        onClick={(e) => e.stopPropagation()}>
        <div className="cal-dialog-head">
          <h2 id="cal-dialog-h">{weekdayName(day)}, {formatDay(day)}</h2>
          <button type="button" className="btn ghost icon-btn" aria-label="Fechar" onClick={onClose}><X size={20} aria-hidden="true" /></button>
        </div>
        {(marks.length > 0 || weekend) && (
          <ul className="cal-dialog-marks">
            {marks.map((m, i) => (
              <li key={i} className={m.kind === 'relevante' ? 'is-relevant' : 'is-holiday'}>{MARK_LABEL[m.kind]}: <strong>{m.name}</strong></li>
            ))}
            {weekend && !marks.length && <li className="is-weekend">Fim de semana</li>}
          </ul>
        )}
        {events.length ? (
          <ul className="list">{events.map((e) => <EventRow key={e.id} e={e} />)}</ul>
        ) : (
          <p className="faint">Sem atividades registadas neste dia.{free && ' Bom para planear, mas a disponibilidade de cada pessoa não está confirmada.'}</p>
        )}
        {canManage && (
          <div className="btn-row">
            <Link to={`/calendario/nova?dia=${day}`} className="btn"><Plus size={18} aria-hidden="true" /> Nova atividade neste dia</Link>
          </div>
        )}
      </div>
    </div>
  );
}
