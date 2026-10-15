// Módulo Tesouraria: resumo partilhado, situação de cada membro e, para quem tem a
// permissão «tesouraria.gerir» (dada pela administração), movimentos, quotas, orçamento e contas.
import type { ReactNode } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { ModuleShell } from '../ModuleShell';
import { PageTitle } from '../../components/ui';
import { useCanManage } from './shared';
import { Summary } from './Summary';
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
        <Route index element={<Page tab="resumo"><Summary /></Page>} />
        <Route path="minha" element={<Page tab="minha"><MinePage /></Page>} />
        <Route path="atividades" element={<Page tab="atividades"><ActivitiesPage /></Page>} />
        <Route path="movimentos" element={<Page tab="movimentos" manage><MovementsPage /></Page>} />
        <Route path="movimentos/novo" element={<Manage><NewMovement /></Manage>} />
        <Route path="movimentos/:id" element={<Manage><MovementDetail /></Manage>} />
        <Route path="quotas" element={<Page tab="quotas" manage><QuotasPage /></Page>} />
        <Route path="contas" element={<Page tab="contas" manage><AccountsPage /></Page>} />
        <Route path="*" element={<Page tab="resumo"><Summary /></Page>} />
      </Routes>
    </ModuleShell>
  );
}

const TABS: { key: string; to: string; label: string; manage?: boolean; keepFilters?: boolean }[] = [
  { key: 'resumo', to: '/tesouraria', label: 'Resumo', keepFilters: true },
  { key: 'minha', to: '/tesouraria/minha', label: 'A minha situação' },
  { key: 'atividades', to: '/tesouraria/atividades', label: 'Atividades' },
  { key: 'movimentos', to: '/tesouraria/movimentos', label: 'Movimentos', manage: true, keepFilters: true },
  { key: 'quotas', to: '/tesouraria/quotas', label: 'Quotas', manage: true },
  { key: 'contas', to: '/tesouraria/contas', label: 'Contas e caixas', manage: true },
];

function NoPermission() {
  return (
    <div className="card">
      <p className="prose">
        Esta página é reservada a quem a administração autorizou a gerir a Tesouraria. Podes consultar o resumo, os resultados
        das atividades e a tua própria situação.
      </p>
      <Link to="/tesouraria" className="btn secondary">Ver o resumo</Link>
    </div>
  );
}

function Manage({ children }: { children: ReactNode }) {
  return useCanManage() ? <>{children}</> : <><PageTitle title="Tesouraria" /><NoPermission /></>;
}

function Page({ tab, manage, children }: { tab: string; manage?: boolean; children: ReactNode }) {
  const canManage = useCanManage();
  const { search } = useLocation();
  // Os filtros (período, categoria, atividade) acompanham a navegação entre o resumo e os movimentos.
  const keep = new URLSearchParams(search);
  keep.delete('estado');
  const kept = keep.toString();
  return (
    <div className="fin-page">
      <PageTitle title="Tesouraria" subtitle={canManage ? 'Receitas, despesas, quotas e orçamento da secção.' : 'Resumo da secção e a tua situação.'} />
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
