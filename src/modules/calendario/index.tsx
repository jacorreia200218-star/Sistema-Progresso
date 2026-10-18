// Módulo Calendário escutista: calendário anual (civil ou escutista) com feriados e dias
// livres, próximas atividades, detalhe com respostas e pendências, formulário e configuração
// (só para quem gere). O servidor verifica tudo.
import { Route, Routes } from 'react-router-dom';
import { ModuleShell } from '../ModuleShell';
import { Overview } from './Overview';
import { EventDetail } from './EventDetail';
import { EventForm } from './EventForm';
import { Config } from './Config';
import { PendingPage } from './Pending';
import './calendario.css';

export default function Module() {
  return (
    <ModuleShell module="calendario">
      <Routes>
        <Route index element={<Overview />} />
        <Route path="nova" element={<EventForm />} />
        <Route path="configurar" element={<Config />} />
        <Route path="pendentes" element={<PendingPage />} />
        <Route path="evento/:id" element={<EventDetail />} />
        <Route path="evento/:id/editar" element={<EventForm />} />
        <Route path="*" element={<Overview />} />
      </Routes>
    </ModuleShell>
  );
}
