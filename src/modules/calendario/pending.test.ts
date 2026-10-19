import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MyPending } from './cal';
import { countMissing, DEFAULT_HORIZON, inHorizon, loadHorizon, saveHorizon, splitPending } from './pending';

const item = (id: string, day: string, missing: MyPending['missing'], deadline: string | null = null, passed = false): MyPending => ({
  id, title: id, all_day: true, starts_at: null, ends_at: null, start_date: day, end_date: day,
  registration_deadline: deadline, deadline_passed: passed, missing,
});

describe('o que te falta: horizonte próximo', () => {
  const today = '2026-10-18';

  it('conta só o que começa até ao fim do horizonte (inclusive)', () => {
    expect(inHorizon(item('a', '2026-11-15', ['resposta']), today, 4)).toBe(true);
    expect(inHorizon(item('b', '2026-11-16', ['resposta']), today, 4)).toBe(false);
    expect(inHorizon(item('b', '2026-11-16', ['resposta']), today, null)).toBe(true);
  });

  it('inclui atividades mais tarde cujo prazo de inscrição acaba dentro do horizonte', () => {
    expect(inHorizon(item('c', '2027-03-01', ['inscricao'], '2026-10-25T23:00:00Z'), today, 2)).toBe(true);
    expect(inHorizon(item('d', '2027-03-01', ['inscricao'], '2026-10-10T23:00:00Z', true), today, 2)).toBe(false);
  });

  it('separa por ordem cronológica e conta cada atividade uma vez por tipo', () => {
    const items = [item('z', '2027-05-01', ['resposta']), item('y', '2026-10-30', ['resposta', 'autorizacao']), item('x', '2026-10-20', ['resposta'])];
    const s = splitPending(items, today, 4);
    expect(s.soon.map((p) => p.id)).toEqual(['x', 'y']);
    expect(s.later.map((p) => p.id)).toEqual(['z']);
    expect(countMissing(s.soon)).toEqual([{ kind: 'resposta', n: 2 }, { kind: 'autorizacao', n: 1 }]);
  });
});

describe('horizonte guardado por quem vê', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('guarda e lê 2, 4 ou 8 semanas; valores inválidos voltam ao habitual', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    expect(loadHorizon()).toBe(DEFAULT_HORIZON);
    saveHorizon(8);
    expect(loadHorizon()).toBe(8);
    saveHorizon(5);
    expect(loadHorizon()).toBe(8);
    store.set('cal-horizonte-semanas', 'lixo');
    expect(loadHorizon()).toBe(DEFAULT_HORIZON);
  });

  it('sem armazenamento disponível não falha', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } });
    expect(loadHorizon()).toBe(DEFAULT_HORIZON);
    expect(() => saveHorizon(2)).not.toThrow();
  });
});
