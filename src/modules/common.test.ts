import { describe, expect, it } from 'vitest';
import { formatEuros, isoToLisbon, lisbonToIso, parseEuros, toCsv } from './common';

describe('datas em Lisboa', () => {
  it('converte nos dois sentidos, no verão e no inverno', () => {
    expect(lisbonToIso('2026-07-01T10:00')).toBe('2026-07-01T09:00:00.000Z');
    expect(lisbonToIso('2026-12-01T10:00')).toBe('2026-12-01T10:00:00.000Z');
    expect(isoToLisbon('2026-07-01T09:00:00Z')).toBe('2026-07-01T10:00');
  });
  it('mudança de hora (25/10/2026 às 02:00 volta à 01:00)', () => {
    expect(lisbonToIso('2026-10-24T12:00')).toBe('2026-10-24T11:00:00.000Z');
    expect(lisbonToIso('2026-10-25T12:00')).toBe('2026-10-25T12:00:00.000Z');
    expect(lisbonToIso('2026-03-29T12:00')).toBe('2026-03-29T11:00:00.000Z');
  });
});

describe('euros em cêntimos', () => {
  it('lê valores sem arredondamentos', () => {
    expect(parseEuros('12,30')).toBe(1230);
    expect(parseEuros('0.1')).toBe(10);
    expect(parseEuros('1 234,56 €')).toBe(123456);
    expect(parseEuros('-5')).toBe(-500);
    expect(parseEuros('1,234')).toBeNull();
    expect(parseEuros('abc')).toBeNull();
  });
  it('formata', () => {
    expect(formatEuros(123456)).toBe('1 234,56 €');
    expect(formatEuros(-10)).toBe('−0,10 €');
    expect(formatEuros(0)).toBe('0,00 €');
  });
});

it('CSV com separador ; e aspas', () => {
  expect(toCsv([['a;b', 'c"d', 1]])).toBe('﻿"a;b";"c""d";1\r\n');
});
