// Módulo Presenças: sessões (reuniões e atividades), registo de presenças e assiduidade.
// O acesso, as permissões e a visibilidade das justificações são verificados no servidor.
import { Route, Routes } from 'react-router-dom';
import { ModuleShell } from '../ModuleShell';
import { Home } from './Home';
import { MemberPage } from './MemberPage';
import { SessionForm } from './SessionForm';
import { SessionPage } from './SessionPage';
import './presencas.css';

export default function Presencas() {
  return (
    <ModuleShell module="presencas">
      <Routes>
        <Route index element={<Home />} />
        <Route path="nova" element={<SessionForm />} />
        <Route path="sessoes/:id" element={<SessionPage />} />
        <Route path="sessoes/:id/editar" element={<SessionForm />} />
        <Route path="pessoas/:id" element={<MemberPage />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </ModuleShell>
  );
}
