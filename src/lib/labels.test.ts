import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './labels';

describe('datas DD/MM/AAAA', () => {
  it('datas sem hora não mudam de dia com o fuso horário', () => {
    expect(formatDate('2026-10-01')).toBe('01/10/2026');
    expect(formatDate('2026-12-31')).toBe('31/12/2026');
    expect(formatDateTime('2026-03-05')).toBe('05/03/2026');
  });
  it('instantes em hora local', () => {
    const iso = new Date(2026, 9, 13, 9, 5).toISOString();
    expect(formatDate(iso)).toBe('13/10/2026');
    expect(formatDateTime(iso)).toBe('13/10/2026 · 09:05');
  });
  it('vazio ou inválido', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('não é data')).toBe('—');
  });
});
