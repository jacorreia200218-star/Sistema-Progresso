// Converte erros do Supabase/rede em mensagens claras em português.
// Mensagens vindas das funções do servidor já estão em português.
export function errorMessage(e: unknown): string {
  const anyE = e as { message?: string; code?: string; status?: number; name?: string } | null;
  const msg = anyE?.message ?? (typeof e === 'string' ? e : '');
  if (!msg && !anyE) return 'Ocorreu um erro inesperado.';
  if (/Failed to fetch|NetworkError|Load failed|fetch failed|network/i.test(msg) || anyE?.name === 'AuthRetryableFetchError') {
    return 'Sem ligação ao servidor. Verifica a internet e tenta de novo — nada foi guardado.';
  }
  if (/Invalid login credentials/i.test(msg)) return 'Email ou palavra-passe incorretos.';
  if (/Email not confirmed/i.test(msg)) return 'Ainda não confirmaste o teu email. Procura a mensagem de confirmação na tua caixa de correio.';
  if (/User already registered/i.test(msg)) return 'Já existe uma conta com este email. Entra ou recupera a palavra-passe.';
  if (/Password should be at least|weak password/i.test(msg)) return 'A palavra-passe é demasiado fraca. Usa pelo menos 8 caracteres.';
  if (/rate limit|too many/i.test(msg)) return 'Demasiadas tentativas. Aguarda uns minutos e tenta de novo.';
  if (/JWT expired|invalid jwt/i.test(msg)) return 'A tua sessão expirou. Entra de novo.';
  if (/permission denied|row-level security/i.test(msg)) return 'Não tens permissão para esta ação.';
  if (/Payload too large|exceeded the maximum allowed size/i.test(msg)) return 'O ficheiro é demasiado grande.';
  if (/mime type|invalid_mime_type/i.test(msg)) return 'Tipo de ficheiro não permitido. Usa JPG, PNG, WebP ou PDF.';
  // Mensagens das funções do servidor já vêm em português.
  if (/[áéíóúâêôãõçà]/i.test(msg) || /\b(pedido|trilho|etapa|indica|escolhe|equipa|convite|membro|sem)\b/i.test(msg)) return msg;
  return 'Ocorreu um erro. Tenta de novo; se persistir, contacta a administração.';
}
