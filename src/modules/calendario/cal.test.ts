import { describe, expect, it } from 'vitest';
import { addDays, coversDay, eventDays, monthGrid, whenLabel } from './cal';
import { buildIcs, fold, icsFileName } from './ics';

const base = { id: 'e1', description: null, location: null, status: 'ativo' as const, updated_at: '2026-10-01T10:00:00Z' };

describe('dias do calendário', () => {
  it('grelha do mês começa à segunda e acaba ao domingo', () => {
    const g = monthGrid('2026-10');
    expect(g[0][0]).toBe('2026-09-28');
    expect(g.at(-1)!.at(-1)).toBe('2026-11-01');
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('atividades com horas usam o dia de Lisboa, incluindo a mudança de hora (25/10/2026)', () => {
    // 23:30 de 24/10 (WEST) = 22:30Z; 01:30 de 25/10 (WET) = 01:30Z
    const late = { all_day: false, starts_at: '2026-10-24T22:30:00Z', ends_at: '2026-10-24T22:50:00Z', start_date: null, end_date: null };
    const night = { all_day: false, starts_at: '2026-10-25T01:30:00Z', ends_at: '2026-10-25T03:00:00Z', start_date: null, end_date: null };
    expect(eventDays(late)).toEqual({ from: '2026-10-24', to: '2026-10-24' });
    expect(coversDay(night, '2026-10-25')).toBe(true);
    expect(whenLabel(night)).toBe('25/10/2026, 01:30–03:00');
    // termina à meia-noite: não ocupa o dia seguinte
    expect(eventDays({ all_day: false, starts_at: '2026-10-24T18:00:00Z', ends_at: '2026-10-24T23:00:00Z', start_date: null, end_date: null }))
      .toEqual({ from: '2026-10-24', to: '2026-10-24' });
  });

  it('dias inteiros e vários dias', () => {
    const one = { all_day: true, starts_at: null, ends_at: null, start_date: '2026-10-25', end_date: '2026-10-25' };
    const multi = { ...one, end_date: '2026-10-27' };
    expect(whenLabel(one)).toBe('25/10/2026 · dia inteiro');
    expect(whenLabel(multi)).toBe('25/10/2026 a 27/10/2026');
    expect(coversDay(multi, '2026-10-26')).toBe(true);
    expect(coversDay(multi, '2026-10-28')).toBe(false);
  });
});

describe('exportação ICS', () => {
  it('horas em UTC e dias inteiros como DATE com fim exclusivo', () => {
    const ics = buildIcs([
      { ...base, title: 'Raid, noturno; teste', all_day: false, starts_at: '2026-10-25T01:30:00Z', ends_at: '2026-10-25T03:00:00Z', start_date: null, end_date: null, location: 'Sede\nSala 2' },
      { ...base, id: 'e2', title: 'Acampamento', all_day: true, starts_at: null, ends_at: null, start_date: '2026-10-30', end_date: '2026-11-01', status: 'cancelado' },
    ], 'Calendário', new Date('2026-10-15T12:00:00Z'));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261025T013000Z\r\nDTEND:20261025T030000Z');
    expect(ics).toContain('SUMMARY:Raid\\, noturno\\; teste');
    expect(ics).toContain('LOCATION:Sede\\nSala 2');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261030\r\nDTEND;VALUE=DATE:20261102');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('UID:e2@pioneiros');
    expect(ics).toContain('DTSTAMP:20261015T120000Z');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it('dobra linhas longas sem partir caracteres', () => {
    const long = 'DESCRIPTION:' + 'ação '.repeat(40);
    const folded = fold(long);
    expect(folded.split('\r\n ').join('')).toBe(long);
    expect(folded.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(icsFileName('Acampamento de Natal — 2026!')).toBe('acampamento-de-natal-2026.ics');
  });
});
