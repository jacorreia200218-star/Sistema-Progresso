// Vista principal: calendário anual (ano civil ou ano escutista) com feriados, fins de
// semana, dias com atividades e dias livres; lista curta das próximas atividades e
// «O que te falta». Vista secundária: lista completa das próximas atividades.
import { useEffect, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Plus, Settings, X } from 'lucide-react';
import { call } from '../../lib/api';
import { useActiveSection } from '../../lib/session';
import { Empty, ErrorBox, Loading, MoreMenu, Notice, PageTitle } from '../../components/ui';
import { useModuleCtx } from '../ModuleShell';
import { downloadFile, formatDay, formatLisbon, MONTHS, todayLisbon } from '../common';
import {
  addDays, addMonths, busyDays, coversDay, eventDays, monthOf, period, sortKey, weekday, weekdayName, whenLabel, yearOf,
  type CalListItem, type MyPending, type Period, type YearMode,
} from './cal';
import { dayMarks, freeSlots, isHoliday, MARK_LABEL, type DayMark, type SpecialDay } from './holidays';
import { buildIcs } from './ics';
import { EventRow, MissingList, useParam } from './shared';

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
  const [mode] = useParam('tipo', 'civil');
  const [mine, setMine] = useParam('minhas');
  const { can } = useModuleCtx();
  const canManage = can('calendario.gerir', true);
  const current = view === 'lista' ? 'lista' : mode === 'escutista' ? 'escutista' : 'civil';
  const flash = (useLocation().state as { flash?: string } | null)?.flash;
  return (
    <div className="cal-page">
      <PageTitle title="Calendário escutista" actions={canManage && (
        <>
          <Link to="/calendario/nova" className="btn"><Plus size={18} aria-hidden="true" /> Nova atividade</Link>
          <MoreMenu>
            <Link to="/calendario/configurar" className="btn"><Settings size={16} aria-hidden="true" /> Dias e ano escutista</Link>
          </MoreMenu>
        </>
      )} />
      {flash && <Notice kind="success">{flash}</Notice>}
      <div className="cal-toolbar">
        <div className="tabs" role="tablist" aria-label="Vistas do calendário">
          <button type="button" role="tab" className="tab" aria-selected={current === 'civil'} onClick={() => setView('ano', { tipo: '', ano: '', dia: '' })}>Ano civil</button>
          <button type="button" role="tab" className="tab" aria-selected={current === 'escutista'} onClick={() => setView('ano', { tipo: 'escutista', ano: '', dia: '' })}>Ano escutista</button>
          <button type="button" role="tab" className="tab" aria-selected={current === 'lista'} onClick={() => setView('lista', { dia: '' })}>Lista</button>
        </div>
        <label className="checkbox cal-mine">
          <input type="checkbox" checked={mine === '1'} onChange={(e) => setMine(e.target.checked ? '1' : '')} /> Só as minhas
        </label>
      </div>
      {current === 'lista' ? <Upcoming onlyMine={mine === '1'} /> : <YearView mode={current} onlyMine={mine === '1'} />}
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
  const startMonth = cfg.data?.year_start_month ?? 9;
  const [yearParam, setYear] = useParam('ano');
  const [day, setDay] = useParam('dia');
  const [highlight, setHighlight] = useParam('livres');
  const thisYear = yearOf(today, mode, startMonth);
  const year = /^\d{4}$/.test(yearParam) ? Number(yearParam) : thisYear;
  const p = period(mode, year, startMonth);
  const q = useEvents(p.from, p.to, !cfg.isLoading);
  const all = useMemo(() => [...(q.data ?? [])].sort((a, b) => sortKey(a).localeCompare(sortKey(b))), [q.data]);
  const shown = useMemo(() => (onlyMine ? all.filter((e) => e.involved) : all), [all, onlyMine]);
  const marks = useMemo(() => dayMarks(p.from, p.to, cfg.data?.special_days ?? []), [p.from, p.to, cfg.data]);
  const busyAll = useMemo(() => busyDays(all, p.from, p.to), [all, p.from, p.to]);
  const busyShown = useMemo(() => (onlyMine ? busyDays(shown, p.from, p.to) : busyAll), [onlyMine, shown, busyAll, p.from, p.to]);
  const free = useMemo(() => freeSlots(p.from, p.to, busyAll, marks), [p.from, p.to, busyAll, marks]);
  const freeDays = useMemo(() => {
    const s = new Set<string>();
    for (const f of free) for (let d = f.from; d <= f.to; d = addDays(d, 1)) s.add(d);
    return s;
  }, [free]);
  const go = (y: number) => setYear(y === thisYear ? '' : String(y), { dia: '' });
  const selected = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  const ready = !cfg.isLoading && !q.isLoading;

  return (
    <>
      <div className="cal-year-nav">
        <button type="button" className="btn ghost icon-btn" aria-label="Ano anterior" onClick={() => go(year - 1)}><ChevronLeft size={20} aria-hidden="true" /></button>
        <h2 className="cal-year-heading" aria-live="polite">{mode === 'escutista' ? `Ano escutista ${p.label}` : `Ano ${p.label}`}</h2>
        <button type="button" className="btn ghost icon-btn" aria-label="Ano seguinte" onClick={() => go(year + 1)}><ChevronRight size={20} aria-hidden="true" /></button>
        {year !== thisYear && <button type="button" className="btn secondary cal-today" onClick={() => go(thisYear)}>Hoje</button>}
      </div>
      {mode === 'escutista' && (
        <p className="faint cal-period-hint">De {formatDay(p.from)} a {formatDay(p.to)} (começa em {MONTHS[startMonth - 1]}).</p>
      )}
      {cfg.error || q.error ? <ErrorBox error={cfg.error ?? q.error} retry={() => { cfg.refetch(); q.refetch(); }} /> : (
        <div className="cal-year-layout">
          <div className="cal-year-main">
            <MonthJump months={p.months} today={today} />
            <div className={`cal-year${highlight === '1' ? ' show-free' : ''}`} aria-busy={!ready}>
              {p.months.map((ym) => (
                <MiniMonth key={ym} ym={ym} today={today} marks={marks} busy={busyShown} free={freeDays} selected={selected} onPick={(d) => setDay(d)}
                  showYear={p.from.slice(0, 4) !== p.to.slice(0, 4) && (ym === p.months[0] || ym.endsWith('-01'))} />
              ))}
            </div>
            <Legend highlight={highlight === '1'} setHighlight={(on) => setHighlight(on ? '1' : '')} />
            <MarksList p={p} marks={marks} busy={busyAll} onPick={(d) => setDay(d)} />
          </div>
          <aside className="cal-year-side" aria-label="Resumo">
            <MyPendingCard />
            <NextEvents onlyMine={onlyMine} />
            <FreeCard free={free} today={today} p={p} onPick={(d) => setDay(d)} />
            {ready && shown.length > 0 && (
              <div className="btn-row cal-export"><ExportButton events={shown} name={`atividades-${p.label.replace('/', '-')}`} label={`Exportar ${p.label} (.ics)`} /></div>
            )}
          </aside>
        </div>
      )}
      {selected && (
        <DayDialog day={selected} events={shown.filter((e) => coversDay(e, selected))} marks={marks.get(selected) ?? []}
          free={freeDays.has(selected)} onClose={() => setDay('')} />
      )}
    </>
  );
}

const WD = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
const WD_FULL = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function dayLabel(d: string, marks: DayMark[], n: number, free: boolean, today: string) {
  const parts = [`${weekdayName(d)}, ${formatDay(d)}`];
  if (d === today) parts.push('hoje');
  for (const m of marks) parts.push(`${m.kind === 'relevante' ? '' : `${MARK_LABEL[m.kind].toLowerCase()}: `}${m.name}`);
  if (n) parts.push(`${n} ${n === 1 ? 'atividade' : 'atividades'}`);
  else if (free) parts.push('livre');
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

function MiniMonth({ ym, today, marks, busy, free, selected, onPick, showYear }: {
  ym: string; today: string; marks: Map<string, DayMark[]>; busy: Map<string, number>; free: Set<string>;
  selected: string | null; onPick: (d: string) => void; showYear: boolean;
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
        {MONTHS[Number(ym.slice(5, 7)) - 1]}
        <span className={showYear ? 'cal-mm-year' : 'sr-only'}> {ym.slice(0, 4)}</span>
      </h3>
      <div className="cal-mm-grid">
        {WD.map((w, i) => <abbr key={i} title={WD_FULL[i]} className={`cal-mm-wd${i >= 5 ? ' is-weekend' : ''}`}>{w}</abbr>)}
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
              aria-current={d === today ? 'date' : undefined} onClick={() => onPick(d)}>
              <span className="cal-dn">{Number(d.slice(8))}</span>
              <EventMarks n={n} />
            </button>
          );
        })}
        {Array.from({ length: trail }, (_, i) => <span key={`t${i}`} className="cal-mm-blank is-trail" aria-hidden="true" />)}
      </div>
    </section>
  );
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
      <label className="checkbox"><input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} /> Destacar os dias livres</label>
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

function NextEvents({ onlyMine }: { onlyMine: boolean }) {
  const today = todayLisbon();
  const q = useEvents(today, addDays(today, 365));
  const next = (q.data ?? []).filter((e) => e.status === 'ativo' && (!onlyMine || e.involved))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b))).slice(0, 5);
  return (
    <section className="card cal-next" aria-labelledby="cal-next-h">
      <h2 id="cal-next-h">Próximas atividades</h2>
      {q.isLoading ? <Loading compact rows={2} /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : next.length ? (
        <>
          <ul className="list">{next.map((e) => <EventRow key={e.id} e={e} />)}</ul>
          <Link to="/calendario?vista=lista" className="btn ghost cal-see-all">Ver todas</Link>
        </>
      ) : <p className="faint">{onlyMine ? 'Não tens atividades marcadas.' : 'Ainda não há atividades marcadas.'}</p>}
    </section>
  );
}

function FreeCard({ free, today, p, onPick }: { free: ReturnType<typeof freeSlots>; today: string; p: Period; onPick: (d: string) => void }) {
  const upcoming = free.filter((f) => f.to >= today);
  const weekends = free.filter((f) => f.kind === 'fim_de_semana').length;
  const holidays = free.filter((f) => f.kind === 'feriado').length;
  const list = (upcoming.length ? upcoming : free).slice(0, 6);
  return (
    <section className="card cal-free" aria-labelledby="cal-free-h">
      <h2 id="cal-free-h">Livres para planear</h2>
      <ul className="cal-free-counts">
        <li><strong>{weekends}</strong> Fins de semana livres</li>
        <li><strong>{holidays}</strong> Feriados livres em dias úteis</li>
      </ul>
      <p className="faint cal-free-note">Em {p.label}, sem atividades da secção.</p>
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
          <p className="faint">Sem atividades neste dia.{free && ' Dia livre para planear.'}</p>
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
