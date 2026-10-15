// Porta de cada módulo: sem acesso, mostra só a apresentação «Em desenvolvimento»
// (sem dados nem ações); com acesso, mostra o módulo e, no espaço de teste, a
// indicação «Ambiente de teste». O servidor verifica o acesso em cada operação.
import { createContext, useContext, type ReactNode } from 'react';
import { FlaskConical } from 'lucide-react';
import { ErrorBox, Loading } from '../components/ui';
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
      <div className={`module module-${module}${m.isTest ? ' test-space' : ''}`}>
        {m.isTest && (
          <p className="test-banner" role="note">
            <FlaskConical size={16} aria-hidden="true" />
            <span><strong>Ambiente de teste.</strong> Os dados deste espaço não entram nos registos reais.</span>
          </p>
        )}
        {children}
      </div>
    </ModuleCtx.Provider>
  );
}
