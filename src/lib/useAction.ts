import { useCallback, useState } from 'react';
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

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, successMessage?: string): Promise<{ ok: boolean; value?: T }> => {
      setBusy(true);
      setError(null);
      setSuccess(null);
      try {
        const result = await fn();
        await qc.invalidateQueries();
        if (successMessage) setSuccess(successMessage);
        return { ok: true, value: result };
      } catch (e) {
        setError(e instanceof Error ? errorMessage(e) : errorMessage(e));
        return { ok: false };
      } finally {
        setBusy(false);
      }
    },
    [qc],
  );

  return { run, busy, error, success, clear: () => { setError(null); setSuccess(null); } };
}
