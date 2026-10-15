// Exportação iCalendar (RFC 5545), gerada no próprio dispositivo.
// • Horas em UTC («…Z»): correto em qualquer calendário, incluindo a mudança de hora.
// • Dias inteiros como DATE, com DTEND exclusivo (dia seguinte ao último dia).
import { addDays, type CalEvent } from './cal';

type IcsEvent = Pick<CalEvent, 'id' | 'title' | 'description' | 'location' | 'all_day' | 'starts_at' | 'ends_at' | 'start_date' | 'end_date' | 'status' | 'updated_at'>;

const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const date = (day: string) => day.replace(/-/g, '');

export const escapeText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

/** Dobra linhas a 75 octetos (UTF-8), sem partir caracteres. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // as continuações começam com um espaço
    if (bytes + n > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function buildIcs(events: IcsEvent[], calName = 'Calendário escutista', now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pioneiros//Calendario escutista//PT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calName)}`, 'X-WR-TIMEZONE:Europe/Lisbon',
  ];
  const stamp = utc(now.toISOString());
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@pioneiros`, `DTSTAMP:${stamp}`);
    if (e.all_day) {
      lines.push(`DTSTART;VALUE=DATE:${date(e.start_date!)}`, `DTEND;VALUE=DATE:${date(addDays(e.end_date ?? e.start_date!, 1))}`);
    } else {
      lines.push(`DTSTART:${utc(e.starts_at!)}`, `DTEND:${utc(e.ends_at ?? e.starts_at!)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.status === 'cancelado' ? `Cancelada: ${e.title}` : e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    lines.push(`STATUS:${e.status === 'cancelado' ? 'CANCELLED' : 'CONFIRMED'}`);
    if (e.updated_at) lines.push(`LAST-MODIFIED:${utc(e.updated_at)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Nome de ficheiro seguro a partir do título. */
export const icsFileName = (title: string) =>
  `${title.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'atividade'}.ics`;
