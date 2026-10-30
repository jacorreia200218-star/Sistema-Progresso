// Base comum dos módulos: acesso por módulo, espaço de dados (teste/real),
// datas em Europe/Lisbon, valores em euros (cêntimos inteiros) e exportações.
// O acesso aqui só decide o que mostrar: o servidor volta a verificar tudo.
import { useQuery } from '@tanstack/react-query';
import { call } from '../lib/api';
import { useActiveSection } from '../lib/session';
import { DATE_SEP, DATE_TIME_SEP } from '../lib/dates';

export type ModuleKey = 'calendario' | 'inventario' | 'tesouraria' | 'equipas' | 'secretaria' | 'presencas';
export type ModuleStatus = 'desenvolvimento' | 'teste' | 'disponivel';
export type ModuleAccess = { module: ModuleKey; status: ModuleStatus; space: 'teste' | 'real' | null; grants: string[]; dirigente: boolean };

export const MODULE_STATUS_LABEL: Record<ModuleStatus, string> = {
  desenvolvimento: 'Em desenvolvimento', teste: 'Em teste', disponivel: 'Disponível',
};

export const MODULE_PERMISSIONS: Record<ModuleKey, { key: string; label: string; hint: string }[]> = {
  calendario: [{ key: 'calendario.gerir', label: 'Gerir atividades', hint: 'Criar, alterar e cancelar atividades, participantes e pendências. Os dirigentes já podem.' }],
  inventario: [{ key: 'inventario.gerir', label: 'Responsável de material', hint: 'Editar material, aprovar empréstimos e registar devoluções. Os dirigentes já podem.' }],
  tesouraria: [{ key: 'tesouraria.gerir', label: 'Tesoureiro autorizado', hint: 'Criar, corrigir e anular movimentos, quotas e pagamentos. Nem os dirigentes têm este acesso sem autorização.' }],
  equipas: [{ key: 'equipas.gerir', label: 'Gerir cargos', hint: 'Nomear e terminar cargos e configurar as equipas. Os dirigentes já podem.' }],
  secretaria: [
    { key: 'secretaria.redigir', label: 'Escrever atas e gerir tarefas', hint: 'Escrever atas e criar, atribuir e editar tarefas. Os dirigentes já podem.' },
    { key: 'secretaria.aprovar', label: 'Ver atas reservadas', hint: 'Ver as atas reservadas aos dirigentes.' },
  ],
  presencas: [{ key: 'presencas.registar', label: 'Registar presenças', hint: 'Registar e corrigir presenças e ver justificações. Os dirigentes já podem.' }],
};

export function useMyModules() {
  const s = useActiveSection();
  return useQuery({
    queryKey: ['my-modules', s.membership.section_id],
    queryFn: () => call<ModuleAccess[]>('my_modules', { p_section: s.membership.section_id }),
    staleTime: 30_000,
  });
}

/** Etiqueta do módulo no menu: «Em teste» para testers, nada quando disponível, senão «Em desenvolvimento». */
export function moduleTag(m: ModuleAccess | undefined): string | null {
  if (m?.space === 'teste') return 'Em teste';
  if (m?.space === 'real') return null;
  return 'Em desenvolvimento';
}

export function useModule(key: ModuleKey) {
  const q = useMyModules();
  const m = q.data?.find((x) => x.module === key);
  return {
    loading: q.isLoading,
    error: q.error,
    access: m ?? null,
    space: m?.space ?? null,
    isTest: m?.space === 'teste',
    can: (permission: string, dirigenteOk = false) => !!m?.space && (m.grants.includes(permission) || (dirigenteOk && m.dirigente)),
  };
}

// ---------------------------------------------------------------------------
// Datas (Europe/Lisbon, incluindo mudanças de hora)
// ---------------------------------------------------------------------------
export const TZ = 'Europe/Lisbon';
const parts = (d: Date) => Object.fromEntries(
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((p) => [p.type, p.value]),
) as Record<string, string>;

/** «AAAA-MM-DDTHH:MM» em hora de Lisboa → instante ISO (UTC). */
export function lisbonToIso(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error('Data inválida.');
  const [, y, mo, d, h, mi] = m.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Ajusta pelo desfasamento de Lisboa nesse instante (duas passagens cobrem a mudança de hora).
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(t));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    t = guess - (asUtc - t);
  }
  return new Date(t).toISOString();
}

/** Instante ISO → «AAAA-MM-DDTHH:MM» em hora de Lisboa (para inputs datetime-local). */
export function isoToLisbon(iso: string): string {
  const p = parts(new Date(iso));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Dia (AAAA-MM-DD) de um instante em Lisboa. */
export const lisbonDay = (iso: string) => isoToLisbon(iso).slice(0, 10);
export const lisbonTime = (iso: string) => isoToLisbon(iso).slice(11, 16);
export const todayLisbon = () => lisbonDay(new Date().toISOString());

/** Reunião habitual da secção: sábado, das 14:30 às 16:00 (valores por omissão nos formulários novos). */
export const MEETING_DEFAULT = { title: 'Reunião', start: '14:30', end: '16:00' } as const;

/** O próprio dia, se for sábado, ou o sábado seguinte (AAAA-MM-DD). */
export function nextSaturday(day = todayLisbon()): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

/** Data sem hora «AAAA-MM-DD» → «DD-MM-AAAA». Para um instante, usar formatLisbonDay. */
export function formatDay(day: string) {
  const [y, m, d] = day.slice(0, 10).split('-');
  return [d, m, y].join(DATE_SEP);
}
/** Instante → dia em Lisboa, «DD-MM-AAAA» (nunca cortar o ISO: o dia UTC pode ser outro). */
export const formatLisbonDay = (iso: string) => formatDay(lisbonDay(iso));
/** Instante → «DD-MM-AAAA · HH:MM» em hora de Lisboa. */
export const formatLisbon = (iso: string) => `${formatDay(lisbonDay(iso))}${DATE_TIME_SEP}${lisbonTime(iso)}`;

export const WEEKDAYS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// ---------------------------------------------------------------------------
// Euros: sempre em cêntimos inteiros (sem vírgula flutuante)
// ---------------------------------------------------------------------------
/** «12,30», «12.3», «1 234,5» → 1230 / 1230 / 123450. Devolve null se inválido. */
export function parseEuros(text: string): number | null {
  const t = text.trim().replace(/\s|€/g, '');
  const m = /^(-)?(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0') || 0);
  return m[1] ? -cents : cents;
}

const NBSP = '\u00a0';
/**
 * Cêntimos → «1 234,56 €» (formato português: vírgula decimal, espaço nos milhares e antes do
 * símbolo). Os espaços são inquebráveis, para o valor nunca se partir em duas linhas.
 */
export function formatEuros(cents: number | null | undefined): string {
  if (cents == null) return '—';
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const euros = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${neg ? '−' : ''}${euros},${String(abs % 100).padStart(2, '0')}${NBSP}€`;
}

/** Valor para preencher um campo (sem símbolo). */
export const eurosInput = (cents: number) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)},${String(Math.abs(cents) % 100).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Exportações
// ---------------------------------------------------------------------------
export function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV com «;» (Excel em português) e BOM UTF-8. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}
