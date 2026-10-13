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
export function inviteLink(code: string) {
  return `${window.location.origin}/convite#${code}`;
}
