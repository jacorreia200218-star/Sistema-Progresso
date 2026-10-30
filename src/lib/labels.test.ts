import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './labels';

describe('datas DD-MM-AAAA', () => {
  it('datas sem hora não mudam de dia com o fuso horário', () => {
    expect(formatDate('2026-10-01')).toBe('01-10-2026');
    expect(formatDate('2026-12-31')).toBe('31-12-2026');
    expect(formatDateTime('2026-03-05')).toBe('05-03-2026');
  });
  it('instantes em hora de Lisboa, seja qual for o fuso do dispositivo', () => {
    // 13-10-2026 é horário de verão (UTC+1).
    expect(formatDate('2026-10-13T08:05:00Z')).toBe('13-10-2026');
    expect(formatDateTime('2026-10-13T08:05:00Z')).toBe('13-10-2026 · 09:05');
    // 23:30 UTC de 31/08 já é 01/09 em Lisboa.
    expect(formatDate('2027-08-31T23:30:00Z')).toBe('01-09-2027');
    // Depois da mudança de hora (25-10-2026), Lisboa = UTC.
    expect(formatDateTime('2026-10-25T01:30:00Z')).toBe('25-10-2026 · 01:30');
    expect(formatDateTime('2026-10-25T00:30:00Z')).toBe('25-10-2026 · 01:30');
  });
  it('vazio ou inválido', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('não é data')).toBe('—');
  });
});

describe('escrever datas', () => {
  it('máscara DD-MM-AAAA e leitura de vários formatos', async () => {
    const { maskDateText, parseDateText } = await import('./dates');
    expect(maskDateText('16102026')).toBe('16-10-2026');
    expect(maskDateText('1610')).toBe('16-10');
    expect(maskDateText('1-2-2026')).toBe('1-2-2026');
    expect(maskDateText('16/10/2026')).toBe('16-10-2026');
    expect(parseDateText('16-10-2026')).toBe('2026-10-16');
    expect(parseDateText('16/10/2026')).toBe('2026-10-16');
    expect(parseDateText('2026-10-16')).toBe('2026-10-16');
    expect(parseDateText('31-02-2026')).toBeNull();
  });
});
