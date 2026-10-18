// Peças partilhadas das Presenças: estado (ícone + texto), fórmula, indicadores, filtros e histórico.
import { Link, useSearchParams } from 'react-router-dom';
import { Ban, CalendarClock, Check, Clock3, FileText, History, Minus, X } from 'lucide-react';
import { formatDay, formatLisbon, MONTHS } from '../common';
import {
  ABBR, CATEGORY_LABEL, formatRate, periodFrom, rateSentence, SCOUT_MONTHS, scoutYearLabel, STATUS_LABEL, yearOptions,
  type Abbr, type Category, type HistoryRow, type Period, type PresStatus, type Stats,
} from './api';
import { DateInput } from '../../components/DateInput';
import { Filters as FilterBar } from '../../components/ui';

const ICON: Record<Category, typeof Check> = {
  presente: Check, justificada: FileText, injustificada: X, por_registar: Minus, futura: CalendarClock, cancelada: Ban,
};

/** Texto do estado (com «parcial» quando for o caso). */
export const markLabel = (category: Category, partial?: boolean) =>
  category === 'presente' && partial ? 'Presente (parcial)' : CATEGORY_LABEL[category];

/** Estado de uma presença: ícone e texto (no modo compacto, o texto fica só para leitores de ecrã). */
export function StatusMark({ category, partial, compact }: { category: Category; partial?: boolean; compact?: boolean }) {
  const isPartial = category === 'presente' && partial;
  const Icon = isPartial ? Clock3 : ICON[category];
  const label = markLabel(category, partial);
  return (
    <span className={`pres-mark pres-${category}${isPartial ? ' pres-partial' : ''}${compact ? ' compact' : ''}`} title={compact ? label : undefined}>
      <Icon size={compact ? 16 : 15} aria-hidden="true" />
      <span className={compact ? 'sr-only' : undefined}>{label}</span>
    </span>
  );
}

/** Indicadores de uma pessoa, equipa ou período. */
export function StatsTiles({ stats, label }: { stats: Stats; label: string }) {
  const tiles: [string, number | string, string?][] = [
    ['Presenças', stats.presencas, stats.parciais ? `${stats.parciais} parcia${stats.parciais === 1 ? 'l' : 'is'}` : undefined],
    ['Faltas justificadas', stats.justificadas],
    ['Faltas injustificadas', stats.injustificadas],
    ['Por registar', stats.por_registar],
  ];
  return (
    <section aria-label={label}>
      <div className="pres-tiles">
        {tiles.map(([t, v, sub]) => (
          <div key={t} className="pres-tile">
            <span className="pres-tile-value">{v}</span>
            <span className="pres-tile-label">{t}</span>
            {sub && <span className="pres-tile-sub">{sub}</span>}
          </div>
        ))}
        <div className="pres-tile pres-tile-rate">
          <span className="pres-tile-value" data-testid="taxa">{formatRate(stats.taxa)}</span>
          <span className="pres-tile-label">Taxa de assiduidade</span>
          <span className="pres-tile-sub">{stats.contadas ? `${stats.presencas} ÷ ${stats.contadas} × 100` : 'sem registos contados'}</span>
          {stats.por_registar > 0 && stats.contadas > 0 && (
            <span className="pres-tile-sub pres-provisional" data-testid="taxa-provisoria">Provisória: {stats.por_registar} por registar</span>
          )}
        </div>
      </div>
      <p className="sr-only">{rateSentence(stats)}</p>
      {stats.futuras + stats.canceladas > 0 && (
        <p className="faint pres-small pres-center">
          Não contam: {stats.futuras} {stats.futuras === 1 ? 'sessão futura' : 'sessões futuras'} e {stats.canceladas} {stats.canceladas === 1 ? 'cancelada' : 'canceladas'}.
        </p>
      )}
    </section>
  );
}

/** Lê/escreve um parâmetro do endereço (sobrevive ao «voltar»). */
export function useParam(key: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? '';
  const set = (v: string) =>
    setParams(() => {
      const next = new URLSearchParams(window.location.search);
      if (v) next.set(key, v);
      else next.delete(key);
      return next;
    }, { replace: true });
  return [value, set];
}

export function usePeriod(today: string): Period {
  const [params] = useSearchParams();
  return periodFrom(params, today);
}

/** Parâmetros do período atual, para manter nas ligações para detalhes. */
export function periodQuery(): string {
  const cur = new URLSearchParams(window.location.search);
  const out = new URLSearchParams();
  for (const k of ['ano', 'mes', 'de', 'ate', 'equipa', 'vista']) if (cur.get(k)) out.set(k, cur.get(k)!);
  const s = out.toString();
  return s ? `?${s}` : '';
}

/** Legenda curta dos símbolos do quadro (uma linha). */
export function Legend({ abbr }: { abbr?: boolean } = {}) {
  const items: [Category, string, boolean?][] = [
    ['presente', 'Presente'], ['presente', 'Parcial', true], ['justificada', 'Justificada'], ['injustificada', 'Injustificada'],
    ['por_registar', 'Por registar'], ['futura', 'Futura'],
  ];
  return (
    <p className="pres-legend" aria-label="Legenda">
      {items.map(([c, t, p]) => (
        <span key={t} className="pres-legend-item"><StatusMark category={c} partial={p} compact /><span aria-hidden="true">{t}</span></span>
      ))}
      <span className="pres-legend-item"><span className="pres-na-dot" aria-hidden="true">·</span><span>Não se aplica</span></span>
      {abbr && <AbbrLegend />}
    </p>
  );
}

/** Sigla com o significado acessível (title para o rato, texto escondido para leitores de ecrã). */
export function AbbrText({ k }: { k: Abbr }) {
  return <abbr className="pres-abbr" title={ABBR[k]}><span aria-hidden="true">{k}</span><span className="sr-only">{ABBR[k]}</span></abbr>;
}

/** Cabeçalho de coluna com sigla (P, FJ, FI, PR). */
export function AbbrHead({ k, className = 'pres-num' }: { k: Abbr; className?: string }) {
  return <th scope="col" className={className} title={ABBR[k]} aria-label={ABBR[k]}><abbr className="pres-abbr" title={ABBR[k]}>{k}</abbr></th>;
}

/** Significado das siglas e fórmula da taxa (numa linha). */
export function AbbrLegend() {
  return (
    <span className="pres-legend-abbr" data-testid="legenda-siglas">
      {(Object.keys(ABBR) as Abbr[]).map((k) => (
        <span key={k} className="pres-legend-item"><strong>{k}</strong> {ABBR[k].toLowerCase()}</span>
      ))}
      <span className="pres-legend-item">Taxa = P ÷ (P + FJ + FI)</span>
    </span>
  );
}

/** Filtros: ano escutista, mês ou datas livres e (para quem regista) equipa. */
export function Filters({ today, teams }: { today: string; teams?: { id: string; name: string }[] }) {
  const [params, setParams] = useSearchParams();
  const p = periodFrom(params, today);
  const custom = !!params.get('de') && !!params.get('ate') && p.from === params.get('de');
  const update = (changes: Record<string, string>) =>
    setParams(() => {
      const next = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
      return next;
    }, { replace: true });
  const mode = custom ? 'datas' : p.month || '';
  const active = (p.year !== periodFrom(new URLSearchParams(), today).year ? 1 : 0) + (mode ? 1 : 0) + (params.get('equipa') ? 1 : 0);
  return (
    <FilterBar active={active}>
      <label className="field">
        <span className="label">Ano escutista</span>
        <select value={String(p.year)} onChange={(e) => update({ ano: e.target.value, de: '', ate: '' })}>
          {yearOptions(today).map((y) => <option key={y} value={y}>{scoutYearLabel(y)}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="label">Período</span>
        <select value={mode} onChange={(e) => {
          const v = e.target.value;
          if (v === 'datas') update({ de: p.from, ate: p.to, mes: '' });
          else update({ mes: v, de: '', ate: '' });
        }}>
          <option value="">Ano completo (set.–ago.)</option>
          {SCOUT_MONTHS.map((m) => <option key={m} value={m}>{MONTHS[Number(m) - 1][0].toUpperCase() + MONTHS[Number(m) - 1].slice(1)}</option>)}
          <option value="datas">Outras datas…</option>
        </select>
      </label>
      {custom && (
        <>
          <label className="field">
            <span className="label">De</span>
            <DateInput value={p.from} onChange={(e) => e.target.value && update({ de: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Até</span>
            <DateInput value={p.to} onChange={(e) => e.target.value && update({ ate: e.target.value })} />
          </label>
        </>
      )}
      {teams && (
        <label className="field">
          <span className="label">Equipa</span>
          <select value={params.get('equipa') ?? ''} onChange={(e) => update({ equipa: e.target.value })}>
            <option value="">Todas</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      )}
    </FilterBar>
  );
}

const st = (s: PresStatus | null) => (s ? STATUS_LABEL[s] : STATUS_LABEL.por_registar);

/** Histórico de correções (quem, quando, de/para, motivo). */
export function HistoryList({ rows, showSession, showName }: { rows: HistoryRow[]; showSession?: boolean; showName?: boolean }) {
  if (rows.length === 0) return <p className="faint pres-small">Ainda não há alterações registadas.</p>;
  return (
    <ol className="pres-history">
      {rows.map((h) => (
        <li key={h.id}>
          <p className="pres-history-what">
            {showName && <strong>{h.name}: </strong>}
            {showSession && <><Link to={`/presencas/sessoes/${h.session_id}`}>{h.session_title}</Link> ({formatDay(h.session_date!)}): </>}
            {h.old_status === undefined || (h.old_status === null && h.old_partial === null)
              ? <>registado como <strong>{st(h.new_status)}{h.new_partial ? ' (parcial)' : ''}</strong></>
              : <>de {st(h.old_status)}{h.old_partial ? ' (parcial)' : ''} para <strong>{st(h.new_status)}{h.new_partial ? ' (parcial)' : ''}</strong></>}
            {h.justification_changed && <span className="faint"> · justificação alterada</span>}
          </p>
          <p className="faint pres-small">
            <History size={13} aria-hidden="true" /> {h.changed_by_name ?? 'Alguém'} · {formatLisbon(h.changed_at)}
            {h.reason && <> · motivo: {h.reason}</>}
          </p>
        </li>
      ))}
    </ol>
  );
}
