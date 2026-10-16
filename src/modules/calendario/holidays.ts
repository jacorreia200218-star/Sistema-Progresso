// Feriados nacionais portugueses (fixos e móveis), Carnaval (tolerância facultativa) e os
// dias especiais configurados pela secção (feriado municipal e outros dias relevantes).
// Funções puras sobre cadeias «AAAA-MM-DD» (sem fusos).
import { addDays, weekday } from './cal';

export type DayMarkKind = 'nacional' | 'municipal' | 'relevante';
export interface DayMark { name: string; kind: DayMarkKind; movable?: boolean }

export interface SpecialDay {
  id: string;
  day: string; // AAAA-MM-DD (num dia recorrente só contam o mês e o dia)
  name: string;
  kind: 'municipal' | 'relevante';
  recurring: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Domingo de Páscoa (calendário gregoriano; algoritmo anónimo de Meeus/Jones/Butcher). */
export function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

const FIXED: [string, string][] = [
  ['01-01', 'Ano Novo'],
  ['04-25', 'Dia da Liberdade'],
  ['05-01', 'Dia do Trabalhador'],
  ['06-10', 'Dia de Portugal'],
  ['08-15', 'Assunção de Nossa Senhora'],
  ['10-05', 'Implantação da República'],
  ['11-01', 'Dia de Todos os Santos'],
  ['12-01', 'Restauração da Independência'],
  ['12-08', 'Imaculada Conceição'],
  ['12-25', 'Natal'],
];

/** Feriados nacionais de um ano e o Carnaval (como dia relevante, não feriado). */
export function nationalHolidays(year: number): Map<string, DayMark> {
  const out = new Map<string, DayMark>();
  for (const [md, name] of FIXED) out.set(`${year}-${md}`, { name, kind: 'nacional' });
  const e = easter(year);
  out.set(addDays(e, -2), { name: 'Sexta-feira Santa', kind: 'nacional', movable: true });
  out.set(e, { name: 'Páscoa', kind: 'nacional', movable: true });
  out.set(addDays(e, 60), { name: 'Corpo de Deus', kind: 'nacional', movable: true });
  out.set(addDays(e, -47), { name: 'Carnaval (tolerância facultativa)', kind: 'relevante', movable: true });
  return out;
}

/**
 * Marcas de cada dia entre «from» e «to» (inclusive): feriados nacionais, Carnaval e os
 * dias especiais da secção. Um dia pode ter várias marcas (ex.: feriado municipal num domingo de Páscoa).
 */
export function dayMarks(from: string, to: string, special: SpecialDay[] = []): Map<string, DayMark[]> {
  const out = new Map<string, DayMark[]>();
  const add = (day: string, m: DayMark) => {
    if (day < from || day > to) return;
    const list = out.get(day);
    if (list) list.push(m);
    else out.set(day, [m]);
  };
  const y0 = Number(from.slice(0, 4));
  const y1 = Number(to.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    for (const [day, m] of [...nationalHolidays(y)].sort(([a], [b]) => a.localeCompare(b))) add(day, m);
    for (const s of special) {
      if (!s.recurring) continue;
      const md = s.day.slice(5);
      // 29/02 recorrente só existe em anos bissextos
      if (md === '02-29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) continue;
      add(`${y}-${md}`, { name: s.name, kind: s.kind });
    }
  }
  for (const s of special) if (!s.recurring) add(s.day, { name: s.name, kind: s.kind });
  return out;
}

/** É feriado (nacional ou municipal)? Dias relevantes não contam como feriado. */
export const isHoliday = (marks: DayMark[] | undefined) => !!marks?.some((m) => m.kind === 'nacional' || m.kind === 'municipal');

export const MARK_LABEL: Record<DayMarkKind, string> = {
  nacional: 'Feriado nacional', municipal: 'Feriado municipal', relevante: 'Dia relevante',
};

export interface FreeSlot { kind: 'fim_de_semana' | 'feriado'; from: string; to: string; names: string[] }

/**
 * Fins de semana (juntando feriados encostados, ex.: sexta-feira feriado) e feriados em dias
 * úteis sem nenhuma atividade ativa, entre «from» e «to». Ajuda a escolher datas para planear.
 */
export function freeSlots(from: string, to: string, busy: { has(day: string): boolean }, marks: Map<string, DayMark[]>): FreeSlot[] {
  const out: FreeSlot[] = [];
  const holidayNames = (d: string) => (marks.get(d) ?? []).filter((m) => m.kind !== 'relevante').map((m) => m.name);
  const isWeekend = (d: string) => weekday(d) >= 5;
  const isOff = (d: string) => isWeekend(d) || holidayNames(d).length > 0;
  let d = from;
  while (d <= to) {
    if (!isOff(d)) { d = addDays(d, 1); continue; }
    let end = d;
    while (addDays(end, 1) <= to && isOff(addDays(end, 1))) end = addDays(end, 1);
    const days: string[] = [];
    for (let x = d; x <= end; x = addDays(x, 1)) days.push(x);
    if (!days.some((x) => busy.has(x))) {
      out.push({ kind: days.some(isWeekend) ? 'fim_de_semana' : 'feriado', from: d, to: end, names: days.flatMap(holidayNames) });
    }
    d = addDays(end, 1);
  }
  return out;
}
