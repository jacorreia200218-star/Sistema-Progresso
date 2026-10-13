import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, ClipboardList, Flag, MessageSquare, Route as RouteIcon, RotateCcw, Send, Users, UsersRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useActiveSection } from '../lib/session';
import { useProgress, useTeams } from '../lib/hooks';
import { fetchActivity, fetchPendingCounts, fetchSectionChoices, fetchSectionPath, fetchSectionRequests, fetchSectionStageRequests, type ActivityItem } from '../lib/api';
import { memberPosition, MILESTONES, milestoneByKey, STATE_LABEL } from '../lib/caminho';
import { nextAction } from '../lib/progress';
import { progressCounts } from '../lib/meuprogresso';
import { decisionLabel, formatDate } from '../lib/labels';
import type { TrailDecision } from '../lib/types';
import { Empty, ErrorBox, Loading, PageTitle } from '../components/ui';
import { StatCards } from '../components/nav';
import { MeritCard } from '../components/StagePanel';

function MemberHome() {
  const { membership, catalog, isGuia } = useActiveSection();
  const q = useProgress(membership.id);
  const ids = (q.data?.requests ?? []).map((r) => r.id);
  const feedback = useQuery({
    queryKey: ['feedback', membership.id, ids.length],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('trail_decisions').select('*').in('request_id', ids)
        .neq('kind', 'em_revisao').order('recorded_at', { ascending: false }).limit(3);
      if (error) throw error;
      return data as TrailDecision[];
    },
  });
  const teamCounts = useQuery({ queryKey: ['pending-counts', membership.section_id], queryFn: () => fetchPendingCounts(membership.section_id), enabled: isGuia });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const p = q.data;
  const action = nextAction(catalog, p);
  const pos = memberPosition(p, catalog);
  const c = progressCounts(catalog, p);
  const trailOf = (requestId: string) => p.requests.find((r) => r.id === requestId);
  const equipa = teamCounts.data?.equipa ?? 0;

  return (
    <>
      <StatCards label="Resumo do meu progresso" items={[
        { label: 'Etapa atual', value: c.stage?.name ?? milestoneByKey[pos.milestone].name, hint: STATE_LABEL[pos.state].label, to: '/meu-progresso?vista=caminho', tone: 'azul', icon: RouteIcon },
        { label: 'Pedidos em validação', value: c.inValidation, to: '/meu-progresso?vista=pedidos&pfiltro=aguarda', tone: 'verde', icon: Send },
        { label: 'Pedidos a rever', value: c.toReview, to: '/meu-progresso?vista=pedidos&pfiltro=revisao', tone: 'ambar', icon: RotateCcw },
        { label: 'Trilhos validados', value: c.validated, to: '/meu-progresso?vista=validado', tone: 'lilas', icon: CheckCircle2 },
      ]} />

      <section className="card next-step" aria-labelledby="h-next">
        <h2 id="h-next" className="faint-title">Próximo passo</h2>
        <p className="next-title">{action.title}</p>
        {action.detail && <p className="faint prose">{action.detail}</p>}
        {action.to && <Link to={action.to} className="btn">{action.label ?? 'Continuar'} <ArrowRight size={16} aria-hidden="true" /></Link>}
      </section>

      {isGuia && (
        <Link to="/equipa" className="card list-item">
          <span className="grow"><strong>A tua Equipa</strong> · {equipa ? `${equipa} pedido(s) para a reunião de Equipa` : 'Sem pedidos para a reunião'}</span>
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}

      {feedback.data && feedback.data.length > 0 && (
        <section className="card" aria-labelledby="h-fb">
          <div className="row between">
            <h2 id="h-fb" style={{ margin: 0 }}>Feedback recebido</h2>
            <Link to="/meu-progresso?vista=pedidos" className="btn ghost">Ver pedidos</Link>
          </div>
          <ul className="list">
            {feedback.data.map((d) => (
              <li key={d.id}>
                <Link to={`/meu-progresso/trilho/${trailOf(d.request_id)?.trail_key}#pedido`} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <MessageSquare size={16} aria-hidden="true" style={{ marginTop: 3, flex: 'none' }} />
                  <span className="grow">
                    <strong>{catalog.trailByKey.get(trailOf(d.request_id)?.trail_key ?? '')?.name ?? 'Trilho'}</strong> · {decisionLabel[d.kind]}
                    {d.comment && <><br /><span className="muted">«{d.comment.length > 120 ? `${d.comment.slice(0, 120)}…` : d.comment}»</span></>}
                  </span>
                  <span className="faint nowrap">{formatDate(d.recorded_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <MeritCard progress={p} catalog={catalog} />
    </>
  );
}

export const ACTIVITY_LABEL: Record<string, string> = {
  ...decisionLabel,
  conselho_favoravel: 'Conselho de Guias: favorável à etapa',
  conselho_desfavoravel: 'Conselho de Guias: desfavorável à etapa',
  etapa_confirmada: 'Etapa concluída (opinião final)',
  etapa_nao_confirmada: 'Etapa não confirmada',
  etapa_aberta: 'Etapa aberta',
  merito: 'Anilha de mérito registada',
};

export function activityLink(e: ActivityItem) {
  return e.kind.startsWith('conselho') || e.kind.startsWith('etapa') || e.kind === 'merito' ? `/membros/${e.membership_id}` : `/revisoes/pedido/${e.ref}`;
}

export function ActivityList({ items }: { items: ActivityItem[] }) {
  return (
    <ul className="list">
      {items.map((e, i) => (
        <li key={`${e.ref}-${e.kind}-${i}`}>
          <Link to={activityLink(e)} className="list-item">
            <span className="grow"><strong>{e.member}</strong> · {ACTIVITY_LABEL[e.kind] ?? e.kind}{e.subject ? ` — ${e.subject}` : ''}</span>
            <span className="faint nowrap">{formatDate(e.at)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function LeaderHome() {
  const s = useActiveSection();
  const { membership } = s;
  const path = useQuery({ queryKey: ['section-path', membership.section_id], queryFn: () => fetchSectionPath(membership.section_id) });
  const teams = useTeams(membership.section_id);
  const ids = (path.data?.members ?? []).map((m) => m.membership_id);
  const reqs = useQuery({ queryKey: ['section-requests', membership.section_id, 'pendentes'], queryFn: () => fetchSectionRequests(membership.section_id, ['submetido', 'em_revisao']) });
  const choices = useQuery({ queryKey: ['choices', ids, 'proposta'], queryFn: () => fetchSectionChoices(ids, 'proposta'), enabled: ids.length > 0 });
  const stages = useQuery({ queryKey: ['stage-requests', ids], queryFn: () => fetchSectionStageRequests(ids), enabled: ids.length > 0 });
  const activity = useQuery({ queryKey: ['activity', membership.section_id, 3], queryFn: () => fetchActivity(membership.section_id, 3) });
  const counts = useQuery({ queryKey: ['pending-counts', membership.section_id], queryFn: () => fetchPendingCounts(membership.section_id) });

  if (path.isLoading) return <Loading />;
  if (path.error) return <ErrorBox error={path.error} retry={path.refetch} />;
  const total = path.data?.total ?? 0;
  const activeTeams = (teams.data ?? []).filter((t) => !t.archived_at).length;
  const pendingReqs = reqs.data?.length ?? 0;
  const openStages = (stages.data ?? []).filter((x) => x.status === 'submetido' || x.status === 'decidido_conselho').length;
  const historic = (reqs.data ?? []).filter((r) => r.kind === 'historico').length;
  const others = [
    { label: 'Propostas de trilho por negociar', n: choices.data?.length ?? 0, to: '/acompanhamento/negociacao' },
    { label: 'Pedidos de progresso anterior', n: historic, to: '/acompanhamento/historico' },
    ...(s.isAdmin ? [{ label: 'Pedidos de entrada por confirmar', n: counts.data?.gestao ?? 0, to: '/gestao/membros' }] : []),
  ].filter((i) => i.n > 0);

  if (total === 0) {
    return (
      <div className="card">
        <Empty title="Ainda não há pioneiros na secção.">
          {s.isAdmin ? (
            <div className="btn-row" style={{ justifyContent: 'center' }}>
              <Link to="/gestao/equipas" className="btn secondary">Criar equipas</Link>
              <Link to="/gestao/convites" className="btn">Convidar elementos</Link>
            </div>
          ) : <p className="faint prose">Pede à administração da secção para criar equipas e convites.</p>}
        </Empty>
      </div>
    );
  }

  return (
    <>
      <StatCards label="Resumo da secção" items={[
        { label: 'Pioneiros', value: total, to: '/caminho', tone: 'azul', icon: Users },
        { label: 'Equipas', value: activeTeams, to: s.isAdmin ? '/gestao/equipas' : '/caminho?vista=equipa', tone: 'verde', icon: UsersRound },
        { label: 'Pedidos pendentes', value: pendingReqs, to: '/acompanhamento/pedidos', tone: 'ambar', icon: ClipboardList },
        { label: 'Etapas por validar', value: openStages, to: '/acompanhamento/conselho', tone: 'lilas', icon: Flag },
      ]} />

      <section className="card" aria-labelledby="h-dist">
        <div className="row between">
          <h2 id="h-dist" style={{ margin: 0 }}>Onde estão</h2>
          <Link to="/caminho" className="btn ghost">Caminho da secção</Link>
        </div>
        <ul className="dist" aria-label="Pessoas por marco do caminho">
          {MILESTONES.filter((m) => m.tracked).map((m) => (
            <li key={m.key}>
              <Link to={`/caminho?marco=${m.key}`}>
                <span className="dist-n">{path.data?.counts[m.key] ?? 0}</span>
                <span className="dist-l">{m.short}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {others.length > 0 ? (
        <section className="card" aria-labelledby="h-pend">
          <h2 id="h-pend">Outros pendentes</h2>
          <ul className="list">
            {others.map((i) => (
              <li key={i.to}>
                <Link to={i.to} className="list-item">
                  <span className="grow">{i.label}</span>
                  <span className="count">{i.n}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : pendingReqs === 0 && openStages === 0 ? (
        <p className="card faint" role="status">Sem pendentes.</p>
      ) : null}

      <section className="card" aria-labelledby="h-act">
        <div className="row between">
          <h2 id="h-act" style={{ margin: 0 }}>Atividade recente</h2>
          <Link to="/atividade" className="btn ghost">Ver atividade</Link>
        </div>
        {activity.isLoading ? <Loading rows={1} compact /> : !(activity.data ?? []).length ? <p className="faint" style={{ margin: 0 }}>Ainda sem atividade.</p> : (
          <ActivityList items={(activity.data ?? []).slice(0, 3)} />
        )}
      </section>
    </>
  );
}

function AdminOnlyHome() {
  const { membership } = useActiveSection();
  const counts = useQuery({ queryKey: ['pending-counts', membership.section_id], queryFn: () => fetchPendingCounts(membership.section_id) });
  const pending = counts.data?.gestao ?? 0;
  return (
    <StatCards label="Gestão" items={[
      { label: 'Pedidos de entrada', value: pending, to: '/gestao/membros', tone: 'ambar', icon: ClipboardList },
      { label: 'Membros e equipas', value: <Users size={22} aria-hidden="true" />, to: '/gestao', tone: 'azul', icon: Users },
    ]} />
  );
}

export default function Home() {
  const s = useActiveSection();
  const first = s.profile?.full_name.split(' ')[0];
  return (
    <>
      <PageTitle title={first ? `Olá, ${first}` : 'Início'} />
      {s.isMember && <MemberHome />}
      {s.isDirigente && <LeaderHome />}
      {s.isAdmin && !s.isDirigente && !s.isMember && <AdminOnlyHome />}
      {!s.isMember && !s.isDirigente && !s.isAdmin && <Empty title="Sem função atribuída." />}
    </>
  );
}

