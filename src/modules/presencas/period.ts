// Presenças: períodos (ano escutista de setembro a agosto, mês ou datas livres) e
// formatação da taxa de assiduidade. Funções puras (testadas em period.test.ts).
import { formatDay, MONTHS } from '../common';

export interface RateInput { presencas: number; contadas: number; taxa: number | string | null }

// ---------------------------------------------------------------------------
// Períodos: ano escutista (1 de setembro a 31 de agosto), mês ou datas livres.
// ---------------------------------------------------------------------------
/** Ano escutista (ano de início) de um dia AAAA-MM-DD: setembro a agosto. */
export function scoutYearOf(day: string): number {
  const [y, m] = day.split('-').map(Number);
  return m >= 9 ? y : y - 1;
}
export const scoutYearLabel = (start: number) => `${start}/${String((start + 1) % 100).padStart(2, '0')}`;

export interface Period { from: string; to: string; label: string; year: number; month: string }

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Período a partir dos parâmetros do endereço: `ano` (início do ano escutista), `mes` (01–12,
 * dentro desse ano escutista) ou `de`/`ate` (datas livres, têm prioridade).
 */
export function periodFrom(params: URLSearchParams, today: string): Period {
  const de = params.get('de') ?? '';
  const ate = params.get('ate') ?? '';
  const valid = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
  const yParam = Number(params.get('ano'));
  const year = Number.isInteger(yParam) && yParam >= 2000 && yParam <= 2100 ? yParam : scoutYearOf(today);
  if (valid(de) && valid(ate) && de <= ate) {
    return { from: de, to: ate, label: `${formatDay(de)} a ${formatDay(ate)}`, year, month: '' };
  }
  const month = /^(0[1-9]|1[0-2])$/.test(params.get('mes') ?? '') ? params.get('mes')! : '';
  if (month) {
    const m = Number(month);
    const y = m >= 9 ? year : year + 1;
    return {
      from: `${y}-${month}-01`, to: `${y}-${month}-${String(lastDay(y, m)).padStart(2, '0')}`,
      label: `${MONTHS[m - 1]} de ${y}`, year, month,
    };
  }
  return { from: `${year}-09-01`, to: `${year + 1}-08-31`, label: `ano escutista ${scoutYearLabel(year)}`, year, month: '' };
}


/** Anos escutistas para escolher: do atual para trás (até 2024/25) e o seguinte. */
export function yearOptions(today: string): number[] {
  const cur = scoutYearOf(today);
  const out: number[] = [];
  for (let y = cur + 1; y >= Math.min(2024, cur); y--) out.push(y);
  return out;
}

/** Meses do ano escutista, pela ordem: setembro … agosto. */
export const SCOUT_MONTHS = ['09', '10', '11', '12', '01', '02', '03', '04', '05', '06', '07', '08'];

/** «66,7 %», «100 %» ou «—» quando não há registos contados (nunca 0 % por omissão). */
export function formatRate(taxa: number | string | null | undefined): string {
  if (taxa === null || taxa === undefined || taxa === '') return '—';
  const n = Number(taxa);
  if (!Number.isFinite(n)) return '—';
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1).replace('.', ',')} %`;
}

/** Texto acessível de uma taxa (com a fração que a origina). */
export function rateSentence(s: RateInput): string {
  if (!s.contadas) return 'Sem registos contados: ainda não há taxa.';
  return `${formatRate(s.taxa)} (${s.presencas} ${s.presencas === 1 ? 'presença' : 'presenças'} em ${s.contadas} ${s.contadas === 1 ? 'sessão contada' : 'sessões contadas'})`;
}

// ---------------------------------------------------------------------------
// Sessões por preencher (antes de tirar conclusões sobre a assiduidade).
// ---------------------------------------------------------------------------
export interface FillInput { status: 'ativa' | 'cancelada'; future: boolean; applicable: number; registered: number }

/** Por preencher: já aconteceu, não foi cancelada e falta registar alguém. */
export const needsFilling = (s: FillInput) => s.status === 'ativa' && !s.future && s.registered < s.applicable;

/** Quantas sessões estão por preencher e quantos registos faltam nelas. */
export function fillSummary(sessions: FillInput[]): { sessions: number; missing: number } {
  const open = sessions.filter(needsFilling);
  return { sessions: open.length, missing: open.reduce((n, s) => n + (s.applicable - s.registered), 0) };
}

