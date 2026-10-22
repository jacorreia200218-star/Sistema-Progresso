// Cabeçalho do Acompanhamento (dirigentes): um só sítio para ver a secção, os pioneiros,
// o caminho, os pedidos e as etapas. «Pioneiros» e «Caminho» mantêm os seus endereços.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useActiveSection } from '../lib/session';
import { fetchPendingCounts } from '../lib/api';
import { gridHref } from './meu/ConsultHeader';
import { PageTitle } from './ui';

export type LeadersTab = 'seccao' | 'pioneiros' | 'caminho' | 'pedidos' | 'etapas';

export function LeadersHeader({ current }: { current: LeadersTab }) {
  const { membership } = useActiveSection();
  const counts = useQuery({ queryKey: ['pending-counts', membership.section_id], queryFn: () => fetchPendingCounts(membership.section_id) });
  const c = counts.data ?? {};
  const pending: Partial<Record<LeadersTab, number>> = { pedidos: (c.negociacao ?? 0) + (c.trilhos ?? 0) + (c.anterior ?? 0), etapas: c.etapas ?? 0 };
  const tabs: [LeadersTab, string, string][] = [
    ['seccao', 'Secção', '/acompanhamento/seccao'],
    ['pioneiros', 'Pioneiros', current === 'pioneiros' ? '/meu-progresso' : gridHref()],
    ['caminho', 'Caminho', '/caminho'],
    ['pedidos', 'Pedidos', '/acompanhamento/pedidos'],
    ['etapas', 'Etapas', '/acompanhamento/etapas'],
  ];
  return (
    <>
      <PageTitle title="Acompanhamento" />
      <nav className="tabs" aria-label="Secções do acompanhamento">
        {tabs.map(([k, label, to]) => (
          <Link key={k} to={to} className="tab" aria-current={current === k ? 'page' : undefined}>
            {label}
            {!!pending[k] && <span className="count" aria-label={`${pending[k]} pendentes`}>{pending[k]}</span>}
          </Link>
        ))}
      </nav>
    </>
  );
}
