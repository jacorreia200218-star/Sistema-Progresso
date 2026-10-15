// Módulo Calendário escutista: próximas atividades, vista mensal, detalhe com respostas
// e pendências, e formulário (só para quem gere). O servidor verifica tudo.
import { Route, Routes } from 'react-router-dom';
import { ModuleShell } from '../ModuleShell';
import { Overview } from './Overview';
import { EventDetail } from './EventDetail';
import { EventForm } from './EventForm';
import './calendario.css';

export default function Module() {
  return (
    <ModuleShell module="calendario">
      <Routes>
        <Route index element={<Overview />} />
        <Route path="nova" element={<EventForm />} />
        <Route path="evento/:id" element={<EventDetail />} />
        <Route path="evento/:id/editar" element={<EventForm />} />
        <Route path="*" element={<Overview />} />
      </Routes>
    </ModuleShell>
  );
}
