// Porta de cada módulo: sem acesso, mostra só a apresentação «Em desenvolvimento»
// (sem dados nem ações); com acesso, mostra o módulo e, no espaço de teste, a
// etiqueta discreta «Em teste» junto ao título de cada página. O servidor verifica o acesso em cada operação.
import { createContext, useContext, type ReactNode } from 'react';
import { ErrorBox, Loading, PageTagContext, TestTag } from '../components/ui';
import { FUTURE_AREAS } from '../lib/futuras';
import { FutureAreaView } from '../pages/FutureArea';
import { useModule, type ModuleKey } from './common';

type Ctx = { module: ModuleKey; space: 'teste' | 'real'; isTest: boolean; can: (permission: string, dirigenteOk?: boolean) => boolean };
const ModuleCtx = createContext<Ctx | null>(null);

export function useModuleCtx() {
  const c = useContext(ModuleCtx);
  if (!c) throw new Error('Fora de um módulo.');
  return c;
}

export function ModuleShell({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const m = useModule(module);
  const area = FUTURE_AREAS.find((a) => a.key === module)!;
  if (m.loading) return <Loading />;
  if (m.error) return <ErrorBox error={m.error} />;
  if (!m.space) return <FutureAreaView area={area} />;
  return (
    <ModuleCtx.Provider value={{ module, space: m.space, isTest: m.isTest, can: m.can }}>
      <PageTagContext.Provider value={m.isTest ? <TestTag /> : null}>
        <div className={`module module-${module}${m.isTest ? ' test-space' : ''}`}>
          {children}
        </div>
      </PageTagContext.Provider>
    </ModuleCtx.Provider>
  );
}
