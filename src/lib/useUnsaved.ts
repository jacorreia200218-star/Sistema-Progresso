// Aviso de alterações por guardar: ao fechar ou recarregar a página (aviso do navegador) e
// ao carregar em «Cancelar» num formulário com alterações (pergunta antes de as perder).
import { useEffect } from 'react';

export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}

/** true se se pode sair: sem alterações, ou a pessoa confirmou que as quer perder. */
export const confirmDiscard = (dirty: boolean) => !dirty || window.confirm('Há alterações por guardar. Sair sem guardar?');
