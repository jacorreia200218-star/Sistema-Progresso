// Módulo Equipas e cargos: equipas (identidade, membros, ano escutista), cargos
// configuráveis com responsabilidades, nomeações com histórico e mudanças de equipa.
// O acesso e todas as regras são verificados no servidor (funções eq_*).
import { Route, Routes } from 'react-router-dom';
import { ModuleShell } from '../ModuleShell';
import { Empty, PageTitle } from '../../components/ui';
import Home from './Home';
import TeamPage from './TeamPage';
import PersonPage from './PersonPage';
import './equipas.css';

export default function Module() {
  return (
    <ModuleShell module="equipas">
      <Routes>
        <Route index element={<Home />} />
        <Route path="equipa/:id" element={<TeamPage />} />
        <Route path="pessoa/:id" element={<PersonPage />} />
        <Route path="*" element={<><PageTitle title="Equipas e cargos" back="/equipas-e-cargos" /><Empty title="Página não encontrada." /></>} />
      </Routes>
    </ModuleShell>
  );
}
