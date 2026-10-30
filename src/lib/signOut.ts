// Sair da conta: o dispositivo deixa de receber as notificações desta pessoa e a cache
// local dos dados (React Query) é limpa, para quem entrar a seguir no mesmo dispositivo
// nunca ver dados da conta anterior. A cache também é limpa quando a sessão expira
// (ver main.tsx).
import type { QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { forgetPushDevice } from './push';

export async function signOut(queryClient: QueryClient) {
  try {
    await forgetPushDevice();
  } catch {
    // Sem rede ou sem notificações: sai na mesma.
  }
  await supabase.auth.signOut();
  queryClient.clear();
}
