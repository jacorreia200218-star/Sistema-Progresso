import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from './errors';

/**
 * Executa uma ação no servidor. A mensagem de sucesso só aparece depois de o
 * servidor confirmar; em caso de falha (incluindo rede) mostra o erro e nada
 * é dado como guardado.
 */
export function useAction() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Um toque duplo (ou dois cliques rápidos) não envia a mesma ação duas vezes.
  const inFlight = useRef(false);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, successMessage?: string): Promise<{ ok: boolean; value?: T }> => {
      if (inFlight.current) return { ok: false };
      inFlight.current = true;
      setBusy(true);
      setError(null);
      setSuccess(null);
      try {
        const result = await fn();
        // Confirmado pelo servidor: mostra logo o sucesso e liberta o botão;
        // os dados do ecrã atualizam-se a seguir, sem prender a pessoa à espera.
        if (successMessage) setSuccess(successMessage);
        setBusy(false);
        inFlight.current = false;
        await qc.invalidateQueries();
        return { ok: true, value: result };
      } catch (e) {
        setError(e instanceof Error ? errorMessage(e) : errorMessage(e));
        return { ok: false };
      } finally {
        setBusy(false);
        inFlight.current = false;
      }
    },
    [qc],
  );

  return { run, busy, error, success, clear: () => { setError(null); setSuccess(null); } };
}
