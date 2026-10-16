// Datas apresentadas ao utilizador: sempre DD/MM/AAAA e, com hora, «DD/MM/AAAA · HH:MM».
// Dois tipos de valor, nunca misturados:
// - datas sem hora («2026-10-10»): formatadas a partir do texto, sem passar por Date, para
//   não mudarem de dia com o fuso horário;
// - instantes («2026-10-10T17:30:00Z»): convertidos para a hora local antes de formatar.
// Todos os ecrãs, notificações e exportações usam estas funções (ou as de modules/common,
// que fazem o mesmo em hora de Lisboa).

const pad = (n: number) => String(n).padStart(2, '0');
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Separador entre a data e a hora. */
export const DATE_TIME_SEP = ' · ';

/** «2026-10-10» → «10/10/2026». Um instante é convertido para o dia local. */
export function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  const m = DATE_ONLY.exec(d);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Instante → «HH:MM» em hora local. */
export function formatTime(d: string | null | undefined): string {
  if (!d || DATE_ONLY.test(d)) return '';
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? '' : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Instante → «DD/MM/AAAA · HH:MM»; uma data sem hora fica só «DD/MM/AAAA». */
export function formatDateTime(d: string | null | undefined): string {
  if (!d) return '—';
  if (DATE_ONLY.test(d)) return formatDate(d);
  const t = formatTime(d);
  return t ? `${formatDate(d)}${DATE_TIME_SEP}${t}` : '—';
}

/** Dia de hoje (AAAA-MM-DD) no fuso do dispositivo. */
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
 * Aceita «16/10/2026», «16-10-2026», «16.10.2026», «16102026», «1/2/2026» e «2026-10-16».
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

/** Ajuda a escrever: «16102026» → «16/10/2026» à medida que se escreve (só com dígitos). */
export function maskDateText(text: string): string {
  if (!/^[\d/]*$/.test(text)) return text;
  const parts = text.split('/');
  // Quem escreve as barras à mão («1/2/2026») fica com o que escreveu.
  if (parts.length > 3 || parts.slice(0, -1).some((p) => p.length !== 2)) return text.slice(0, 10);
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}
