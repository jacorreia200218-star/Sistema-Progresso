// «O que te falta»: horizonte próximo (2, 4 ou 8 semanas), contadores e filtro por tipo.
// O horizonte escolhido fica guardado neste dispositivo (localStorage, se disponível).
import { useState } from 'react';
import { lisbonDay } from '../common';
import { addDays, eventDays, sortKey, type Missing, type MyPending } from './cal';

export const HORIZONS = [2, 4, 8] as const;
export const DEFAULT_HORIZON = 4;
/** null = todas as datas (só na vista «Ver todas»). */
export type Horizon = number | null;
export const MISSING_ORDER: Missing[] = ['resposta', 'autorizacao', 'pagamento', 'inscricao', 'material'];

const KEY = 'cal-horizonte-semanas';
const valid = (n: number) => (HORIZONS as readonly number[]).includes(n);

export function loadHorizon(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return valid(n) ? n : DEFAULT_HORIZON;
  } catch {
    return DEFAULT_HORIZON;
  }
}

export function saveHorizon(n: number) {
  try {
    if (valid(n)) localStorage.setItem(KEY, String(n));
  } catch { /* sem armazenamento: fica só nesta visita */ }
}

/** Horizonte guardado por quem vê (por omissão, 4 semanas). */
export function useHorizon() {
  const [weeks, setWeeks] = useState(loadHorizon);
  const set = (n: number) => { setWeeks(n); saveHorizon(n); };
  return [weeks, set] as const;
}

export const horizonLabel = (w: Horizon) => (w == null ? 'Todas as datas' : `Próximas ${w} semanas`);
export const horizonEnd = (today: string, w: number) => addDays(today, w * 7);

/** Dentro do horizonte: a atividade começa até lá, ou o prazo de inscrição (ainda aberto) termina até lá. */
export function inHorizon(p: MyPending, today: string, w: Horizon): boolean {
  if (w == null) return true;
  const end = horizonEnd(today, w);
  if (eventDays(p).from <= end) return true;
  return !!p.registration_deadline && !p.deadline_passed && lisbonDay(p.registration_deadline) <= end;
}

/** Quantas atividades têm cada tipo de pendência (cada atividade conta uma vez por tipo). */
export function countMissing(items: MyPending[]): { kind: Missing; n: number }[] {
  return MISSING_ORDER.map((kind) => ({ kind, n: items.filter((p) => p.missing.includes(kind)).length })).filter((c) => c.n > 0);
}

export interface PendingSplit { soon: MyPending[]; later: MyPending[] }

export function splitPending(items: MyPending[], today: string, w: Horizon): PendingSplit {
  const sorted = [...items].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return { soon: sorted.filter((p) => inHorizon(p, today, w)), later: sorted.filter((p) => !inHorizon(p, today, w)) };
}

