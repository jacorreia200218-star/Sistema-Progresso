// Módulo Tesouraria: painel financeiro e movimentos partilhados (sem dados pessoais), resultado
// das atividades e situação de cada membro; para quem tem a permissão «tesouraria.gerir» (dada pela
// administração): registar receitas e despesas, quotas, orçamento, contas e saldo inicial.
import type { ReactNode } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { ModuleShell } from '../ModuleShell';
import { PageTitle } from '../../components/ui';
import { useCanManage } from './shared';
import { Dashboard } from './Dashboard';
import { MovementsPage, MovementDetail, NewMovement } from './Movements';
import { QuotasPage } from './Quotas';
import { ActivitiesPage } from './Activities';
import { MinePage } from './Mine';
import { AccountsPage } from './Accounts';
import './tesouraria.css';

export default function Module() {
  return (
    <ModuleShell module="tesouraria">
      <Routes>
        <Route index element={<Page tab="painel"><Dashboard /></Page>} />
        <Route path="minha" element={<Page tab="minha"><MinePage /></Page>} />
        <Route path="atividades" element={<Page tab="atividades"><ActivitiesPage /></Page>} />
        <Route path="movimentos" element={<Page tab="movimentos"><MovementsPage /></Page>} />
        <Route path="movimentos/novo" element={<Manage><NewMovement /></Manage>} />
        <Route path="movimentos/:id" element={<Manage><MovementDetail /></Manage>} />
        <Route path="quotas" element={<Page tab="quotas" manage><QuotasPage /></Page>} />
        <Route path="contas" element={<Page tab="contas" manage><AccountsPage /></Page>} />
        <Route path="*" element={<Page tab="painel"><Dashboard /></Page>} />
      </Routes>
    </ModuleShell>
  );
}

const TABS: { key: string; to: string; label: string; manage?: boolean; keepFilters?: boolean }[] = [
  { key: 'painel', to: '/tesouraria', label: 'Painel', keepFilters: true },
  { key: 'movimentos', to: '/tesouraria/movimentos', label: 'Movimentos', keepFilters: true },
  { key: 'atividades', to: '/tesouraria/atividades', label: 'Atividades' },
  { key: 'minha', to: '/tesouraria/minha', label: 'A minha situação' },
  { key: 'quotas', to: '/tesouraria/quotas', label: 'Quotas', manage: true },
  { key: 'contas', to: '/tesouraria/contas', label: 'Contas e saldo inicial', manage: true },
];

function NoPermission() {
  return (
    <div className="card">
      <p className="prose">
        Esta página é reservada a quem a administração autorizou a gerir a Tesouraria. Podes consultar o painel, os movimentos
        partilhados, os resultados das atividades e a tua própria situação.
      </p>
      <Link to="/tesouraria" className="btn secondary">Ver o painel</Link>
    </div>
  );
}

function Manage({ children }: { children: ReactNode }) {
  return useCanManage() ? <>{children}</> : <><PageTitle title="Tesouraria" /><NoPermission /></>;
}

function Page({ tab, manage, children }: { tab: string; manage?: boolean; children: ReactNode }) {
  const canManage = useCanManage();
  const { search } = useLocation();
  // Os filtros (ano escutista, mês, atividade) acompanham a navegação entre o painel e os movimentos.
  const keep = new URLSearchParams(search);
  for (const k of ['estado', 'categoria', 'q']) keep.delete(k);
  const kept = keep.toString();
  return (
    <div className="fin-page">
      <PageTitle title="Tesouraria" subtitle={canManage ? 'Receitas, despesas, saldo, quotas e orçamento da secção.' : 'Painel financeiro da secção e a tua situação.'} />
      <nav className="tabs" aria-label="Secções da tesouraria">
        {TABS.filter((t) => !t.manage || canManage).map((t) => (
          <Link key={t.key} to={t.keepFilters && kept ? `${t.to}?${kept}` : t.to} className="tab" aria-current={tab === t.key ? 'page' : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      {manage && !canManage ? <NoPermission /> : children}
    </div>
  );
}
