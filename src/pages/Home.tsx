import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ClipboardCheck, MessageSquare, Route as RouteIcon, Settings, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useActiveSection } from '../lib/session';
import { useMembers, useProgress } from '../lib/hooks';
import { fetchActivity, fetchPendingCounts, fetchSectionChoices, fetchSectionPath, fetchSectionRequests, fetchSectionStageRequests } from '../lib/api';
import { memberPosition, MILESTONES, milestoneByKey, STATE_LABEL } from '../lib/caminho';
import { nextAction } from '../lib/progress';
import { decisionLabel, formatDate, formatDateTime } from '../lib/labels';
import type { TrailDecision } from '../lib/types';
import { Badge, Empty, ErrorBox, Loading, PageTitle } from '../components/ui';
import { RequestList } from '../components/RequestList';
import { AreaMarkers } from '../components/caminho/Pieces';
import { MeritCard } from '../components/StagePanel';

function MemberHome() {
  const { membership, catalog } = useActiveSection();
  const q = useProgress(membership.id);
  const ids = (q.data?.requests ?? []).map((r) => r.id);
  const feedback = useQuery({
    queryKey: ['feedback', membership.id, ids.length],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('trail_decisions').select('*').in('request_id', ids)
        .neq('kind', 'em_revisao').order('recorded_at', { ascending: false }).limit(4);
      if (error) throw error;
      return data as TrailDecision[];
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const p = q.data;
  const action = nextAction(catalog, p);
  const pos = memberPosition(p, catalog);
  const pending = p.requests.filter((r) => ['submetido', 'em_revisao', 'rascunho', 'devolvido'].includes(r.status));
  const trailName = (requestId: string) => catalog.trailById.get(p.requests.find((r) => r.id === requestId)?.trail_id ?? '')?.name ?? 'Trilho';

  return (
    <>
      <div className="card next-step">
        <p className="faint" style={{ marginBottom: 4 }}>Próximo passo</p>
        <h2>{action.title}</h2>
        <p className="muted">{action.detail}</p>
        {action.to && <Link to={action.to} className="btn">Continuar <ArrowRight size={18} aria-hidden="true" /></Link>}
      </div>

      <Link to="/caminho" className="card where-card">
        <span className="where-icon" aria-hidden="true"><RouteIcon size={24} /></span>
        <span className="grow">
          <span className="faint">Onde estou no caminho</span>
          <br />
          <strong className="where-title">{milestoneByKey[pos.milestone].name}</strong>
          <br />
          <span>{STATE_LABEL[pos.state].label}</span>
        </span>
        <ArrowRight aria-hidden="true" />
      </Link>

      <section className="card" aria-labelledby="h-areas">
        <div className="row between">
          <h2 id="h-areas" style={{ margin: 0 }}>As seis áreas</h2>
          <Link to="/progresso" className="btn ghost">Ver trilhos</Link>
        </div>
        <p className="faint">Trilhos validados por área. Cada etapa precisa de um trilho de cada área.</p>
        <AreaMarkers progress={p} catalog={catalog} />
      </section>

      <section className="card" aria-labelledby="h-pedidos">
        <div className="row between">
          <h2 id="h-pedidos" style={{ margin: 0 }}>Pedidos {pending.length > 0 && <span className="count">{pending.length}</span>}</h2>
          <Link to="/pedidos" className="btn ghost">Todos</Link>
        </div>
        {pending.length ? <RequestList requests={pending.slice(0, 4)} catalog={catalog} /> : <p className="faint">Sem pedidos em curso.</p>}
        {feedback.data && feedback.data.length > 0 && (
          <>
            <h3 className="section-title" style={{ marginTop: 14 }}>Feedback recebido</h3>
            <ul className="list">
              {feedback.data.map((d) => (
                <li key={d.id}>
                  <Link to={`/pedidos/${d.request_id}`} className="list-item" style={{ alignItems: 'flex-start' }}>
                    <MessageSquare size={18} aria-hidden="true" style={{ marginTop: 4 }} />
                    <span className="grow">
                      <strong>{trailName(d.request_id)}</strong> · {decisionLabel[d.kind]}
                      {d.comment && <><br /><span className="muted">«{d.comment.length > 140 ? `${d.comment.slice(0, 140)}…` : d.comment}»</span></>}
                      <br />
                      <span className="faint">{formatDateTime(d.recorded_at)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <MeritCard progress={p} catalog={catalog} />
    </>
  );
}

function GuiaHome() {
  const { membership } = useActiveSection();
  const counts = useQuery({ queryKey: ['pending-counts', membership.section_id], queryFn: () => fetchPendingCounts(membership.section_id) });
  const n = counts.data?.equipa ?? 0;
  return (
    <Link to="/equipa" className="card list-item" style={{ textDecoration: 'none' }}>
      <Users aria-hidden="true" color="var(--green-ink)" />
      <span className="grow">
        <strong>A tua Equipa</strong>
        <br />
        <span className="faint">{n ? `${n} pedido(s) para a próxima reunião de Equipa` : 'Sem pedidos à espera da reunião'}</span>
      </span>
      {n > 0 && <span className="count">{n}</span>}
      <ArrowRight aria-hidden="true" />
    </Link>
  );
}

const ACTIVITY_LABEL: Record<string, string> = {
  ...decisionLabel,
  conselho_favoravel: 'Conselho de Guias: favorável à etapa',
  conselho_desfavoravel: 'Conselho de Guias: desfavorável à etapa',
  etapa_confirmada: 'Etapa concluída (opinião final)',
  etapa_nao_confirmada: 'Etapa não confirmada',
  etapa_aberta: 'Etapa aberta',
  merito: 'Anilha de mérito registada',
};

function LeaderHome() {
  const s = useActiveSection();
  const { membership } = s;
  const members = useMembers(membership.section_id);
  const path = useQuery({ queryKey: ['section-path', membership.section_id], queryFn: () => fetchSectionPath(membership.section_id) });
  const ids = (members.data ?? []).filter((m) => m.status === 'ativo' && (m.function === 'pioneiro' || m.function === 'guia')).map((m) => m.id);
  const guias = new Set((members.data ?? []).filter((m) => m.function === 'guia').map((m) => m.id));
  const reqs = useQuery({ queryKey: ['section-requests', membership.section_id, 'pendentes'], queryFn: () => fetchSectionRequests(membership.section_id, ['submetido', 'em_revisao']) });
  const choices = useQuery({ queryKey: ['choices', ids, 'proposta'], queryFn: () => fetchSectionChoices(ids, 'proposta'), enabled: ids.length > 0 });
  const stages = useQuery({ queryKey: ['stage-requests', ids], queryFn: () => fetchSectionStageRequests(ids), enabled: ids.length > 0 });
  const activity = useQuery({ queryKey: ['activity', membership.section_id], queryFn: () => fetchActivity(membership.section_id, 8) });

  if (path.isLoading) return <Loading />;
  const total = path.data?.total ?? 0;
  const historic = (reqs.data ?? []).filter((r) => r.kind === 'historico').length;
  const fromGuias = (reqs.data ?? []).filter((r) => r.kind === 'normal' && guias.has(r.membership_id)).length;
  const openStages = (stages.data ?? []).filter((x) => x.status === 'submetido' || x.status === 'decidido_conselho').length;
  const items = [
    { label: 'Propostas de trilho por negociar', n: choices.data?.length ?? 0, to: '/acompanhamento/negociacao' },
    { label: 'Etapas para o Conselho de Guias', n: openStages, to: '/acompanhamento/conselho' },
    { label: 'Pedidos de guias (registo pela Equipa de Animação)', n: fromGuias, to: '/acompanhamento/pedidos' },
    { label: 'Pedidos de progresso anterior', n: historic, to: '/acompanhamento/historico' },
  ];

  if (total === 0) {
    return (
      <div className="card">
        <Empty title="Ainda não há pioneiros na secção.">
          <p>Cria as equipas e convida os elementos. Cada pessoa cria a sua conta e fica pendente até confirmares a entrada, a função e a equipa.</p>
          {s.isAdmin ? (
            <div className="btn-row" style={{ justifyContent: 'center' }}>
              <Link to="/gestao/equipas" className="btn secondary">Criar equipas</Link>
              <Link to="/gestao/convites" className="btn">Convidar elementos</Link>
            </div>
          ) : <p className="faint">Pede à administração da secção para criar equipas e convites.</p>}
          <Link to="/caminho" className="btn ghost">Conhecer o Caminho</Link>
        </Empty>
      </div>
    );
  }

  return (
    <>
      <Link to="/caminho?vista=seccao" className="card caminho-shortcut">
        <span className="where-icon" aria-hidden="true"><RouteIcon size={26} /></span>
        <span className="grow">
          <strong className="where-title">Caminho da secção</strong>
          <br />
          <span className="muted">{total} pioneiro{total === 1 ? '' : 's'} · quem está em cada marco, por equipa</span>
        </span>
        <ArrowRight aria-hidden="true" />
      </Link>

      <section className="card" aria-labelledby="h-dist">
        <h2 id="h-dist">Distribuição por marco</h2>
        <ul className="dist" aria-label="Pioneiros por marco do caminho">
          {MILESTONES.filter((m) => m.tracked).map((m) => (
            <li key={m.key}>
              <Link to={`/caminho?vista=seccao&marco=${m.key}`}>
                <span className="dist-n">{path.data?.counts[m.key] ?? 0}</span>
                <span className="dist-l">{m.short}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="h-pend">
        <div className="card-title">
          <ClipboardCheck aria-hidden="true" color="var(--accent-ink)" />
          <h2 id="h-pend" style={{ margin: 0 }}>Pendentes</h2>
        </div>
        <ul className="list">
          {items.map((i) => (
            <li key={i.to}>
              <Link to={i.to} className="list-item">
                <span className="grow">{i.label}</span>
                {i.n > 0 ? <span className="count">{i.n}</span> : <span className="faint">0</span>}
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="h-act">
        <h2 id="h-act">Atividade recente</h2>
        {activity.isLoading ? <Loading /> : !(activity.data ?? []).length ? <p className="faint">Ainda sem atividade.</p> : (
          <ul className="list">
            {(activity.data ?? []).map((e, i) => (
              <li key={`${e.ref}-${e.kind}-${i}`}>
                <Link to={e.kind.startsWith('conselho') || e.kind.startsWith('etapa') || e.kind === 'merito' ? `/membros/${e.membership_id}` : `/revisoes/pedido/${e.ref}`} className="list-item">
                  <span className="grow">
                    <strong>{e.member}</strong> · {ACTIVITY_LABEL[e.kind] ?? e.kind}{e.subject ? ` — ${e.subject}` : ''}
                    <br />
                    <span className="faint">{formatDate(e.at)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function AdminHome() {
  const { membership } = useActiveSection();
  const counts = useQuery({ queryKey: ['pending-counts', membership.section_id], queryFn: () => fetchPendingCounts(membership.section_id) });
  const pending = counts.data?.gestao ?? 0;
  return (
    <Link to="/gestao" className="card list-item" style={{ textDecoration: 'none' }}>
      <Settings aria-hidden="true" color="var(--ink-soft)" />
      <span className="grow">
        <strong>Gestão</strong>
        <br />
        <span className="faint">{pending ? `${pending} pedido(s) de entrada por confirmar` : 'Membros, equipas, convites e configurações'}</span>
      </span>
      {pending > 0 && <Badge label={`${pending}`} tone="attention" icon="clock" />}
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
      {!s.isMember && !s.isDirigente && !s.isAdmin && <Empty title="Sem função atribuída." />}
    </>
  );
}
