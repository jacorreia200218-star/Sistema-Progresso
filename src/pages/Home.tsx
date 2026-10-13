import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ClipboardCheck, Compass, Settings, Users } from 'lucide-react';
import { useActiveSection } from '../lib/session';
import { useMembers, useProgress } from '../lib/hooks';
import { fetchSectionChoices, fetchSectionRequests, fetchSectionStageRequests } from '../lib/api';
import { focusPath, nextAction, stageSummary, validatedKeys } from '../lib/progress';
import { ErrorBox, Loading, Meter, PageTitle } from '../components/ui';
import { MeritCard, StagePanel } from '../components/StagePanel';

function MemberHome() {
  const { membership, catalog } = useActiveSection();
  const q = useProgress(membership.id);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const p = q.data;
  const action = nextAction(catalog, p);
  const path = focusPath(p.paths);
  const pending = p.requests.filter((r) => ['submetido', 'em_revisao', 'rascunho', 'devolvido'].includes(r.status));
  return (
    <>
      <div className="card" style={{ borderLeft: '4px solid var(--red)' }}>
        <p className="faint" style={{ marginBottom: 4 }}>Próximo passo</p>
        <h2>{action.title}</h2>
        <p className="muted">{action.detail}</p>
        {action.to && (
          <Link to={action.to} className="btn">
            Continuar <ArrowRight size={18} aria-hidden="true" />
          </Link>
        )}
      </div>
      {path ? (
        <StagePanel summary={stageSummary(path, catalog, p)} catalog={catalog} />
      ) : (
        <div className="card">
          <h2>Etapa do Desprendimento</h2>
          <p className="muted">
            {p.adhesion
              ? 'A tua adesão está registada. A Equipa de Animação vai abrir contigo a etapa do Conhecimento.'
              : 'Estás a viver a adesão à secção. Conhece a tua Equipa, a Lei e a mística dos Pioneiros.'}
          </p>
        </div>
      )}
      <div className="card">
        <Meter value={validatedKeys(p.requests).size} max={catalog.trailById.size} label="Trilhos validados na secção" />
        <div className="btn-row">
          <Link to="/progresso" className="btn secondary">
            <Compass size={18} aria-hidden="true" /> Ver progresso
          </Link>
          <Link to="/pedidos" className="btn secondary">
            Pedidos {pending.length > 0 && <span className="count">{pending.length}</span>}
          </Link>
        </div>
      </div>
      <MeritCard progress={p} catalog={catalog} />
    </>
  );
}

function GuiaHome() {
  const { membership } = useActiveSection();
  const q = useQuery({
    queryKey: ['section-requests', membership.section_id, 'fila'],
    queryFn: () => fetchSectionRequests(membership.section_id, ['submetido', 'em_revisao']),
  });
  const queue = (q.data ?? []).filter((r) => r.kind === 'normal' && r.membership_id !== membership.id);
  return (
    <Link to="/equipa" className="card list-item" style={{ textDecoration: 'none' }}>
      <Users aria-hidden="true" color="var(--green)" />
      <span className="grow">
        <strong>A tua Equipa</strong>
        <br />
        <span className="faint">{queue.length ? `${queue.length} pedido(s) para a próxima reunião de Equipa` : 'Sem pedidos à espera da reunião'}</span>
      </span>
      <ArrowRight aria-hidden="true" />
    </Link>
  );
}

function LeaderHome() {
  const { membership } = useActiveSection();
  const members = useMembers(membership.section_id);
  const ids = (members.data ?? []).filter((m) => m.status === 'ativo' && (m.function === 'pioneiro' || m.function === 'guia')).map((m) => m.id);
  const reqs = useQuery({ queryKey: ['section-requests', membership.section_id, 'pendentes'], queryFn: () => fetchSectionRequests(membership.section_id, ['submetido', 'em_revisao']) });
  const choices = useQuery({ queryKey: ['choices', ids, 'proposta'], queryFn: () => fetchSectionChoices(ids, 'proposta'), enabled: ids.length > 0 });
  const stages = useQuery({ queryKey: ['stage-requests', ids], queryFn: () => fetchSectionStageRequests(ids), enabled: ids.length > 0 });
  const historic = (reqs.data ?? []).filter((r) => r.kind === 'historico').length;
  const openStages = (stages.data ?? []).filter((s) => s.status === 'submetido' || s.status === 'decidido_conselho').length;
  const items = [
    { label: 'Propostas de trilho por negociar', n: choices.data?.length ?? 0, to: '/dirigentes/negociacao' },
    { label: 'Etapas para o Conselho de Guias', n: openStages, to: '/dirigentes/conselho' },
    { label: 'Pedidos de progresso anterior', n: historic, to: '/dirigentes/historico' },
  ];
  return (
    <div className="card">
      <div className="card-title">
        <ClipboardCheck aria-hidden="true" color="var(--red)" />
        <h2 style={{ margin: 0 }}>Equipa de Animação</h2>
      </div>
      <ul className="list">
        {items.map((i) => (
          <li key={i.to}>
            <Link to={i.to} className="list-item">
              <span className="grow">{i.label}</span>
              {i.n > 0 ? <span className="count">{i.n}</span> : <span className="faint">0</span>}
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/dirigentes" className="btn secondary">Visão da secção</Link>
    </div>
  );
}

function AdminHome() {
  const { membership } = useActiveSection();
  const members = useMembers(membership.section_id);
  const pending = (members.data ?? []).filter((m) => m.status === 'pendente').length;
  return (
    <Link to="/gestao" className="card list-item" style={{ textDecoration: 'none' }}>
      <Settings aria-hidden="true" color="var(--ink-soft)" />
      <span className="grow">
        <strong>Gestão</strong>
        <br />
        <span className="faint">{pending ? `${pending} pedido(s) de entrada por confirmar` : 'Membros, equipas, convites e configurações'}</span>
      </span>
      {pending > 0 && <span className="count">{pending}</span>}
    </Link>
  );
}

export default function Home() {
  const s = useActiveSection();
  const first = s.profile?.full_name.split(' ')[0];
  return (
    <>
      <PageTitle title={first ? `Olá, ${first}` : 'Início'} subtitle={s.membership.sections?.name} />
      {s.isGuia && <GuiaHome />}
      {s.isMember && <MemberHome />}
      {s.isDirigente && <LeaderHome />}
      {s.isAdmin && <AdminHome />}
    </>
  );
}
