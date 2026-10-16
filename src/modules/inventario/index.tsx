// Módulo Inventário: resumo, material, empréstimos (com pedidos), reservas ligadas ao
// calendário, lista «A comprar» (com ligação à Tesouraria), alertas e histórico. O acesso e as permissões são verificados no servidor.
import { Navigate, Route, Routes } from 'react-router-dom';
import { ModuleShell } from '../ModuleShell';
import { Lista } from './Lista';
import { Artigo } from './Artigo';
import { ArtigoForm } from './ArtigoForm';
import { Emprestimos } from './Emprestimos';
import { Reservas } from './Reservas';
import { Alertas } from './Alertas';
import { Categorias } from './Categorias';
import { Comprar } from './Comprar';
import './inventario.css';

export default function Module() {
  return (
    <ModuleShell module="inventario">
      <Routes>
        <Route index element={<Lista />} />
        <Route path="novo" element={<ArtigoForm />} />
        <Route path="artigo/:id" element={<Artigo />} />
        <Route path="artigo/:id/editar" element={<ArtigoForm />} />
        <Route path="emprestimos" element={<Emprestimos />} />
        <Route path="reservas" element={<Reservas />} />
        <Route path="comprar" element={<Comprar />} />
        <Route path="alertas" element={<Alertas />} />
        <Route path="categorias" element={<Categorias />} />
        <Route path="*" element={<Navigate to="/inventario" replace />} />
      </Routes>
    </ModuleShell>
  );
}
