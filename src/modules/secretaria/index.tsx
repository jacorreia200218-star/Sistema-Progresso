// Módulo «Atas e tarefas» (chave interna 'secretaria'): atas ligadas a eventos do calendário,
// tarefas com responsável e «As minhas tarefas». Rota: /atas-e-tarefas/* (os antigos
// /reunioes-e-tarefas/* e /secretaria/* redirecionam). O acesso e a visibilidade são verificados no servidor.
import { Navigate, Route, Routes } from 'react-router-dom';
import { ModuleShell } from '../ModuleShell';
import { AtaNew } from './AtaNew';
import { AtaPage } from './AtaPage';
import { AtaList } from './List';
import { Mine, TaskList } from './Tasks';
import { BASE } from './api';
import './secretaria.css';

export default function Module() {
  return (
    <ModuleShell module="secretaria">
      <Routes>
        <Route index element={<AtaList />} />
        <Route path="nova" element={<AtaNew />} />
        <Route path="atas/:id" element={<AtaPage />} />
        <Route path="tarefas/*" element={<TaskList />} />
        <Route path="minhas" element={<Mine />} />
        <Route path="o-que-me-diz-respeito" element={<Navigate to={`${BASE}/minhas`} replace />} />
        <Route path="*" element={<AtaList />} />
      </Routes>
    </ModuleShell>
  );
}
