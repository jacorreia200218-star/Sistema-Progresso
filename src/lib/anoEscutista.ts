// Ano escutista: uma só definição para toda a app (Calendário, Presenças, Tesouraria,
// Equipas e cargos). O servidor usa a mesma regra (private.eq_scout_year e
// private.fin_scout_year: setembro ou depois = ano que começa).
//
// - Ano escutista completo: de 1 de setembro a 31 de agosto. Cada dia pertence a um só ano;
//   setembro já conta para o ano que começa (decisão de 22/10/2026).
// - Período de atividades: de outubro a agosto. É o que o Calendário mostra na vista «Ano
//   escutista»; setembro (preparação e passagens) só aparece quando tem atividades.
// Datas sempre «AAAA-MM-DD» (dias de Lisboa), sem passar por Date.

/** Primeiro mês do ano escutista completo (setembro). */
export const SCOUT_YEAR_START_MONTH = 9;

const pad = (n: number) => String(n).padStart(2, '0');

/** Ano escutista (ano em que começa) a que pertence o dia: «2026-09-01» → 2026; «2027-08-31» → 2026. */
export function scoutYearOf(day: string): number {
  const y = Number(day.slice(0, 4));
  return Number(day.slice(5, 7)) >= SCOUT_YEAR_START_MONTH ? y : y - 1;
}

/** «2026/27». */
export const scoutYearLabel = (start: number) => `${start}/${pad((start + 1) % 100)}`;

/** Ano a partir do rótulo «2026/27» (ou «2026/2027»); NaN se não for um rótulo. */
export const scoutYearFromLabel = (label: string) => (/^\d{4}\//.test(label) ? Number(label.slice(0, 4)) : NaN);

/** Ano escutista completo, com fim inclusivo: 2026 → 2026-09-01 a 2027-08-31. */
export function scoutYearBounds(start: number): { from: string; to: string } {
  return { from: `${start}-${pad(SCOUT_YEAR_START_MONTH)}-01`, to: `${start + 1}-08-31` };
}

/** Meses do ano escutista completo, de setembro a agosto, como «AAAA-MM». */
export function scoutYearMonths(start: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((SCOUT_YEAR_START_MONTH - 1 + i) % 12) + 1;
    return `${m >= SCOUT_YEAR_START_MONTH ? start : start + 1}-${pad(m)}`;
  });
}

/** Meses (01–12) pela ordem do ano escutista: setembro … agosto. */
export const SCOUT_MONTH_ORDER = scoutYearMonths(2000).map((ym) => ym.slice(5, 7));

/** «AAAA-MM» de um mês (01–12) dentro do ano escutista que começa em `start`. */
export const scoutMonth = (start: number, month: number) => `${month >= SCOUT_YEAR_START_MONTH ? start : start + 1}-${pad(month)}`;

/** Período de atividades (outubro a agosto) do ano escutista: meses e limites inclusivos. */
export function activityPeriod(start: number): { from: string; to: string; months: string[] } {
  const months = scoutYearMonths(start).filter((ym) => Number(ym.slice(5, 7)) !== SCOUT_YEAR_START_MONTH);
  return { from: `${months[0]}-01`, to: scoutYearBounds(start).to, months };
}
