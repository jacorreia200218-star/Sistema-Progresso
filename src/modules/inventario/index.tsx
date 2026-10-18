// Módulo Inventário: três entradas (Material, Empréstimos com as reservas, A comprar). Os alertas
// abrem-se pelos indicadores do resumo e os tipos ficam em «Configurar». O acesso e as
// permissões são verificados no servidor.
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { ModuleShell } from '../ModuleShell';
import { Lista } from './Lista';
import { Artigo } from './Artigo';
import { ArtigoForm } from './ArtigoForm';
import { Emprestimos } from './Emprestimos';
import { Categorias } from './Categorias';
import { Comprar } from './Comprar';
import './inventario.css';

/** Endereços antigos de «Reservas» passam a abrir as reservas dentro de Empréstimos. */
function OldReservas() {
  const [params] = useSearchParams();
  return <Navigate to={`/inventario/emprestimos?ver=reservas${params.get('ver') === 'terminadas' ? '&reservas=terminadas' : ''}`} replace />;
}

export default function Module() {
  return (
    <ModuleShell module="inventario">
      <Routes>
        <Route index element={<Lista />} />
        <Route path="novo" element={<ArtigoForm />} />
        <Route path="artigo/:id" element={<Artigo />} />
        <Route path="artigo/:id/editar" element={<ArtigoForm />} />
        <Route path="emprestimos" element={<Emprestimos />} />
        <Route path="reservas" element={<OldReservas />} />
        <Route path="comprar" element={<Comprar />} />
        <Route path="alertas" element={<Navigate to="/inventario" replace />} />
        <Route path="categorias" element={<Categorias />} />
        <Route path="*" element={<Navigate to="/inventario" replace />} />
      </Routes>
    </ModuleShell>
  );
}
