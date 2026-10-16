// Módulo «Reuniões e tarefas» (chave interna 'secretaria'): atas e reuniões, sumários
// estruturados, quadro de tarefas e «O que me diz respeito». Rota: /reunioes-e-tarefas/*
// (o antigo /secretaria/* redireciona). O acesso e a visibilidade são verificados no servidor.
import { Route, Routes } from 'react-router-dom';
import { ModuleShell } from '../ModuleShell';
import { Board, TaskPage } from './Board';
import { MeetingList } from './List';
import { MeetingForm } from './MeetingForm';
import { MeetingPage } from './MeetingPage';
import { Mine } from './Mine';
import { MinutePage } from './MinutePage';
import { PrintPage } from './PrintPage';
import { SummaryPage } from './Summary';
import './secretaria.css';

export default function Module() {
  return (
    <ModuleShell module="secretaria">
      <Routes>
        <Route index element={<MeetingList />} />
        <Route path="tarefas" element={<Board />} />
        <Route path="tarefas/:id" element={<TaskPage />} />
        <Route path="o-que-me-diz-respeito" element={<Mine />} />
        <Route path="nova" element={<MeetingForm />} />
        <Route path="reunioes/:id" element={<MeetingPage />} />
        <Route path="reunioes/:id/editar" element={<MeetingForm />} />
        <Route path="reunioes/:id/sumario" element={<SummaryPage />} />
        <Route path="atas/:id" element={<MinutePage />} />
        <Route path="atas/:id/imprimir" element={<PrintPage />} />
        <Route path="*" element={<MeetingList />} />
      </Routes>
    </ModuleShell>
  );
}
