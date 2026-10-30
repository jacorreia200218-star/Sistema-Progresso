// «O que te falta»: resumo curto (as três pendências mais próximas, num horizonte de 2, 4 ou
// 8 semanas) e vista própria «Ver todas», filtrável por período e por tipo de pendência.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api';
import { useActiveSection } from '../../lib/session';
import { Empty, ErrorBox, Loading, PageTitle } from '../../components/ui';
import { useModuleCtx } from '../ModuleShell';
import { formatDay, formatLisbon, MONTHS, todayLisbon } from '../common';
import { eventDays, MISSING_LABEL, monthOf, whenLabel, type Missing, type MyPending } from './cal';
import {
  countMissing, HORIZONS, horizonEnd, horizonLabel, MISSING_ORDER, saveHorizon, loadHorizon, splitPending, useHorizon, type Horizon,
} from './pending';
import { MissingList, useParam } from './shared';

export function useMyPending() {
  const section = useActiveSection().membership.section_id;
  const { space } = useModuleCtx();
  return useQuery({ queryKey: ['cal-my-pending', section, space], queryFn: () => call<MyPending[]>('cal_my_pending', { p_section: section }) });
}

const allLink = (w: Horizon, kind?: Missing) => {
  const q = new URLSearchParams({ semanas: w == null ? 'todas' : String(w) });
  if (kind) q.set('falta', kind);
  return `/calendario/pendentes?${q}`;
};

function HorizonSelect({ value, onChange, all, id }: { value: Horizon; onChange: (w: Horizon) => void; all?: boolean; id: string }) {
  return (
    <select id={id} className="cal-horizon" aria-label="Período das pendências" value={value == null ? 'todas' : String(value)}
      onChange={(e) => onChange(e.target.value === 'todas' ? null : Number(e.target.value))}>
      {HORIZONS.map((w) => <option key={w} value={w}>{horizonLabel(w)}</option>)}
      {all && <option value="todas">{horizonLabel(null)}</option>}
    </select>
  );
}

/** Contadores compactos: «3 Confirmar presença · 1 Autorização». */
function Counters({ items, link, active, onToggle }: {
  items: MyPending[]; link?: Horizon; active?: Missing | null; onToggle?: (k: Missing) => void;
}) {
  const counts = countMissing(items);
  if (!counts.length) return null;
  return (
    <ul className="cal-counters" aria-label="Contadores">
      {counts.map(({ kind, n }) => {
        const body = <><strong>{n}</strong> {MISSING_LABEL[kind]}</>;
        return (
          <li key={kind}>
            {onToggle ? (
              <button type="button" className="cal-counter" aria-pressed={active === kind} onClick={() => onToggle(kind)}>{body}</button>
            ) : link !== undefined ? (
              <Link className="cal-counter" to={allLink(link, kind)}>{body}</Link>
            ) : <span className="cal-counter">{body}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function PendingRow({ p }: { p: MyPending }) {
  return (
    <li>
      <Link to={`/calendario/evento/${p.id}`} className="list-item cal-pending-row">
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
  );
}

/** Resumo das pendências: período escolhido, as que caem nele e as três mais próximas. */
export function usePendingSummary() {
  const q = useMyPending();
  const [weeks, setWeeks] = useHorizon();
  const today = todayLisbon();
  const split = useMemo(() => splitPending(q.data ?? [], today, weeks), [q.data, today, weeks]);
  const top = split.soon.slice(0, 3);
  return { q, weeks, setWeeks, split, top };
}

export type PendingSummary = ReturnType<typeof usePendingSummary>;

/** Cartão do resumo: até três pendências mais próximas, contadores e «Ver todas». */
export function PendingCard({ s, counters = true }: { s: PendingSummary; counters?: boolean }) {
  const { q, weeks, setWeeks, split, top } = s;
  if (q.isLoading) return <section className="card cal-todo" aria-label="O que te falta"><Loading compact rows={2} /></section>;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (!q.data?.length) return null;
  const total = split.soon.length;
  return (
    <section className="card cal-todo" aria-labelledby="cal-todo-h">
      <div className="cal-card-head">
        <h2 id="cal-todo-h">O que te falta</h2>
        <HorizonSelect id="cal-todo-horizon" value={weeks} onChange={(w) => w != null && setWeeks(w)} />
      </div>
      {counters && <Counters items={split.soon} link={weeks} />}
      {top.length ? <ul className="list">{top.map((p) => <PendingRow key={p.id} p={p} />)}</ul> : (
        <p className="faint cal-todo-none">Nada pendente até {formatDay(horizonEnd(todayLisbon(), weeks))}.</p>
      )}
      <div className="cal-card-foot">
        {/* Contadores com âmbito explícito: dentro do período escolhido e depois dele. */}
        {split.later.length > 0 && (
          <span className="faint" data-testid="pendencias-depois">
            {split.later.length === 1 ? 'Mais 1 pendência' : `Mais ${split.later.length} pendências`} depois de {formatDay(horizonEnd(todayLisbon(), weeks))}
          </span>
        )}
        {(total > top.length || split.later.length > 0) && (
          <Link to={allLink(total > top.length ? weeks : null)} className="btn ghost cal-see-all">
            {total > top.length ? `Ver as ${total} das próximas ${weeks} semanas` : `Ver todas (${total + split.later.length})`}
          </Link>
        )}
      </div>
    </section>
  );
}

/** Computador: uma linha com os contadores por cima do calendário (o cartão fica por baixo). */
export function PendingStrip({ s }: { s: PendingSummary }) {
  const { split, weeks } = s;
  if (!split.soon.length) return null;
  return (
    <div className="cal-strip" role="group" aria-label="Pendências próximas">
      <span className="cal-strip-label">Falta-te nas próximas {weeks} semanas:</span>
      <Counters items={split.soon} link={weeks} />
      <Link to={allLink(weeks)} className="btn ghost cal-strip-link">Ver o que falta</Link>
    </div>
  );
}

const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;

/** Vista «Ver todas»: período (2/4/8 semanas ou todas as datas) e filtro por tipo, no endereço. */
export function PendingPage() {
  const q = useMyPending();
  const today = todayLisbon();
  const [semanas, setSemanas] = useParam('semanas');
  const [falta, setFalta] = useParam('falta');
  const weeks: Horizon = semanas === 'todas' ? null : HORIZONS.includes(Number(semanas) as 2) ? Number(semanas) : loadHorizon();
  const kind = (MISSING_ORDER as string[]).includes(falta) ? (falta as Missing) : null;
  const split = useMemo(() => splitPending(q.data ?? [], today, weeks), [q.data, today, weeks]);
  const items = kind ? split.soon.filter((p) => p.missing.includes(kind)) : split.soon;
  const groups = useMemo(() => {
    const out: { ym: string; items: MyPending[] }[] = [];
    for (const p of items) {
      const from = eventDays(p).from;
      const ym = monthOf(from < today ? today : from);
      const g = out.at(-1);
      if (g?.ym === ym) g.items.push(p);
      else out.push({ ym, items: [p] });
    }
    return out;
  }, [items, today]);
  const change = (w: Horizon) => {
    if (w != null) saveHorizon(w);
    setSemanas(w == null ? 'todas' : String(w));
  };
  return (
    <div className="cal-page">
      <PageTitle title="O que te falta" back="/calendario" />
      <div className="cal-pending-tools">
        <HorizonSelect id="cal-pending-horizon" value={weeks} onChange={change} all />
        {weeks != null && <span className="faint">Até {formatDay(horizonEnd(today, weeks))}</span>}
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : (
        <>
          <Counters items={split.soon} active={kind} onToggle={(k) => setFalta(k === kind ? '' : k)} />
          {!groups.length ? (
            <Empty title={kind ? `Sem «${MISSING_LABEL[kind]}» neste período.` : weeks == null ? 'Não te falta nada.' : 'Nada pendente neste período.'} />
          ) : groups.map((g) => (
            <section key={g.ym} className="card cal-month-group" aria-label={monthLabel(g.ym)}>
              <h2 className="cal-month-title">{monthLabel(g.ym)}</h2>
              <ul className="list">{g.items.map((p) => <PendingRow key={p.id} p={p} />)}</ul>
            </section>
          ))}
          {split.later.length > 0 && (
            <div className="btn-row cal-export">
              <button type="button" className="btn secondary" onClick={() => change(null)}>
                Ver também as mais tarde ({split.later.length})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
