// Datas apresentadas ao utilizador: sempre DD-MM-AAAA e, com hora, «DD-MM-AAAA · HH:MM»
// (24 horas). Dois tipos de valor, nunca misturados:
// - datas sem hora («2026-10-10»): formatadas a partir do texto, sem passar por Date, para
//   não mudarem de dia com o fuso horário;
// - instantes («2026-10-10T17:30:00Z»): convertidos para a hora de Lisboa (Europe/Lisbon,
//   com as mudanças de hora) antes de formatar, seja qual for o fuso do dispositivo.
// Todos os ecrãs, notificações e exportações usam estas funções (ou as de modules/common,
// que fazem o mesmo). Os valores guardados e os campos nativos continuam em «AAAA-MM-DD».

const pad = (n: number) => String(n).padStart(2, '0');
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Separador entre a data e a hora. */
export const DATE_TIME_SEP = ' · ';
/** Separador dentro da data (DD-MM-AAAA). */
export const DATE_SEP = '-';

const LISBON = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
/** Instante → partes (ano, mês, dia, hora, minuto) em hora de Lisboa; null se inválido. */
function lisbonParts(d: string): Record<string, string> | null {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return Object.fromEntries(LISBON.formatToParts(date).map((p) => [p.type, p.value]));
}

/** «2026-10-10» → «10-10-2026». Um instante é convertido para o dia em Lisboa. */
export function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  const m = DATE_ONLY.exec(d);
  if (m) return [m[3], m[2], m[1]].join(DATE_SEP);
  const p = lisbonParts(d);
  return p ? [p.day, p.month, p.year].join(DATE_SEP) : '—';
}

/** Instante → «HH:MM» em hora de Lisboa. */
export function formatTime(d: string | null | undefined): string {
  if (!d || DATE_ONLY.test(d)) return '';
  const p = lisbonParts(d);
  return p ? `${p.hour}:${p.minute}` : '';
}

/** Instante → «DD-MM-AAAA · HH:MM»; uma data sem hora fica só «DD-MM-AAAA». */
export function formatDateTime(d: string | null | undefined): string {
  if (!d) return '—';
  if (DATE_ONLY.test(d)) return formatDate(d);
  const t = formatTime(d);
  return t ? `${formatDate(d)}${DATE_TIME_SEP}${t}` : '—';
}

/** Dia de hoje (AAAA-MM-DD) em Lisboa. */
export const todayIso = () => {
  const p = lisbonParts(new Date().toISOString())!;
  return `${p.year}-${p.month}-${p.day}`;
};

// ---------------------------------------------------------------------------
// Leitura do que se escreve num campo de data
// ---------------------------------------------------------------------------
const validDay = (y: number, m: number, d: number) => {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * Texto escrito → «AAAA-MM-DD», ou null se incompleto ou inválido.
 * Aceita «16-10-2026», «16/10/2026», «16.10.2026», «16102026», «1-2-2026» e «2026-10-16».
 */
export function parseDateText(text: string): string | null {
  const t = text.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/.exec(t))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{2})(\d{2})(\d{4})$/.exec(t))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return null;
  return validDay(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** Texto escrito → «HH:MM», ou null. Aceita «9:00», «09h00», «0900», «9h» e «9». */
export function parseTimeText(text: string): string | null {
  const t = text.trim().toLowerCase();
  const r = /^(\d{1,2})(?:[:h.\s]?(\d{2}))?h?$/.exec(t);
  if (!r) return null;
  const h = Number(r[1]);
  const mi = Number(r[2] ?? 0);
  return h < 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : null;
}

/** Ajuda a escrever: «16102026» → «16-10-2026» à medida que se escreve (só com dígitos). */
export function maskDateText(text: string): string {
  if (!/^[\d/-]*$/.test(text)) return text;
  const parts = text.split(/[/-]/);
  // Quem escreve os separadores à mão («1-2-2026», «2026-10-16») fica com o que escreveu.
  if (parts.length > 3 || parts.slice(0, -1).some((p) => p.length !== 2)) return text.slice(0, 10);
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}${DATE_SEP}${digits.slice(2)}`;
  return `${digits.slice(0, 2)}${DATE_SEP}${digits.slice(2, 4)}${DATE_SEP}${digits.slice(4)}`;
}
