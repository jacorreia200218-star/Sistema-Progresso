// Calendário escutista: tipos, etiquetas e contas de datas (dias em Europe/Lisbon).
// Datas de dia inteiro são «AAAA-MM-DD» (fim inclusivo); horas são instantes ISO.
import { formatDay, isoToLisbon, lisbonDay, lisbonTime } from '../common';
import type { CalSource } from './source';

export type Response = 'vou' | 'nao_vou' | 'por_confirmar';
export type Missing = 'resposta' | 'autorizacao' | 'pagamento' | 'inscricao' | 'material';
export type PendingItem = Exclude<Missing, 'resposta'>;

export interface CalEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  audience: 'seccao' | 'equipa';
  team_id: string | null;
  team_name: string | null;
  responsible_id: string | null;
  responsible_name: string | null;
  registration_deadline: string | null;
  deadline_passed: boolean;
  needs_authorization: boolean;
  needs_payment: boolean;
  needs_registration: boolean;
  material: string | null;
  required: PendingItem[];
  reminder_minutes: number[];
  deadline_reminder_minutes: number[];
  status: 'ativo' | 'cancelado';
  cancel_reason: string | null;
  cancelled_at: string | null;
  updated_at: string;
  created_at: string;
  /** Atividade importada (iCloud); null nas criadas na app. */
  source?: CalSource | null;
}

export interface CalListItem extends CalEvent {
  involved: boolean;
  my_response: Response | null;
  my_missing: Missing[];
  counts: { vou: number; nao_vou: number; por_confirmar: number; total: number };
}

export interface CalParticipant {
  profile_id: string;
  name: string;
  team_name: string | null;
  function: 'pioneiro' | 'guia' | 'dirigente' | null;
  is_me: boolean;
  is_responsible: boolean;
  response: Response | null;
  note: string | null;
  responded_at: string | null;
  missing: Missing[] | null; // null = sem permissão para ver
}

export interface CalDetail extends CalEvent {
  can_manage: boolean;
  can_see_pending: boolean;
  involved: boolean;
  can_respond: boolean;
  me: { response: Response | null; note: string | null; responded_at: string | null; missing: Missing[] };
  participants: CalParticipant[];
}

export interface MyPending {
  id: string;
  title: string;
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  registration_deadline: string | null;
  deadline_passed: boolean;
  missing: Missing[];
}

export const RESPONSE_LABEL: Record<Response, string> = { vou: 'Vou', nao_vou: 'Não vou', por_confirmar: 'Por confirmar' };
export const RESPONSE_TONE: Record<Response, 'ok' | 'muted' | 'attention'> = { vou: 'ok', nao_vou: 'muted', por_confirmar: 'attention' };
export const MISSING_LABEL: Record<Missing, string> = {
  resposta: 'Confirmar presença', autorizacao: 'Autorização', pagamento: 'Pagamento', inscricao: 'Inscrição', material: 'Material',
};

export const REMINDER_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 10080, label: '1 semana' },
  { minutes: 2880, label: '2 dias' },
  { minutes: 1440, label: '1 dia' },
  { minutes: 120, label: '2 horas' },
  { minutes: 60, label: '1 hora' },
];

export function reminderLabel(m: number) {
  const o = REMINDER_OPTIONS.find((x) => x.minutes === m);
  if (o) return o.label;
  if (m % 1440 === 0) return `${m / 1440} dias`;
  if (m % 60 === 0) return `${m / 60} horas`;
  return `${m} minutos`;
}

// ---------------------------------------------------------------------------
// Dias (cadeias AAAA-MM-DD, sem fusos)
// ---------------------------------------------------------------------------
const toUtc = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);

export const addDays = (day: string, n: number) => fromUtc(toUtc(day) + n * 86400e3);
/** 0 = segunda … 6 = domingo. */
export const weekday = (day: string) => (new Date(toUtc(day)).getUTCDay() + 6) % 7;
export const monthOf = (day: string) => day.slice(0, 7);
export function addMonths(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}

/** Semanas (segunda a domingo) que cobrem o mês «AAAA-MM». */
export function monthGrid(ym: string): string[][] {
  const first = `${ym}-01`;
  const start = addDays(first, -weekday(first));
  const lastDay = addDays(`${addMonths(ym, 1)}-01`, -1);
  const end = addDays(lastDay, 6 - weekday(lastDay));
  const weeks: string[][] = [];
  for (let d = start; d <= end; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  return weeks;
}

type Dated = Pick<CalEvent, 'all_day' | 'starts_at' | 'ends_at' | 'start_date' | 'end_date'>;

/** Primeiro e último dia (em Lisboa) ocupados pela atividade. */
export function eventDays(e: Dated): { from: string; to: string } {
  if (e.all_day) return { from: e.start_date!, to: e.end_date ?? e.start_date! };
  const from = lisbonDay(e.starts_at!);
  let to = lisbonDay(e.ends_at ?? e.starts_at!);
  // Termina exatamente à meia-noite: não ocupa o dia seguinte.
  if (to > from && lisbonTime(e.ends_at!) === '00:00') to = addDays(to, -1);
  return { from, to };
}

export const coversDay = (e: Dated, day: string) => {
  const r = eventDays(e);
  return r.from <= day && day <= r.to;
};

/** Texto da data/hora: «25/10/2026 · dia inteiro», «24/10/2026 a 26/10/2026», «25/10/2026 · 10:00–12:00». */
export function whenLabel(e: Dated): string {
  if (e.all_day) {
    const { from, to } = eventDays(e);
    return from === to ? `${formatDay(from)} · dia inteiro` : `${formatDay(from)} a ${formatDay(to)}`;
  }
  const s = isoToLisbon(e.starts_at!);
  const f = isoToLisbon(e.ends_at ?? e.starts_at!);
  if (s.slice(0, 10) === f.slice(0, 10)) {
    return s === f ? `${formatDay(s)} · ${s.slice(11)}` : `${formatDay(s)} · ${s.slice(11)}–${f.slice(11)}`;
  }
  return `${formatDay(s)} · ${s.slice(11)} a ${formatDay(f)} · ${f.slice(11)}`;
}

/** Ordem cronológica (dias inteiros contam a partir das 00:00 de Lisboa). */
export const sortKey = (e: Dated) => (e.all_day ? `${e.start_date}T00:00` : isoToLisbon(e.starts_at!));

export const weekdayName = (day: string) => ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'][weekday(day)];

// ---------------------------------------------------------------------------
// Ano civil e ano escutista
// ---------------------------------------------------------------------------
export type YearMode = 'civil' | 'escutista';

export interface Period { mode: YearMode; year: number; label: string; months: string[]; from: string; to: string }

/** O ano escutista vai sempre de outubro a agosto; setembro já conta para o ano seguinte. */
export const SCOUT_YEAR = { first: 10, last: 8, cutoff: 9 };

/** Ano (civil ou escutista) que contém o dia indicado. */
export function yearOf(day: string, mode: YearMode): number {
  const y = Number(day.slice(0, 4));
  if (mode === 'civil') return y;
  return Number(day.slice(5, 7)) >= SCOUT_YEAR.cutoff ? y : y - 1;
}

/** Meses do período: civil = janeiro a dezembro; escutista = outubro a agosto do ano seguinte. */
export function period(mode: YearMode, year: number): Period {
  const first = mode === 'civil' ? `${year}-01` : `${year}-${String(SCOUT_YEAR.first).padStart(2, '0')}`;
  const length = mode === 'civil' ? 12 : 12 - SCOUT_YEAR.first + 1 + SCOUT_YEAR.last;
  const months = Array.from({ length }, (_, i) => addMonths(first, i));
  const to = addDays(`${addMonths(months[length - 1], 1)}-01`, -1);
  const label = mode === 'civil' ? String(year) : `${year}/${year + 1}`;
  return { mode, year, label, months, from: `${first}-01`, to };
}

/** Dias (AAAA-MM-DD) ocupados por atividades ativas. */
export function busyDays(events: (Dated & { status?: string })[], from: string, to: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.status === 'cancelado') continue;
    const r = eventDays(e);
    for (let d = r.from < from ? from : r.from; d <= r.to && d <= to; d = addDays(d, 1)) out.set(d, (out.get(d) ?? 0) + 1);
  }
  return out;
}
