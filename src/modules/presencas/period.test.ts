import { describe, expect, it } from 'vitest';
import { formatRate, periodFrom, rateSentence, scoutYearLabel, scoutYearOf, yearOptions } from './period';

const P = (q: string) => new URLSearchParams(q);

describe('ano escutista (setembro a agosto)', () => {
  it('começa a 1 de setembro', () => {
    expect(scoutYearOf('2026-08-31')).toBe(2025);
    expect(scoutYearOf('2026-09-01')).toBe(2026);
    expect(scoutYearOf('2027-01-10')).toBe(2026);
    expect(scoutYearLabel(2026)).toBe('2026/27');
    expect(scoutYearLabel(2099)).toBe('2099/00');
  });

  it('período por omissão: ano escutista atual', () => {
    expect(periodFrom(P(''), '2026-10-15')).toMatchObject({ from: '2026-09-01', to: '2027-08-31', year: 2026 });
    expect(periodFrom(P('ano=2025'), '2026-10-15')).toMatchObject({ from: '2025-09-01', to: '2026-08-31' });
    expect(periodFrom(P('ano=abc'), '2026-03-15')).toMatchObject({ year: 2025 });
  });

  it('mês dentro do ano escutista (janeiro a agosto pertencem ao ano seguinte)', () => {
    expect(periodFrom(P('ano=2026&mes=10'), '2026-10-15')).toMatchObject({ from: '2026-10-01', to: '2026-10-31', label: 'outubro de 2026' });
    expect(periodFrom(P('ano=2026&mes=02'), '2026-10-15')).toMatchObject({ from: '2027-02-01', to: '2027-02-28' });
    expect(periodFrom(P('ano=2027&mes=02'), '2026-10-15')).toMatchObject({ to: '2028-02-29' });
    expect(periodFrom(P('ano=2026&mes=13'), '2026-10-15')).toMatchObject({ from: '2026-09-01', month: '' });
  });

  it('datas livres têm prioridade; inválidas ou trocadas são ignoradas', () => {
    expect(periodFrom(P('de=2026-10-01&ate=2026-10-20&mes=05'), '2026-10-15')).toMatchObject({ from: '2026-10-01', to: '2026-10-20', label: '01/10/2026 a 20/10/2026' });
    expect(periodFrom(P('de=2026-10-20&ate=2026-10-01'), '2026-10-15')).toMatchObject({ from: '2026-09-01' });
    expect(periodFrom(P('de=ontem&ate=2026-10-01'), '2026-10-15')).toMatchObject({ from: '2026-09-01' });
  });

  it('anos para escolher', () => {
    expect(yearOptions('2026-10-15')).toEqual([2027, 2026, 2025, 2024]);
  });
});

describe('taxa de assiduidade', () => {
  it('sem registos contados mostra «—», nunca 0 %', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(undefined)).toBe('—');
    expect(rateSentence({ presencas: 0, contadas: 0, taxa: null })).toMatch(/ainda não há taxa/);
  });

  it('formata com vírgula e uma casa decimal quando necessário', () => {
    expect(formatRate(0)).toBe('0 %');
    expect(formatRate('100.0')).toBe('100 %');
    expect(formatRate('66.7')).toBe('66,7 %');
    expect(formatRate(33.33)).toBe('33,3 %');
    expect(rateSentence({ presencas: 1, contadas: 3, taxa: '33.3' })).toBe('33,3 % (1 presença em 3 sessões contadas)');
  });
});
