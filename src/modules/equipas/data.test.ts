import { describe, expect, it } from 'vitest';
import { appointmentState, inYear, membersInYear, periodLabel, scoutYear, teamPeriods, yearBounds, yearOptions, type EqMember, type EqMove } from './data';

const mv = (membership_id: string, on: string, from: string | null, to: string): EqMove =>
  ({ id: on, membership_id, on, at: `${on}T10:00:00Z`, from_team_id: from, to_team_id: to, reason: null, source: 'modulo', applied: true, by_name: null });
const mb = (id: string, team: string | null, since = '2024-09-10'): EqMember =>
  ({ membership_id: id, profile_id: id, full_name: id, totem: null, function: 'pioneiro', status: 'ativo', team_id: team, since });

describe('ano escutista', () => {
  it('vai de setembro a agosto', () => {
    expect(scoutYear('2026-10-15')).toBe('2026/27');
    expect(scoutYear('2026-09-01')).toBe('2026/27');
    expect(scoutYear('2026-08-31')).toBe('2025/26');
    expect(scoutYear('1999-12-01')).toBe('1999/00');
    expect(yearBounds('2026/27')).toEqual(['2026-09-01', '2027-09-01']);
  });

  it('opções desde o primeiro registo até ao ano atual', () => {
    expect(yearOptions({ today: '2026-10-15', appointments: [], moves: [mv('a', '2024-10-01', null, 't')] })).toEqual(['2026/27', '2025/26', '2024/25']);
  });
});

describe('nomeações', () => {
  it('estado com fim no dia da passagem', () => {
    const t = '2026-10-15';
    expect(appointmentState({ starts_on: '2026-09-01', ends_on: null, cancelled_at: null }, t)).toBe('ativo');
    expect(appointmentState({ starts_on: '2026-09-01', ends_on: t, cancelled_at: null }, t)).toBe('terminado');
    expect(appointmentState({ starts_on: '2026-09-01', ends_on: '2026-10-16', cancelled_at: null }, t)).toBe('ativo');
    expect(appointmentState({ starts_on: '2026-11-01', ends_on: null, cancelled_at: null }, t)).toBe('futuro');
    expect(appointmentState({ starts_on: '2026-09-01', ends_on: null, cancelled_at: 'x' }, t)).toBe('anulado');
  });

  it('pertença ao ano e período legível', () => {
    expect(inYear({ starts_on: '2025-10-01', ends_on: '2026-09-01' }, '2026/27')).toBe(true);
    expect(inYear({ starts_on: '2025-10-01', ends_on: '2026-08-31' }, '2026/27')).toBe(false);
    expect(inYear({ starts_on: '2027-09-01', ends_on: null }, '2026/27')).toBe(false);
    expect(periodLabel({ starts_on: '2026-09-01', ends_on: null })).toBe('desde 01/09/2026');
    expect(periodLabel({ starts_on: '2026-09-01', ends_on: '2027-06-30' })).toBe('01/09/2026 a 30/06/2027');
  });
});

describe('composição por ano', () => {
  it('reconstrói as equipas a partir das mudanças', () => {
    const moves = [mv('p1', '2025-10-01', 'A', 'B'), mv('p1', '2026-10-01', 'B', 'A')];
    expect(teamPeriods(mb('p1', 'A'), moves)).toEqual([
      { team: 'A', from: '2024-09-10', to: '2025-10-01' },
      { team: 'B', from: '2025-10-01', to: '2026-10-01' },
      { team: 'A', from: '2026-10-01', to: null },
    ]);
    const members = [mb('p1', 'A'), mb('p2', 'A'), mb('p3', 'B', '2026-09-20')];
    expect(membersInYear('B', '2025/26', members, moves).map((m) => m.membership_id)).toEqual(['p1']);
    expect(membersInYear('A', '2025/26', members, moves).map((m) => m.membership_id)).toEqual(['p1', 'p2']);
    expect(membersInYear('B', '2024/25', members, moves).map((m) => m.membership_id)).toEqual([]);
    expect(membersInYear('B', '2026/27', members, moves).map((m) => m.membership_id)).toEqual(['p1', 'p3']);
  });
});
