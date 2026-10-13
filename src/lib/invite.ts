// O código de convite viaja no fragmento do link (#…), que nunca é enviado ao
// servidor nem fica em registos de acesso. Guarda-se localmente até ser usado.
const KEY = 'pioneiros.convite';

export function storeInviteCode(code: string) {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* sem armazenamento: o utilizador pode colar o código manualmente */
  }
}
export function readInviteCode(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}
export function clearInviteCode() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignorar */
  }
}
/** Código curto normalizado: sem espaços nem hífen, em maiúsculas (os longos antigos ficam como estão). */
export function normalizeInviteCode(code: string): string {
  const compact = code.replace(/[\s-]/g, '').toUpperCase();
  return compact.length === 8 ? compact : code.trim();
}
/** «AB7K9M2P» → «AB7K-9M2P». */
export function formatInviteCode(code: string): string {
  const c = normalizeInviteCode(code);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}
/** Ligação curta; o código vai no fragmento (#), que não é enviado ao servidor. */
export function inviteLink(code: string) {
  return `${window.location.origin}/c#${formatInviteCode(code)}`;
}
