// @vitest-environment node
// Leitura e expansão de calendários ICS (ficheiros fictícios em tests/fixtures/ical).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IcalError, defaultWindow, parseIcs, summarize, toHttpsUrl, wallToMs, type IcalItem } from './_ical';

const fx = (name: string) => readFileSync(path.resolve('tests/fixtures/ical', name), 'utf8');
const NOW = new Date('2026-10-18T12:00:00Z');
const parse = (name: string) => parseIcs(fx(name), { now: NOW });
const find = (items: IcalItem[], uid: string, rid = '') => items.find((i) => i.uid === uid && i.rid === rid);

describe('link', () => {
  it('converte webcal:// em https:// só para ler', () => {
    expect(toHttpsUrl(' webcal://p52-caldav.icloud.com/published/2/ABC123 ')).toBe('https://p52-caldav.icloud.com/published/2/ABC123');
    expect(toHttpsUrl('https://p52-caldav.icloud.com/published/2/ABC123#x')).toBe('https://p52-caldav.icloud.com/published/2/ABC123');
    expect(toHttpsUrl('http://p52-caldav.icloud.com/published/2/ABC')).toBe('https://p52-caldav.icloud.com/published/2/ABC');
  });
  it('recusa links vazios, inválidos ou fora do iCloud', () => {
    expect(() => toHttpsUrl('')).toThrow(IcalError);
    expect(() => toHttpsUrl('não é um link')).toThrow('Link inválido');
    expect(() => toHttpsUrl('webcal://exemplo.invalid/cal.ics')).toThrow('iCloud');
    expect(() => toHttpsUrl('webcal://icloud.com.exemplo.invalid/cal.ics')).toThrow('iCloud');
    expect(() => toHttpsUrl('webcal://user:pw@p01-caldav.icloud.com/x')).toThrow('Link inválido');
    expect(() => toHttpsUrl('webcal://p01-caldav.icloud.com:8443/x')).toThrow('Link inválido');
    expect(() => toHttpsUrl('ftp://p01-caldav.icloud.com/x')).toThrow('webcal://');
    expect(toHttpsUrl('webcal://cal.exemplo.invalid/x', ['exemplo.invalid'])).toBe('https://cal.exemplo.invalid/x');
  });
});

describe('datas e fusos', () => {
  it('hora de Lisboa com mudança de hora', () => {
    expect(new Date(wallToMs(2026, 10, 24, 14, 30, 0, 'Europe/Lisbon')).toISOString()).toBe('2026-10-24T13:30:00.000Z');
    expect(new Date(wallToMs(2026, 10, 31, 14, 30, 0, 'Europe/Lisbon')).toISOString()).toBe('2026-10-31T14:30:00.000Z');
    // 01:30 de 29/03/2026 não existe em Lisboa: passa para a hora de verão.
    expect(new Date(wallToMs(2026, 3, 29, 1, 30, 0, 'Europe/Lisbon')).toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });
  it('janela de ≈13 meses para cada lado', () => {
    expect(defaultWindow(NOW)).toEqual({ from: '2025-09-01', to: '2027-11-30' });
  });
});

describe('calendário simples', () => {
  const f = parse('basico.ics');
  it('nome, fusos, dias inteiros (fim exclusivo) e eventos de vários dias', () => {
    expect(f.name).toBe('Agrupamento Fictício');
    expect(find(f.items, 'raid-0001@icloud.invalid')).toMatchObject({
      rid: '', title: 'Raid de outono (fictício)', location: 'Serra, ponto de encontro', description: 'Levar lanterna.\nE água.',
      all_day: false, starts_at: '2026-10-24T13:30:00.000Z', ends_at: '2026-10-24T17:00:00.000Z', cancelled: false,
    });
    expect(find(f.items, 'raid-0002@icloud.invalid')?.starts_at).toBe('2026-10-31T14:30:00.000Z');
    expect(find(f.items, 'acamp-0003@icloud.invalid')).toMatchObject({ all_day: true, start_date: '2026-12-05', end_date: '2026-12-07', starts_at: null });
    expect(find(f.items, 'dia-0004@icloud.invalid')).toMatchObject({ start_date: '2026-11-01', end_date: '2026-11-01' });
    expect(find(f.items, 'utc-0005@icloud.invalid')).toMatchObject({ starts_at: '2026-11-15T10:00:00.000Z', ends_at: '2026-11-15T11:30:00.000Z' });
    expect(find(f.items, 'ny-0006@icloud.invalid')?.starts_at).toBe('2026-01-15T15:00:00.000Z');
    expect(find(f.items, 'float-0007@icloud.invalid')?.starts_at).toBe('2026-07-10T08:30:00.000Z');
    expect(find(f.items, 'multi-0009@icloud.invalid')).toMatchObject({ starts_at: '2027-04-02T18:00:00.000Z', ends_at: '2027-04-04T16:00:00.000Z' });
  });
  it('fora da janela não entra; evento sem UID torna a leitura incompleta', () => {
    expect(find(f.items, 'antigo-0008@icloud.invalid')).toBeUndefined();
    expect(f.items).toHaveLength(8);
    expect(f.complete).toBe(false);
    expect(f.warnings.join(' ')).toContain('sem UID');
  });
  it('pré-visualização: nome, número e intervalo de datas', () => {
    const s = summarize(f, NOW);
    expect(s).toMatchObject({ name: 'Agrupamento Fictício', events: 8, cancelled: 0, first: '2026-01-15', last: '2027-04-04', complete: false });
    expect(s.sample[0]).toMatchObject({ title: 'Raid de outono (fictício)', day: '2026-10-24' });
  });
});

describe('repetições', () => {
  const f = parse('recorrente.ics');
  const series = f.items.filter((i) => i.uid === 'sabado@icloud.invalid');
  it('semanal com mudança de hora, exceção movida, EXDATE e exceção cancelada (RECURRENCE-ID em UTC)', () => {
    expect(series.map((i) => [i.rid, i.starts_at, i.cancelled])).toEqual([
      ['20261017T133000Z', '2026-10-17T13:30:00.000Z', false],
      ['20261024T133000Z', '2026-10-24T09:00:00.000Z', false],
      ['20261031T143000Z', '2026-10-31T14:30:00.000Z', false],
      ['20261107T143000Z', '2026-11-07T14:30:00.000Z', true],
      ['20261114T143000Z', '2026-11-14T14:30:00.000Z', true],
      ['20261121T143000Z', '2026-11-21T14:30:00.000Z', false],
    ]);
    expect(find(f.items, 'sabado@icloud.invalid', '20261024T133000Z')).toMatchObject({ title: 'Reunião de sábado (de manhã)', location: 'Sede', ends_at: '2026-10-24T11:30:00.000Z' });
    expect(series.every((i) => i.ends_at && Date.parse(i.ends_at) > Date.parse(i.starts_at!))).toBe(true);
  });
  it('anual de dia inteiro e mensal com BYDAY', () => {
    expect(f.items.filter((i) => i.uid === 'aniversario@icloud.invalid').map((i) => [i.rid, i.start_date, i.end_date])).toEqual([
      ['20260222', '2026-02-22', '2026-02-22'], ['20270222', '2027-02-22', '2027-02-22'],
    ]);
    expect(f.items.filter((i) => i.uid === 'mensal@icloud.invalid').map((i) => i.starts_at)).toEqual([
      '2026-09-05T08:00:00.000Z', '2026-10-03T08:00:00.000Z', '2026-11-07T09:00:00.000Z', '2026-12-05T09:00:00.000Z',
    ]);
  });
  it('repetição sem fim fica limitada à janela', () => {
    const daily = f.items.filter((i) => i.uid === 'diario@icloud.invalid');
    expect(daily[0].start_date ?? daily[0].starts_at).toBe('2025-09-01T08:00:00.000Z');
    expect(daily.at(-1)!.starts_at).toBe('2027-11-30T08:00:00.000Z');
    expect(daily).toHaveLength(821);
    expect(f.complete).toBe(true);
  });
  it('limites: muitas ocorrências tornam a leitura incompleta', () => {
    const g = parseIcs(fx('recorrente.ics'), { now: NOW, maxItems: 100 });
    expect(g.items).toHaveLength(100);
    expect(g.complete).toBe(false);
    const h = parseIcs(fx('recorrente.ics'), { now: NOW, maxPerSeries: 50 });
    expect(h.complete).toBe(false);
  });
});

describe('cancelamentos e casos difíceis', () => {
  it('evento e série cancelados; exceção sem evento principal', () => {
    const f = parse('cancelado.ics');
    expect(find(f.items, 'cancelado@icloud.invalid')).toMatchObject({ cancelled: true });
    expect(f.items.filter((i) => i.uid === 'serie-cancelada@icloud.invalid').map((i) => [i.rid, i.cancelled])).toEqual([['20261201', true], ['20261208', true]]);
    expect(find(f.items, 'orfa@icloud.invalid', '20261212')).toMatchObject({ start_date: '2026-12-13', cancelled: false });
    expect(summarize(f, NOW)).toMatchObject({ events: 1, cancelled: 3 });
  });
  it('resposta cortada é incompleta; vazio é válido; HTML é recusado', () => {
    const c = parse('cortado.ics');
    expect(c.complete).toBe(false);
    expect(c.warnings[0]).toContain('cortada');
    expect(c.items.map((i) => i.uid)).toEqual(['um@icloud.invalid', 'dois@icloud.invalid']);
    const v = parse('vazio.ics');
    expect(v).toMatchObject({ name: 'Vazio (fictício)', complete: true, items: [] });
    expect(summarize(v, NOW)).toMatchObject({ events: 0, first: null, last: null });
    expect(() => parse('nao-e-calendario.html')).toThrow('não devolveu um calendário');
    expect(() => parseIcs('BEGIN:VCALENDAR\nisto não é ics')).toThrow(IcalError);
  });
  it('é determinista (mesma entrada, mesmo resultado)', () => {
    expect(parse('recorrente.ics')).toEqual(parse('recorrente.ics'));
  });
});
