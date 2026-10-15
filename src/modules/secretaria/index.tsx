// Módulo Secretaria: reuniões, atas (com versões e aditamentos), decisões e tarefas.
// O acesso e a visibilidade de cada reunião são verificados no servidor.
import { Route, Routes } from 'react-router-dom';
import { ModuleShell } from '../ModuleShell';
import { MeetingList, MyTasks } from './List';
import { MeetingForm } from './MeetingForm';
import { MeetingPage } from './MeetingPage';
import { MinutePage } from './MinutePage';
import { PrintPage } from './PrintPage';
import './secretaria.css';

export default function Module() {
  return (
    <ModuleShell module="secretaria">
      <Routes>
        <Route index element={<MeetingList />} />
        <Route path="tarefas" element={<MyTasks />} />
        <Route path="nova" element={<MeetingForm />} />
        <Route path="reunioes/:id" element={<MeetingPage />} />
        <Route path="reunioes/:id/editar" element={<MeetingForm />} />
        <Route path="atas/:id" element={<MinutePage />} />
        <Route path="atas/:id/imprimir" element={<PrintPage />} />
        <Route path="*" element={<MeetingList />} />
      </Routes>
    </ModuleShell>
  );
}
