import { describe, expect, it } from 'vitest';
import { dayMarks, easter, freeSlots, isHoliday, nationalHolidays } from './holidays';
import { busyDays, period, yearOf } from './cal';

describe('Páscoa e feriados móveis', () => {
  it('Domingo de Páscoa em vários anos', () => {
    expect(easter(2024)).toBe('2024-03-31');
    expect(easter(2025)).toBe('2025-04-20');
    expect(easter(2026)).toBe('2026-04-05');
    expect(easter(2027)).toBe('2027-03-28');
    expect(easter(2028)).toBe('2028-04-16');
    expect(easter(2019)).toBe('2019-04-21');
    expect(easter(2038)).toBe('2038-04-25');
    expect(easter(2000)).toBe('2000-04-23');
  });

  it('feriados nacionais de 2026 com nomes; Carnaval é dia relevante (tolerância), não feriado', () => {
    const h = nationalHolidays(2026);
    const nacionais = [...h].filter(([, m]) => m.kind === 'nacional').map(([d, m]) => `${d} ${m.name}`).sort();
    expect(nacionais).toEqual([
      '2026-01-01 Ano Novo',
      '2026-04-03 Sexta-feira Santa',
      '2026-04-05 Páscoa',
      '2026-04-25 Dia da Liberdade',
      '2026-05-01 Dia do Trabalhador',
      '2026-06-04 Corpo de Deus',
      '2026-06-10 Dia de Portugal',
      '2026-08-15 Assunção de Nossa Senhora',
      '2026-10-05 Implantação da República',
      '2026-11-01 Dia de Todos os Santos',
      '2026-12-01 Restauração da Independência',
      '2026-12-08 Imaculada Conceição',
      '2026-12-25 Natal',
    ]);
    expect(h.get('2026-02-17')).toEqual({ name: 'Carnaval (tolerância facultativa)', kind: 'relevante', movable: true });
    expect(nationalHolidays(2027).get('2027-05-27')?.name).toBe('Corpo de Deus');
    expect(nationalHolidays(2028).get('2028-04-14')?.name).toBe('Sexta-feira Santa');
  });
});

describe('dias especiais da secção', () => {
  const special = [
    { id: 'a', day: '2020-06-24', name: 'São João', kind: 'municipal' as const, recurring: true },
    { id: 'b', day: '2027-02-22', name: 'Dia do Pensamento', kind: 'relevante' as const, recurring: false },
    { id: 'c', day: '2024-02-29', name: 'Dia bissexto', kind: 'relevante' as const, recurring: true },
  ];
  it('recorrentes repetem todos os anos; únicos só na data; vários anos no período', () => {
    const m = dayMarks('2026-09-01', '2027-08-31', special);
    expect(m.get('2027-06-24')).toEqual([{ name: 'São João', kind: 'municipal' }]);
    expect(m.has('2026-06-24')).toBe(false); // fora do período
    expect(m.get('2027-02-22')).toEqual([{ name: 'Dia do Pensamento', kind: 'relevante' }]);
    expect(m.get('2026-12-25')?.[0].name).toBe('Natal');
    expect(m.get('2027-03-26')?.[0].name).toBe('Sexta-feira Santa');
    expect(isHoliday(m.get('2027-06-24'))).toBe(true);
    expect(isHoliday(m.get('2027-02-22'))).toBe(false);
    expect(dayMarks('2027-01-01', '2028-12-31', special).has('2027-02-29')).toBe(false);
    // Em 2028 o Carnaval calha a 29/02: o dia fica com as duas marcas
    expect(dayMarks('2028-01-01', '2028-12-31', special).get('2028-02-29')?.map((x) => x.name)).toEqual(['Carnaval (tolerância facultativa)', 'Dia bissexto']);
  });
});

describe('ano civil, ano escutista e dias livres', () => {
  it('períodos de 12 meses', () => {
    const civil = period('civil', 2026, 9);
    expect(civil).toMatchObject({ label: '2026', from: '2026-01-01', to: '2026-12-31' });
    expect(civil.months).toHaveLength(12);
    const esc = period('escutista', 2026, 9);
    expect(esc).toMatchObject({ label: '2026/2027', from: '2026-09-01', to: '2027-08-31' });
    expect(esc.months[0]).toBe('2026-09');
    expect(esc.months[11]).toBe('2027-08');
    expect(period('escutista', 2026, 1).label).toBe('2026');
    expect(yearOf('2026-10-15', 'escutista', 9)).toBe(2026);
    expect(yearOf('2027-03-01', 'escutista', 9)).toBe(2026);
    expect(yearOf('2027-03-01', 'civil', 9)).toBe(2027);
  });

  it('fins de semana e feriados sem atividades', () => {
    const marks = dayMarks('2026-04-01', '2026-04-30');
    const ev = { all_day: true, starts_at: null, ends_at: null, start_date: '2026-04-11', end_date: '2026-04-12' };
    const cancelled = { ...ev, start_date: '2026-04-18', end_date: '2026-04-18', status: 'cancelado' };
    const busy = busyDays([ev, cancelled], '2026-04-01', '2026-04-30');
    expect([...busy.keys()]).toEqual(['2026-04-11', '2026-04-12']);
    const free = freeSlots('2026-04-01', '2026-04-30', busy, marks);
    // 03/04 (Sexta-feira Santa) junta-se ao fim de semana da Páscoa; 11–12 ocupado; 25/04 é sábado
    expect(free.map((s) => `${s.kind} ${s.from}..${s.to}`)).toEqual([
      'fim_de_semana 2026-04-03..2026-04-05',
      'fim_de_semana 2026-04-18..2026-04-19',
      'fim_de_semana 2026-04-25..2026-04-26',
    ]);
    expect(free[0].names).toEqual(['Sexta-feira Santa', 'Páscoa']);
    // Feriado a meio da semana
    const june = freeSlots('2026-06-01', '2026-06-12', new Set<string>(), dayMarks('2026-06-01', '2026-06-12'));
    expect(june.map((s) => `${s.kind} ${s.from} ${s.names.join(',')}`)).toEqual([
      'feriado 2026-06-04 Corpo de Deus', 'fim_de_semana 2026-06-06 ', 'feriado 2026-06-10 Dia de Portugal',
    ]);
  });
});
