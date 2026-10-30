import { describe, expect, it } from 'vitest';
import {
  activityPeriod, SCOUT_MONTH_ORDER, scoutMonth, scoutYearBounds, scoutYearFromLabel, scoutYearLabel, scoutYearMonths, scoutYearOf,
} from './anoEscutista';
import { coversDay, eventDays, period, yearOf } from '../modules/calendario/cal';
import { filtersFrom } from '../modules/tesouraria/api';
import { periodFrom } from '../modules/presencas/period';
import { scoutYear, yearBounds } from '../modules/equipas/data';

describe('ano escutista: uma só definição', () => {
  it('limites: 1 de setembro começa o ano; 31 de agosto ainda é do anterior', () => {
    expect(scoutYearOf('2026-08-31')).toBe(2025);
    expect(scoutYearOf('2026-09-01')).toBe(2026);
    expect(scoutYearOf('2026-09-30')).toBe(2026);
    expect(scoutYearOf('2026-10-01')).toBe(2026);
    expect(scoutYearOf('2027-01-01')).toBe(2026);
    expect(scoutYearOf('2027-08-31')).toBe(2026);
    expect(scoutYearBounds(2026)).toEqual({ from: '2026-09-01', to: '2027-08-31' });
  });

  it('rótulos e meses', () => {
    expect(scoutYearLabel(2026)).toBe('2026/27');
    expect(scoutYearLabel(2099)).toBe('2099/00');
    expect(scoutYearFromLabel('2026/27')).toBe(2026);
    expect(scoutYearFromLabel('x')).toBeNaN();
    expect(scoutYearMonths(2026)).toHaveLength(12);
    expect(scoutYearMonths(2026)[0]).toBe('2026-09');
    expect(scoutYearMonths(2026)[11]).toBe('2027-08');
    expect(SCOUT_MONTH_ORDER).toEqual(['09', '10', '11', '12', '01', '02', '03', '04', '05', '06', '07', '08']);
    expect(scoutMonth(2026, 9)).toBe('2026-09');
    expect(scoutMonth(2026, 2)).toBe('2027-02');
  });

  it('o período de atividades (outubro a agosto) é distinto do ano completo', () => {
    expect(activityPeriod(2026)).toMatchObject({ from: '2026-10-01', to: '2027-08-31' });
    expect(activityPeriod(2026).months).toHaveLength(11);
    expect(activityPeriod(2026).months).not.toContain('2026-09');
  });

  it('Calendário, Presenças, Tesouraria e Equipas usam a mesma regra', () => {
    for (const day of ['2026-08-31', '2026-09-01', '2026-09-15', '2027-03-01', '2027-08-31']) {
      const y = scoutYearOf(day);
      expect(yearOf(day, 'escutista')).toBe(y);
      expect(filtersFrom(new URLSearchParams(), day).ano).toBe(y);
      expect(periodFrom(new URLSearchParams(), day).year).toBe(y);
      expect(scoutYear(day)).toBe(scoutYearLabel(y));
    }
    const b = scoutYearBounds(2026);
    expect(period('escutista', 2026).yearFrom).toBe(b.from);
    expect(period('escutista', 2026).to).toBe(b.to);
    expect(filtersFrom(new URLSearchParams('ano=2026'))).toMatchObject({ de: b.from, ate: b.to });
    expect(periodFrom(new URLSearchParams('ano=2026'), '2026-10-30')).toMatchObject({ from: b.from, to: b.to });
    expect(yearBounds('2026/27')).toEqual([b.from, '2027-09-01']);
  });
});

describe('dias em Europe/Lisbon', () => {
  const timed = (starts_at: string, ends_at: string) => ({ all_day: false, starts_at, ends_at, start_date: null, end_date: null });
  const allDay = (start_date: string, end_date: string | null) => ({ all_day: true, starts_at: null, ends_at: null, start_date, end_date });

  it('uma atividade às 00:30 de Lisboa conta no dia de Lisboa, não no dia UTC', () => {
    // 31-08-2027 23:30 UTC = 01-09-2027 00:30 em Lisboa (verão, UTC+1): já é do ano seguinte.
    const e = timed('2027-08-31T23:30:00Z', '2027-09-01T01:00:00Z');
    expect(eventDays(e)).toEqual({ from: '2027-09-01', to: '2027-09-01' });
    expect(yearOf(eventDays(e).from, 'escutista')).toBe(2027);
  });

  it('mudança de hora: a noite de 24 para 25-10-2026 e a de 27 para 28-03-2027 ficam nos dias certos', () => {
    // Acantonamento das 21:00 de sábado às 09:00 de domingo (a hora muda pelo meio).
    expect(eventDays(timed('2026-10-24T20:00:00Z', '2026-10-25T09:00:00Z'))).toEqual({ from: '2026-10-24', to: '2026-10-25' });
    expect(eventDays(timed('2027-03-27T21:00:00Z', '2027-03-28T08:00:00Z'))).toEqual({ from: '2027-03-27', to: '2027-03-28' });
  });

  it('dia inteiro com vários dias (fim inclusivo) e atividade que acaba à meia-noite', () => {
    expect(eventDays(allDay('2026-12-27', '2026-12-30'))).toEqual({ from: '2026-12-27', to: '2026-12-30' });
    expect(eventDays(allDay('2026-12-27', null))).toEqual({ from: '2026-12-27', to: '2026-12-27' });
    expect(coversDay(allDay('2026-12-27', '2026-12-30'), '2026-12-29')).toBe(true);
    // 25-10-2026 já em hora de inverno (UTC+0): 00:00 de 26 = 2026-10-26T00:00Z.
    expect(eventDays(timed('2026-10-25T18:00:00Z', '2026-10-26T00:00:00Z'))).toEqual({ from: '2026-10-25', to: '2026-10-25' });
  });
});
