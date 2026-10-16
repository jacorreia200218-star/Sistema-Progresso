// Módulo Tesouraria: painel financeiro e movimentos partilhados (sem dados pessoais), resultado
// das atividades e situação de cada membro; para quem tem a permissão «tesouraria.gerir» (dada pela
// administração): registar receitas e despesas, quotas, orçamento, contas e saldo inicial.
import type { ReactNode } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { ModuleShell } from '../ModuleShell';
import { PageTitle } from '../../components/ui';
import { useCanManage } from './shared';
import { Dashboard, DashboardActions } from './Dashboard';
import { MovementsActions, MovementsPage, MovementDetail, NewMovement } from './Movements';
import { QuotasPage } from './Quotas';
import { ActivitiesPage } from './Activities';
import { MinePage } from './Mine';
import { AccountsPage } from './Accounts';
import './tesouraria.css';

export default function Module() {
  return (
    <ModuleShell module="tesouraria">
      <Routes>
        <Route index element={<Page tab="painel" actions={<DashboardActions />}><Dashboard /></Page>} />
        <Route path="minha" element={<Page tab="minha" info={INFO.minha}><MinePage /></Page>} />
        <Route path="atividades" element={<Page tab="atividades" info={INFO.atividades}><ActivitiesPage /></Page>} />
        <Route path="movimentos" element={<Page tab="movimentos" actions={<MovementsActions />}><MovementsPage /></Page>} />
        <Route path="movimentos/novo" element={<Manage><NewMovement /></Manage>} />
        <Route path="movimentos/:id" element={<Manage><MovementDetail /></Manage>} />
        <Route path="quotas" element={<Page tab="quotas" manage info={INFO.quotas}><QuotasPage /></Page>} />
        <Route path="contas" element={<Page tab="contas" manage info={INFO.contas}><AccountsPage /></Page>} />
        <Route path="*" element={<Page tab="painel" actions={<DashboardActions />}><Dashboard /></Page>} />
      </Routes>
    </ModuleShell>
  );
}

/** Explicações de cada separador, recolhidas em «Mais informação». */
const INFO: Record<string, ReactNode> = {
  minha: <p>Só tu e quem gere a tesouraria veem esta informação. Pendente: pagamento registado, ainda por confirmar.</p>,
  atividades: (
    <p>
      Para cada atividade, o orçamento (previsto) ao lado do resultado efetivo. Os valores por confirmar (pendentes ou previstos)
      aparecem à parte e não entram no resultado.
    </p>
  ),
  quotas: (
    <p>
      Cada pagamento é registado uma única vez, como movimento de receita do membro; a quota apenas o referencia. Pagar acima do que
      está em falta exige confirmação explícita.
    </p>
  ),
  contas: (
    <>
      <p>
        O saldo inicial é o dinheiro que havia no início da data de referência. O painel calcula
        «Saldo atual = Saldo inicial + Receitas − Despesas», só com movimentos efetivos e não anulados a partir dessa data.
        Os movimentos com data anterior ficam registados, mas não somam outra vez (já estão incluídos no saldo inicial).
      </p>
      <p>Usa um saldo inicial global (todas as contas e caixas) ou um por conta ou caixa — não os dois ao mesmo tempo.</p>
    </>
  ),
};

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

function Page({ tab, manage, actions, info, children }: { tab: string; manage?: boolean; actions?: ReactNode; info?: ReactNode; children: ReactNode }) {
  const canManage = useCanManage();
  const { search } = useLocation();
  // Os filtros (ano escutista, mês, atividade) acompanham a navegação entre o painel e os movimentos.
  const keep = new URLSearchParams(search);
  for (const k of ['estado', 'categoria', 'q']) keep.delete(k);
  const kept = keep.toString();
  return (
    <div className="fin-page">
      <PageTitle title="Tesouraria" actions={manage && !canManage ? undefined : actions} info={manage && !canManage ? undefined : info} />
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
