// Vista principal: calendário anual (ano civil ou ano escutista) ou de um mês (grelha grande
// com as atividades nos dias e a lista do mês por baixo), com feriados, fins de
// semana, dias com atividades e dias sem atividades registadas; por baixo (no telemóvel,
// «O que te falta» por cima), um resumo curto: as três pendências mais próximas, as próximas
// atividades e as datas para planear. Vista secundária: lista completa das próximas atividades.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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
  const [highlight, setHighlight] = useParam('livres');
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
  const freeDays = useMemo(() => slotDays(free), [free]);
  const freeAllDays = useMemo(() => slotDays(freeAll), [freeAll]);
  const selected = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  const ready = !cfg.isLoading && !q.isLoading;
  const pickRef = useRef(setDay);
  pickRef.current = setDay;
  const pick = useCallback((d: string) => pickRef.current(d), []);

  // Navegação por teclado: um só ponto de paragem (Tab) na grelha; setas mudam de dia.
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const inPeriod = (d: string | null): d is string => !!d && d >= p.from && d <= p.to;
  const tabStop = inPeriod(focusDay) ? focusDay : inPeriod(selected) ? selected : inPeriod(today) ? today : p.from;
  const onGridKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const d = (e.target as HTMLElement).closest<HTMLElement>('[data-day]')?.dataset.day;
    if (!d) return;
    const n = keyTarget(d, e.key);
    if (!n) return;
    e.preventDefault();
    if (!inPeriod(n)) return;
    setFocusDay(n);
    const el = document.querySelector<HTMLElement>(`button[data-day="${n}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest' });
  };

  // «Hoje» abre o dia de hoje; «Ir para o mês atual» desloca até ao mês atual. Ambos mantêm a vista anual.
  const toMonth = useRef(false);
  const scrollToCurrent = () => {
    document.getElementById(`mes-${monthOf(today)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setFocusDay(today);
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
          {narrow ? <PendingCard s={pending} /> : <PendingStrip s={pending} />}
          <div className="cal-year-main">
            <MonthJump months={p.months} today={today} />
            <p id="cal-keys" className="sr-only">Usa as setas para mudar de dia e Page Up ou Page Down para mudar de mês.</p>
            <div className={`cal-year${highlight === '1' ? ' show-free' : ''}`} aria-busy={!ready} onKeyDown={onGridKey}>
              {p.months.map((ym) => (
                <MiniMonth key={ym} ym={ym} today={today} marks={marks} busy={busyShown} free={freeDays} selected={selected && monthOf(selected) === ym ? selected : null} onPick={pick}
                  tabStop={monthOf(tabStop) === ym ? tabStop : null} onFocusDay={setFocusDay}
                  showYear={p.from.slice(0, 4) !== p.to.slice(0, 4) && (ym === p.months[0] || ym.endsWith('-01'))} />
              ))}
            </div>
            <Legend highlight={highlight === '1'} setHighlight={(on) => setHighlight(on ? '1' : '')} />
          </div>
          <div className="cal-summary" role="region" aria-label="Resumo">
            {!narrow && <PendingCard s={pending} counters={false} />}
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
  const lead = weekday(from);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const trail = (7 - ((lead + days.length) % 7)) % 7;
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
          <div className={`card cal-month${narrow ? ' is-narrow' : ''}`} aria-busy={q.isLoading}>
            <div className="cal-month-grid" aria-label={monthLabel(ym)}>
              {WD_SHORT.map((w, i) => <abbr key={w} title={WD_FULL[i]} className={`cal-month-wd${i >= 5 ? ' is-weekend' : ''}`}>{narrow ? WD[i] : w}</abbr>)}
              {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} className="cal-month-blank" aria-hidden="true" />)}
              {days.map((d) => {
                const m = marks.get(d) ?? [];
                const evs = shown.filter((e) => coversDay(e, d));
                const cls = ['cal-month-day'];
                if (weekday(d) >= 5) cls.push('is-weekend');
                if (isHoliday(m)) cls.push('is-holiday');
                if (d === today) cls.push('is-today');
                if (selected === d) cls.push('is-selected');
                const label = dayLabel(d, m, busy.get(d) ?? 0, false, today);
                return (
                  <div key={d} className={cls.join(' ')}>
                    <button type="button" className="cal-month-dn" data-day={d} aria-label={label} title={label}
                      aria-current={d === today ? 'date' : undefined} onClick={() => setDay(d)}>
                      {Number(d.slice(8))}
                    </button>
                    {narrow ? <EventMarks n={busy.get(d) ?? 0} /> : (
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
                        {evs.length > 3 && <button type="button" className="cal-chip-more" onClick={() => setDay(d)}>+{evs.length - 3}</button>}
                      </>
                    )}
                  </div>
                );
              })}
              {Array.from({ length: trail }, (_, i) => <span key={`t${i}`} className="cal-month-blank" aria-hidden="true" />)}
            </div>
          </div>
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

function slotDays(slots: FreeSlot[]) {
  const s = new Set<string>();
  for (const f of slots) for (let d = f.from; d <= f.to; d = addDays(d, 1)) s.add(d);
  return s;
}

/** Dia de destino de uma tecla na grelha (setas, Home/End na semana, Page Up/Down no mês). */
function keyTarget(d: string, key: string): string | null {
  const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (key in steps) return addDays(d, steps[key]);
  if (key === 'Home') return addDays(d, -weekday(d));
  if (key === 'End') return addDays(d, 6 - weekday(d));
  if (key === 'PageUp' || key === 'PageDown') {
    const ym = addMonths(monthOf(d), key === 'PageUp' ? -1 : 1);
    const last = Number(addDays(`${addMonths(ym, 1)}-01`, -1).slice(8));
    return `${ym}-${String(Math.min(Number(d.slice(8)), last)).padStart(2, '0')}`;
  }
  return null;
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

/** Marcas das atividades dentro da célula: um ponto por atividade (até duas) ou «•+N». */
function EventMarks({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="cal-dots" aria-hidden="true">
      <i />{n === 2 && <i />}{n > 2 && <span className="cal-more">+{n - 1}</span>}
    </span>
  );
}

const MiniMonth = memo(function MiniMonth({ ym, today, marks, busy, free, selected, onPick, showYear, tabStop, onFocusDay }: {
  ym: string; today: string; marks: Map<string, DayMark[]>; busy: Map<string, number>; free: Set<string>;
  selected: string | null; onPick: (d: string) => void; showYear: boolean; tabStop: string | null; onFocusDay: (d: string) => void;
}) {
  const first = `${ym}-01`;
  const last = addDays(`${addMonths(ym, 1)}-01`, -1);
  const lead = weekday(first);
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  // Seis semanas em todos os meses: todos os cartões têm a mesma altura.
  const trail = 42 - lead - days.length;
  const id = `cal-mm-${ym}`;
  return (
    <section className={`cal-mm${monthOf(today) === ym ? ' is-current' : ''}`} aria-labelledby={id} id={`mes-${ym}`}>
      <h3 id={id} className="cal-mm-title">
        {/* O nome do mês abre a vista «Mês». */}
        <Link to={`/calendario?vista=mes&mes=${ym}`} className="cal-mm-link">
          {MONTHS[Number(ym.slice(5, 7)) - 1]}
          <span className={showYear ? 'cal-mm-year' : 'sr-only'}> {ym.slice(0, 4)}</span>
        </Link>
      </h3>
      <div className="cal-mm-grid">
        {WD.map((w, i) => (
          <abbr key={i} title={WD_FULL[i]} className={`cal-mm-wd${i >= 5 ? ' is-weekend' : ''}`}>
            <span className="wd-long">{WD_SHORT[i]}</span><span className="wd-short" aria-hidden="true">{w}</span>
          </abbr>
        ))}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} className="cal-mm-blank" aria-hidden="true" />)}
        {days.map((d) => {
          const m = marks.get(d) ?? [];
          const n = busy.get(d) ?? 0;
          const isFree = free.has(d);
          const label = dayLabel(d, m, n, isFree, today);
          const cls = ['cal-d'];
          if (weekday(d) >= 5) cls.push('is-weekend');
          if (isHoliday(m)) cls.push('is-holiday');
          else if (m.length) cls.push('is-relevant');
          if (d === today) cls.push('is-today');
          if (n) cls.push('has-events');
          if (isFree) cls.push('is-free');
          if (selected === d) cls.push('is-selected');
          return (
            <button key={d} type="button" data-day={d} className={cls.join(' ')} aria-label={label} title={label}
              aria-current={d === today ? 'date' : undefined} aria-describedby="cal-keys" tabIndex={d === tabStop ? 0 : -1}
              onFocus={() => onFocusDay(d)} onClick={() => onPick(d)}>
              <span className="cal-dn">{Number(d.slice(8))}</span>
              <EventMarks n={n} />
            </button>
          );
        })}
        {Array.from({ length: trail }, (_, i) => <span key={`t${i}`} className="cal-mm-blank is-trail" aria-hidden="true" />)}
      </div>
    </section>
  );
});

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

function Legend({ highlight, setHighlight }: { highlight: boolean; setHighlight: (on: boolean) => void }) {
  return (
    <div className="cal-legend" role="group" aria-label="Legenda">
      <ul>
        <li><span className="cal-key key-event" aria-hidden="true" /> Atividade</li>
        <li><span className="cal-key key-holiday" aria-hidden="true" /> Feriado</li>
        <li><span className="cal-key key-relevant" aria-hidden="true" /> Dia relevante</li>
        <li><span className="cal-key key-today" aria-hidden="true" /> Hoje</li>
        <li><span className="cal-key key-weekend" aria-hidden="true" /> Fim de semana</li>
      </ul>
      <label className="checkbox"><input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} /> Destacar fins de semana e feriados sem atividades</label>
    </div>
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
