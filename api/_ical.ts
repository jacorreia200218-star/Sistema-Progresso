// Leitura de calendários ICS (iCloud) para o Calendário escutista: valida o link, lê o
// conteúdo e expande as repetições numa janela limitada (≈13 meses para trás e para a
// frente). Cada ocorrência fica identificada por UID + RECURRENCE-ID ('' se não se repete).
// Horas convertidas para instantes UTC (o fuso indicado no ICS é respeitado; sem fuso,
// conta como hora de Lisboa). Sem rede e sem base de dados: testável à parte.
import ICAL from 'ical.js';

export const LISBON = 'Europe/Lisbon';

export interface IcalItem {
  uid: string;
  /** RECURRENCE-ID normalizado: 'AAAAMMDD' (dia) ou 'AAAAMMDDTHHMMSSZ' (UTC); '' sem repetição. */
  rid: string;
  title: string;
  description: string | null;
  location: string | null;
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  /** Último dia (inclusivo). */
  end_date: string | null;
  cancelled: boolean;
}

export interface IcalFeed {
  name: string | null;
  /** Falso se a resposta parece cortada, se algum evento não se pôde ler ou se houve limites. */
  complete: boolean;
  window_from: string;
  window_to: string;
  items: IcalItem[];
  warnings: string[];
}

export interface IcalSummary {
  name: string | null;
  events: number;
  cancelled: number;
  first: string | null;
  last: string | null;
  complete: boolean;
  warnings: string[];
  sample: { title: string; day: string; all_day: boolean; starts_at: string | null }[];
}

export class IcalError extends Error {}

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------
export function allowedHost(host: string, extra: string[] = []): boolean {
  const h = host.toLowerCase();
  if (h === 'icloud.com' || h.endsWith('.icloud.com')) return true;
  return extra.some((x) => x && (h === x.toLowerCase() || h.endsWith(`.${x.toLowerCase()}`)));
}

/** webcal:// (ou https://) → https://, só para ler o conteúdo. Recusa outros endereços. */
export function toHttpsUrl(input: string, extraHosts: string[] = []): string {
  const raw = (input ?? '').trim();
  if (!raw) throw new IcalError('Cola o link do calendário (começa por webcal://).');
  if (raw.length > 2000) throw new IcalError('O link é demasiado longo.');
  let u: URL;
  try {
    u = new URL(raw.replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    throw new IcalError('Link inválido. Copia o link de partilha pública do calendário no iCloud.');
  }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:') throw new IcalError('Link inválido: tem de começar por webcal:// ou https://.');
  if (u.username || u.password || (u.port && u.port !== '443')) throw new IcalError('Link inválido.');
  if (!allowedHost(u.hostname, extraHosts)) {
    throw new IcalError('Só são aceites calendários partilhados do iCloud (endereços icloud.com).');
  }
  u.hash = '';
  return u.toString();
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------
const pad = (n: number, l = 2) => String(n).padStart(l, '0');
const ymd = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

export function addDaysIso(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400e3).toISOString().slice(0, 10);
}

/** Dia (AAAA-MM-DD) de um instante em Lisboa. */
const lisbonFmt = new Intl.DateTimeFormat('en-CA', { timeZone: LISBON, year: 'numeric', month: '2-digit', day: '2-digit' });
export function lisbonDay(ms: number): string {
  return lisbonFmt.format(new Date(ms));
}

const zoneOk = new Map<string, boolean>();
function isIana(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  let ok = zoneOk.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    zoneOk.set(tz, ok);
  }
  return ok;
}

const fmts = new Map<string, Intl.DateTimeFormat>();
function offsetMs(ms: number, tz: string): number {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmts.set(tz, f);
  }
  const parts = f.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(ms / 1000) * 1000;
}

/** Hora de parede num fuso IANA → instante (ms). Na hora que «não existe» (mudança de hora) avança. */
export function wallToMs(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - offsetMs(guess, tz);
  const o2 = offsetMs(t, tz);
  if (guess - o2 !== t) t = guess - o2;
  return t;
}

type ITime = InstanceType<typeof ICAL.Time>;

/** Instante (ms) de um valor DATE-TIME do ICS, respeitando o fuso. */
function timeToMs(t: ITime, tzParam?: string | null): number {
  const zoneId = t.zone?.tzid;
  if (zoneId === 'UTC' || zoneId === 'Z' || zoneId === 'GMT') return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  const named = zoneId && zoneId !== 'floating' ? zoneId : (tzParam ?? (t as ITime & { timezone?: string }).timezone ?? null);
  if (isIana(named)) return wallToMs(t.year, t.month, t.day, t.hour, t.minute, t.second, named);
  // Fuso próprio do ICS (VTIMEZONE com nome não normalizado): usa as regras incluídas.
  if (t.zone && zoneId !== 'floating') return t.toUnixTime() * 1000;
  // Sem fuso: hora de Lisboa.
  return wallToMs(t.year, t.month, t.day, t.hour, t.minute, t.second, LISBON);
}

const dateOf = (t: ITime) => ymd(t.year, t.month, t.day);

function ridOf(t: ITime, tzParam?: string | null): string {
  if (t.isDate) return `${pad(t.year, 4)}${pad(t.month)}${pad(t.day)}`;
  return new Date(timeToMs(t, tzParam)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------
type IComp = InstanceType<typeof ICAL.Component>;

const text = (c: IComp, name: string): string | null => {
  const v = c.getFirstPropertyValue(name);
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\r\n?/g, '\n').trim();
  return s || null;
};
const cut = (s: string | null, n: number) => (s && s.length > n ? s.slice(0, n) : s);

interface Window { from: string; to: string }

/** Janela por omissão: do dia 1 do mês de há 13 meses ao último dia do mês daqui a 13 meses (Lisboa). */
export function defaultWindow(now = new Date(), months = 13): Window {
  const today = lisbonDay(now.getTime());
  const [y, m] = today.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 - months, 1)).toISOString().slice(0, 10);
  const last = addDaysIso(new Date(Date.UTC(y, m + months, 1)).toISOString().slice(0, 10), -1);
  return { from: first, to: last };
}

interface Base { title: string; description: string | null; location: string | null; cancelled: boolean }

function baseOf(c: IComp, fallback?: Base): Base {
  const status = (text(c, 'status') ?? '').toUpperCase();
  return {
    title: cut(text(c, 'summary') ?? fallback?.title ?? '(Sem título)', 200)!,
    description: cut(text(c, 'description') ?? (fallback ? fallback.description : null), 5000),
    location: cut(text(c, 'location') ?? (fallback ? fallback.location : null), 300),
    cancelled: status === 'CANCELLED',
  };
}

/** Datas de uma ocorrência (início e fim) em formato da base de dados. */
function span(start: ITime, end: ITime | null, tz: string | null, tzEnd: string | null) {
  if (start.isDate) {
    // DTEND de dia inteiro é exclusivo.
    const s = dateOf(start);
    let e = end ? addDaysIso(dateOf(end), end.isDate ? -1 : 0) : s;
    if (e < s) e = s;
    return { all_day: true, starts_at: null, ends_at: null, start_date: s, end_date: e };
  }
  const s = timeToMs(start, tz);
  let e = end ? (end.isDate ? wallToMs(end.year, end.month, end.day, 0, 0, 0, LISBON) : timeToMs(end, tzEnd ?? tz)) : s;
  if (e < s) e = s;
  return { all_day: false, starts_at: new Date(s).toISOString(), ends_at: new Date(e).toISOString(), start_date: null, end_date: null };
}

function days(it: Pick<IcalItem, 'all_day' | 'start_date' | 'end_date' | 'starts_at' | 'ends_at'>) {
  if (it.all_day) return { from: it.start_date!, to: it.end_date! };
  const s = Date.parse(it.starts_at!);
  const e = Date.parse(it.ends_at!);
  return { from: lisbonDay(s), to: lisbonDay(Math.max(s, e - 1)) };
}

const overlaps = (it: IcalItem, w: Window) => {
  const d = days(it);
  return d.from <= w.to && d.to >= w.from;
};

const tzParamOf = (c: IComp, prop: string) => {
  const p = c.getFirstProperty(prop);
  const v = p?.getParameter('tzid');
  return typeof v === 'string' ? v : null;
};

function endOf(c: IComp, start: ITime): ITime | null {
  const end = c.getFirstPropertyValue('dtend') as ITime | null;
  if (end) return end;
  const dur = c.getFirstPropertyValue('duration') as InstanceType<typeof ICAL.Duration> | null;
  if (dur) {
    const e = start.clone();
    e.addDuration(dur);
    return e;
  }
  return null;
}

export interface ParseOptions { now?: Date; window?: Window; maxItems?: number; maxPerSeries?: number }

/** Lê o ICS e devolve as ocorrências dentro da janela. Lança IcalError se não for um calendário. */
export function parseIcs(input: string, opts: ParseOptions = {}): IcalFeed {
  const w = opts.window ?? defaultWindow(opts.now);
  const maxItems = opts.maxItems ?? 5000;
  const maxPerSeries = opts.maxPerSeries ?? 20000;
  let raw = (input ?? '').replace(/^﻿/, '');
  if (!/BEGIN:VCALENDAR/i.test(raw)) throw new IcalError('O link não devolveu um calendário (ICS).');
  const warnings: string[] = [];
  let complete = /END:VCALENDAR\s*$/i.test(raw);
  if (!complete) {
    // Resposta cortada: lê-se só até ao último evento completo (e nada será retirado).
    warnings.push('A resposta parece cortada (falta o fim do calendário).');
    const last = raw.toUpperCase().lastIndexOf('END:VEVENT');
    raw = last >= 0
      ? `${raw.slice(0, last)}END:VEVENT\r\nEND:VCALENDAR\r\n`
      : `${raw.replace(/BEGIN:VEVENT[\s\S]*$/i, '').trimEnd()}\r\nEND:VCALENDAR\r\n`;
  }

  let root: IComp;
  try {
    const parsed = ICAL.parse(raw);
    const first = Array.isArray(parsed) && typeof parsed[0] === 'string' ? parsed : (parsed as unknown[])[0];
    root = new ICAL.Component(first as never);
  } catch (e) {
    throw new IcalError(`O conteúdo não é um calendário válido (${e instanceof Error ? e.message.slice(0, 120) : 'ICS'}).`);
  }
  if (root.name !== 'vcalendar') throw new IcalError('O conteúdo não é um calendário (VCALENDAR).');

  ICAL.TimezoneService.reset();
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(tz); } catch { /* fuso ilegível: usa-se o nome IANA, se houver */ }
  }
  const name = cut(text(root, 'x-wr-calname'), 200);

  // Agrupa por UID: evento principal e exceções (RECURRENCE-ID).
  const masters = new Map<string, IComp>();
  const exceptions = new Map<string, Map<string, IComp>>();
  for (const c of root.getAllSubcomponents('vevent')) {
    const uid = text(c, 'uid');
    const dtstart = c.getFirstPropertyValue('dtstart');
    if (!uid || !dtstart) {
      warnings.push(`Evento sem ${uid ? 'data de início' : 'UID'} ignorado${text(c, 'summary') ? ` («${text(c, 'summary')}»)` : ''}.`);
      complete = false;
      continue;
    }
    const recur = c.getFirstPropertyValue('recurrence-id') as ITime | null;
    if (recur) {
      const m = exceptions.get(uid) ?? new Map<string, IComp>();
      m.set(ridOf(recur, tzParamOf(c, 'recurrence-id')), c);
      exceptions.set(uid, m);
    } else if (masters.has(uid)) {
      warnings.push(`UID repetido ignorado («${text(c, 'summary') ?? uid}»).`);
    } else {
      masters.set(uid, c);
    }
  }

  const out = new Map<string, IcalItem>();
  const add = (it: IcalItem) => {
    if (!overlaps(it, w)) return;
    const k = `${it.uid}|${it.rid}`;
    if (out.has(k)) return;
    if (out.size >= maxItems) {
      if (complete) warnings.push(`Mais de ${maxItems} ocorrências: as restantes não foram lidas.`);
      complete = false;
      return;
    }
    out.set(k, it);
  };
  const fromComp = (uid: string, rid: string, c: IComp, fallback?: Base, forceCancel = false): IcalItem => {
    const start = c.getFirstPropertyValue('dtstart') as ITime;
    const b = baseOf(c, fallback);
    return { uid, rid, ...b, cancelled: b.cancelled || forceCancel, ...span(start, endOf(c, start), tzParamOf(c, 'dtstart'), tzParamOf(c, 'dtend')) };
  };

  for (const [uid, m] of masters) {
    try {
      const ex = exceptions.get(uid) ?? new Map<string, IComp>();
      const base = baseOf(m);
      const ev = new ICAL.Event(m);
      if (!ev.isRecurring()) {
        add(fromComp(uid, '', m));
        continue;
      }
      const tz = tzParamOf(m, 'dtstart');
      const start = m.getFirstPropertyValue('dtstart') as ITime;
      const end = endOf(m, start);
      const dur = end ? end.subtractDate(start) : null;
      const used = new Set<string>();
      const it = ev.iterator();
      let n = 0;
      let t: ITime | null;
      const stop = addDaysIso(w.to, 1);
      while ((t = it.next())) {
        if (++n > maxPerSeries) {
          warnings.push(`Repetição demasiado longa («${base.title}»): não foi lida toda.`);
          complete = false;
          break;
        }
        if (dateOf(t) > stop) break;
        const r = ridOf(t, tz);
        const exc = ex.get(r);
        if (exc) {
          used.add(r);
          add(fromComp(uid, r, exc, base, base.cancelled));
          continue;
        }
        let e: ITime | null = null;
        if (dur) {
          e = t.clone();
          e.addDuration(dur);
        }
        add({ uid, rid: r, ...base, ...span(t, e, tz, tz) });
      }
      // Ocorrências apagadas no iCloud (EXDATE): canceladas, se já tinham sido importadas.
      for (const p of m.getAllProperties('exdate')) {
        const ptz = p.getParameter('tzid');
        for (const v of p.getValues() as ITime[]) {
          const r = ridOf(v, typeof ptz === 'string' ? ptz : tz);
          if (ex.has(r) || used.has(r)) continue;
          let e: ITime | null = null;
          if (dur) {
            e = v.clone();
            e.addDuration(dur);
          }
          add({ uid, rid: r, ...base, cancelled: true, ...span(v, e, typeof ptz === 'string' ? ptz : tz, tz) });
        }
      }
      // Exceções fora da regra (por exemplo movidas para muito longe): entram tal como estão.
      for (const [r, c] of ex) if (!used.has(r)) add(fromComp(uid, r, c, base, base.cancelled));
    } catch (e) {
      warnings.push(`Evento ilegível ignorado («${text(m, 'summary') ?? uid}»: ${e instanceof Error ? e.message.slice(0, 80) : 'erro'}).`);
      complete = false;
    }
  }
  // Exceções sem evento principal.
  for (const [uid, ex] of exceptions) {
    if (masters.has(uid)) continue;
    for (const [r, c] of ex) add(fromComp(uid, r, c));
  }

  const items = [...out.values()].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return { name, complete, window_from: w.from, window_to: w.to, items, warnings };
}

const sortKey = (i: IcalItem) => (i.all_day ? `${i.start_date}T00:00:00.000Z` : i.starts_at!);

/** Pré-visualização: nome, número de atividades, intervalo de datas e as próximas. */
export function summarize(feed: IcalFeed, now = new Date()): IcalSummary {
  const active = feed.items.filter((i) => !i.cancelled);
  const today = lisbonDay(now.getTime());
  const ranges = active.map(days);
  return {
    name: feed.name,
    events: active.length,
    cancelled: feed.items.length - active.length,
    first: ranges.length ? ranges.reduce((a, r) => (r.from < a ? r.from : a), ranges[0].from) : null,
    last: ranges.length ? ranges.reduce((a, r) => (r.to > a ? r.to : a), ranges[0].to) : null,
    complete: feed.complete,
    warnings: feed.warnings.slice(0, 5),
    sample: active.filter((i) => days(i).to >= today).slice(0, 5).map((i) => ({
      title: i.title, day: days(i).from, all_day: i.all_day, starts_at: i.starts_at,
    })),
  };
}
