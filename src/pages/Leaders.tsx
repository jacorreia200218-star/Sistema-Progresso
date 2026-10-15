// Acompanhamento da secção pela Equipa de Animação, em três separadores:
//   Secção  — pessoas por equipa, pesquisa e filtros, mérito e exportação secundários;
//   Pedidos — uma caixa de entrada comum (negociação, trilhos, progresso anterior),
//             cada pedido com a sua lógica, permissões e ações;
//   Etapas  — etapas à espera do Conselho de Guias, opinião final e reconhecimento,
//             e (secundário) a comunicação das decisões de trilhos das equipas.
// Endereços antigos dos seis separadores são redirecionados (ver App.tsx).
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Download, Flag, Handshake, History, ListChecks, Search } from 'lucide-react';
import { useActiveSection } from '../lib/session';
import { useMembers, useTeams } from '../lib/hooks';
import {
  call, fetchMeritStatus, fetchPendingCounts, fetchSectionChoices, fetchSectionPath, fetchSectionRequests, fetchSectionStagePaths, fetchSectionStageRequests,
  type MemberRow, type PathMember,
} from '../lib/api';
import { useAction } from '../lib/useAction';
import { MILESTONES, milestoneByKey, STATE_LABEL, type MilestoneKey, type PositionState } from '../lib/caminho';
import { formatDate, functionLabel, requestStatusLabel, stageRequestLabel, todayIso, type Tone } from '../lib/labels';
import type { StageChoice, StageRequest, TrailRequest } from '../lib/types';
import { Avatar, Badge, ConfirmButton, Empty, ErrorBox, Field, Loading, Notice, PageTitle } from '../components/ui';
import { RequestList } from '../components/RequestList';
import { stageName } from '../components/StagePanel';
import { proposalRef } from '../lib/labels';

const TABS = [
  ['seccao', 'Secção'],
  ['pedidos', 'Pedidos'],
  ['etapas', 'Etapas'],
] as const;

export default function Leaders({ tab: forced }: { tab?: string }) {
  const params = useParams();
  const tab = forced ?? params.tab ?? 'seccao';
  const { membership } = useActiveSection();
  const members = useMembers(membership.section_id);
  const counts = useQuery({ queryKey: ['pending-counts', membership.section_id], queryFn: () => fetchPendingCounts(membership.section_id) });
  const progressMembers = (members.data ?? []).filter((m) => m.status === 'ativo' && (m.function === 'pioneiro' || m.function === 'guia'));
  const c = counts.data ?? {};
  const pending: Record<string, number> = { pedidos: (c.negociacao ?? 0) + (c.trilhos ?? 0) + (c.anterior ?? 0), etapas: c.etapas ?? 0 };

  return (
    <>
      <PageTitle title="Acompanhamento" subtitle="Acompanhamento da secção pela Equipa de Animação." />
      <nav className="tabs" aria-label="Secções do acompanhamento">
        {TABS.map(([k, label]) => (
          <Link key={k} to={`/acompanhamento/${k}`} className="tab" aria-current={tab === k ? 'page' : undefined}>
            {label}
            {!!pending[k] && <span className="count" aria-label={`${pending[k]} pendentes`}>{pending[k]}</span>}
          </Link>
        ))}
      </nav>
      {members.isLoading ? <Loading /> : members.error ? <ErrorBox error={members.error} retry={members.refetch} /> : (
        <>
          {tab === 'seccao' && <SectionOverview members={progressMembers} />}
          {tab === 'pedidos' && <Inbox members={progressMembers} />}
          {tab === 'etapas' && <Stages members={progressMembers} />}
        </>
      )}
    </>
  );
}

const nameMap = (members: MemberRow[]) => Object.fromEntries(members.map((m) => [m.id, m.profiles?.full_name ?? '']));
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Atualiza um parâmetro do endereço (os filtros sobrevivem a voltar atrás). */
function useParam(key: string, fallback = '') {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;
  const set = (v: string) => {
    // Parte do endereço atual (não do último render): duas mudanças seguidas não se anulam.
    setParams(() => {
      const next = new URLSearchParams(window.location.search);
      if (v && v !== fallback) next.set(key, v);
      else next.delete(key);
      return next;
    }, { replace: true });
  };
  return [value, set] as const;
}

// ---------------------------------------------------------------------------
// SECÇÃO
// ---------------------------------------------------------------------------
function SectionOverview({ members }: { members: MemberRow[] }) {
  const { membership, catalog } = useActiveSection();
  const teams = useTeams(membership.section_id);
  const path = useQuery({ queryKey: ['section-path', membership.section_id], queryFn: () => fetchSectionPath(membership.section_id) });
  const reqs = useQuery({ queryKey: ['section-requests', membership.section_id, 'all'], queryFn: () => fetchSectionRequests(membership.section_id) });
  const [q, setQ] = useParam('q');
  const [team, setTeam] = useParam('equipa');
  const [stage, setStage] = useParam('etapa');
  const [ver] = useParam('ver');
  const action = useAction();

  async function exportData() {
    await action.run(async () => {
      const data = await call('export_section', { p_section: membership.section_id });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pioneiros-exportacao-${todayIso()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'Exportação descarregada.');
  }

  const pos = new Map<string, PathMember>((path.data?.members ?? []).map((m) => [m.membership_id, m]));
  const list = members
    .filter((m) => !team || (team === 'sem' ? !m.team_id : m.team_id === team))
    .filter((m) => !stage || pos.get(m.id)?.milestone === stage)
    .filter((m) => !q.trim() || norm(m.profiles?.full_name ?? '').includes(norm(q.trim())))
    .sort((a, b) => (a.profiles?.full_name ?? '').localeCompare(b.profiles?.full_name ?? '', 'pt', { sensitivity: 'base' }));
  const byTeam = new Map<string, MemberRow[]>();
  for (const m of list) byTeam.set(m.team_id ?? 'sem', [...(byTeam.get(m.team_id ?? 'sem') ?? []), m]);
  const teamOrder = [...byTeam.keys()].sort((a, b) => (teams.data?.find((t) => t.id === a)?.name ?? '~').localeCompare(teams.data?.find((t) => t.id === b)?.name ?? '~', 'pt'));
  const validated = (id: string) => (reqs.data ?? []).filter((r) => r.membership_id === id && (r.status === 'validado_equipa' || r.status === 'aprovado')).length;

  return (
    <>
      <div className="grid-filters">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Pesquisar por nome</span>
          <input type="search" placeholder="Pesquisar por nome" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Filtrar por equipa">
          <option value="">Todas as equipas</option>
          {(teams.data ?? []).filter((t) => !t.archived_at).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Filtrar por etapa">
          <option value="">Todas as etapas</option>
          {MILESTONES.filter((m) => m.tracked).map((m) => <option key={m.key} value={m.key}>{m.short}</option>)}
        </select>
        <details className="menu">
          <summary className="btn ghost" aria-label="Mais opções">Mais <ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="menu-panel">
            <p className="faint prose">Ficheiro JSON com os dados pedagógicos da secção (sem anexos). Contém dados pessoais: guarda-o num local seguro.</p>
            <button type="button" className="btn secondary" disabled={action.busy} onClick={exportData}>
              <Download size={16} aria-hidden="true" /> Exportar dados
            </button>
          </div>
        </details>
      </div>
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}

      {members.length === 0 && <div className="card"><Empty title="Ainda não há pioneiros ativos na secção." /></div>}
      {members.length > 0 && list.length === 0 && <div className="card"><Empty title="Ninguém com estes filtros." /></div>}
      {teamOrder.map((teamId) => (
        <section key={teamId} className="card" aria-label={teams.data?.find((t) => t.id === teamId)?.name ?? 'Sem equipa'}>
          <h2>{teams.data?.find((t) => t.id === teamId)?.name ?? 'Sem equipa'} <span className="faint">· {byTeam.get(teamId)!.length}</span></h2>
          <ul className="list">
            {byTeam.get(teamId)!.map((m) => {
              const pm = pos.get(m.id);
              return (
                <li key={m.id}>
                  <Link to={`/membros/${m.id}`} className="list-item">
                    <Avatar name={m.profiles?.full_name ?? '?'} photoPath={m.profiles?.photo_path} />
                    <span className="grow">
                      <strong>{m.profiles?.full_name}</strong>
                      {m.function === 'guia' && <span className="faint"> · {functionLabel.guia}</span>}
                      <br />
                      <span className="faint">
                        {pm ? milestoneByKey[pm.milestone as MilestoneKey]?.short : '—'}
                        {pm && STATE_LABEL[pm.state as PositionState] ? ` · ${STATE_LABEL[pm.state as PositionState].label}` : ''} · {validated(m.id)} de {catalog.trailById.size} trilhos
                      </span>
                    </span>
                    <span className="faint nowrap">Ver percurso</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <details className="card more-card" open={ver === 'merito'} id="merito">
        <summary>Anilha de mérito</summary>
        <Merit members={list} />
      </details>
    </>
  );
}

function MeritRow({ m }: { m: MemberRow }) {
  const q = useQuery({ queryKey: ['merit', m.id], queryFn: () => fetchMeritStatus(m.id) });
  return (
    <li>
      <Link to={`/membros/${m.id}#merito`} className="list-item">
        <span className="grow">
          <strong>{m.profiles?.full_name}</strong>
          <br />
          <span className="faint">{q.data ? `${q.data.validated} de ${q.data.total} trilhos · última etapa ${q.data.last_stage_concluded ? 'concluída' : 'por concluir'}` : '…'}</span>
        </span>
        {q.data?.eligible ? <Badge label="Elegível" tone="ok" icon="check" /> : <Badge label="Ainda não elegível" tone="muted" icon="circle" />}
      </Link>
    </li>
  );
}

function Merit({ members }: { members: MemberRow[] }) {
  return (
    <>
      <p className="faint prose">
        Elegibilidade calculada: todos os trilhos da secção validados e a última etapa (Construção) concluída. A atribuição efetiva é registada por um
        dirigente, com data, no percurso de cada membro. Não depende de anos na secção, fotografias ou pontos.
      </p>
      {members.length ? <ul className="list">{members.map((m) => <MeritRow key={m.id} m={m} />)}</ul> : <Empty title="Sem membros." />}
    </>
  );
}

// ---------------------------------------------------------------------------
// PEDIDOS — caixa de entrada comum
// ---------------------------------------------------------------------------
type InboxType = 'negociacao' | 'trilhos' | 'anterior';
const TYPES: { key: InboxType; label: string; icon: typeof Flag }[] = [
  { key: 'negociacao', label: 'Negociação', icon: Handshake },
  { key: 'trilhos', label: 'Trilhos', icon: ListChecks },
  { key: 'anterior', label: 'Progresso anterior', icon: History },
];

interface InboxItem {
  key: string;
  type: InboxType;
  memberId: string;
  pending: boolean;
  at: string;
  choice?: StageChoice;
  request?: TrailRequest;
}

export const CHOICE_STATUS: Record<StageChoice['status'], { label: string; tone: Tone; icon: string }> = {
  proposta: { label: 'Por negociar', tone: 'progress', icon: 'clock' },
  confirmada: { label: 'Confirmada', tone: 'ok', icon: 'check' },
  recusada: { label: 'Não aceite', tone: 'muted', icon: 'x' },
  retirada: { label: 'Retirada', tone: 'muted', icon: 'x' },
  substituida: { label: 'Substituída', tone: 'muted', icon: 'return' },
};

function Inbox({ members }: { members: MemberRow[] }) {
  const { membership, catalog } = useActiveSection();
  const teams = useTeams(membership.section_id);
  const ids = members.map((m) => m.id);
  const choices = useQuery({ queryKey: ['choices', ids, 'todas'], queryFn: () => fetchSectionChoices(ids), enabled: ids.length > 0 });
  const paths = useQuery({ queryKey: ['paths', ids], queryFn: () => fetchSectionStagePaths(ids), enabled: ids.length > 0 });
  const reqs = useQuery({ queryKey: ['section-requests', membership.section_id, 'all'], queryFn: () => fetchSectionRequests(membership.section_id) });
  const [tipo, setTipo] = useParam('tipo', 'todos');
  const [estado, setEstado] = useParam('estado', 'pendentes');
  const [team, setTeam] = useParam('equipa');
  const names = nameMap(members);
  const byId = new Map(members.map((m) => [m.id, m]));

  if (choices.isLoading || reqs.isLoading) return <Loading />;
  if (choices.error || reqs.error) return <ErrorBox error={choices.error ?? reqs.error} retry={() => { choices.refetch(); reqs.refetch(); }} />;

  // Cada pedido entra uma vez, com uma chave única por tipo.
  const items = new Map<string, InboxItem>();
  for (const c of choices.data ?? []) {
    items.set(`negociacao:${c.id}`, { key: `negociacao:${c.id}`, type: 'negociacao', memberId: c.membership_id, pending: c.status === 'proposta', at: c.decided_at ?? c.proposed_at, choice: c });
  }
  for (const r of reqs.data ?? []) {
    if (!byId.has(r.membership_id) || r.status === 'rascunho' || r.status === 'cancelado') continue;
    const type: InboxType = r.kind === 'historico' ? 'anterior' : r.kind === 'negociacao' ? 'negociacao' : 'trilhos';
    items.set(`${type}:${r.id}`, { key: `${type}:${r.id}`, type, memberId: r.membership_id, pending: r.status === 'submetido' || r.status === 'em_revisao', at: r.updated_at, request: r });
  }
  const all = [...items.values()].filter((i) => !team || byId.get(i.memberId)?.team_id === team);
  const byState = all.filter((i) => (estado === 'todos' ? true : estado === 'decididos' ? !i.pending : i.pending));
  const list = byState.filter((i) => tipo === 'todos' || i.type === tipo)
    .sort((a, b) => Number(b.pending) - Number(a.pending) || b.at.localeCompare(a.at));
  const pendingOf = (t: string) => all.filter((i) => i.pending && (t === 'todos' || i.type === t)).length;

  return (
    <>
      <div className="filter-chips" role="radiogroup" aria-label="Tipo de pedido">
        {[{ key: 'todos', label: 'Todos' }, ...TYPES].map((t) => (
          <label key={t.key} className={`filter-chip type-${t.key}`}>
            <input type="radio" name="tipo" checked={tipo === t.key} onChange={() => setTipo(t.key)} />
            <span>{t.label}</span> <span className="fc-n" aria-label={`${pendingOf(t.key)} pendentes`}>{pendingOf(t.key)}</span>
          </label>
        ))}
      </div>
      <div className="grid-filters">
        <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Filtrar por estado">
          <option value="pendentes">Pendentes</option>
          <option value="decididos">Decididos</option>
          <option value="todos">Todos os estados</option>
        </select>
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Filtrar por equipa">
          <option value="">Todas as equipas</option>
          {(teams.data ?? []).filter((t) => !t.archived_at).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="faint grid-count" aria-live="polite">{list.length} {list.length === 1 ? 'pedido' : 'pedidos'}</span>
      </div>

      <div className="card">
        {list.length === 0 ? <Empty title={estado === 'pendentes' ? 'Sem pedidos pendentes.' : 'Sem pedidos com estes filtros.'} /> : (
          <ul className="list inbox">
            {list.map((i) => {
              const T = TYPES.find((t) => t.key === i.type)!;
              const trail = catalog.trailById.get(i.choice?.trail_id ?? i.request!.trail_id);
              const area = trail ? catalog.areaById.get(trail.area_id) : undefined;
              const m = byId.get(i.memberId);
              const badge = i.choice ? CHOICE_STATUS[i.choice.status] : requestStatusLabel[i.request!.status];
              const stage = i.choice ? stageName(catalog, paths.data?.find((p) => p.id === i.choice!.stage_path_id)?.stage_key ?? '') : null;
              const guiaOwn = i.type === 'trilhos' && m?.function === 'guia';
              const head = (
                <>
                  <span className={`type-tag type-${i.type}`}><T.icon size={14} aria-hidden="true" /> {T.label}</span>
                  <span className="grow">
                    <strong>{names[i.memberId]}</strong> · {trail?.name}
                    <br />
                    <span className="faint">
                      {area?.name}
                      {i.choice ? ` · etapa ${stage} · ${proposalRef(i.choice)}${i.choice.replaces_choice_id ? ' · troca' : ''}` : ''}
                      {guiaOwn ? ' · pedido do guia: regista a Equipa de Animação' : ''} · {formatDate(i.at)}
                    </span>
                  </span>
                  <Badge {...badge} />
                </>
              );
              return (
                <li key={i.key} className={i.pending ? 'is-pending' : ''}>
                  {/* Cada pedido e cada proposta abre o seu próprio registo. */}
                  <Link to={i.request ? `/revisoes/pedido/${i.request.id}` : `/acompanhamento/proposta/${i.choice!.id}`} className="list-item">{head}</Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

export function ChoiceDecision({ choice, member, stage, bare }: { choice: StageChoice; member?: string; stage: string; /** Só a decisão (o resto já está na página da proposta). */ bare?: boolean }) {
  const { catalog } = useActiveSection();
  const action = useAction();
  const [comment, setComment] = useState('');
  const trail = catalog.trailById.get(choice.trail_id);
  const area = trail ? catalog.areaById.get(trail.area_id) : undefined;
  return (
    <div className="card flat">
      {bare ? <h2>Decisão da negociação</h2> : (
        <>
          <p style={{ marginBottom: 4 }}>
            {member && <strong>{member} · </strong>}Etapa {stage} · {area?.name}
          </p>
          <p>
            {choice.replaces_choice_id ? 'Troca para ' : 'Proposta: '}
            <Link to={`/meu-progresso/trilho/${trail?.key}?pioneiro=${choice.membership_id}`}>{trail?.name}</Link>
          </p>
          {choice.planned_opportunities && <div className="quote prose">{choice.planned_opportunities}</div>}
        </>
      )}
      <ErrorBox error={action.error} />
      {action.success ? <Notice kind="success">{action.success}</Notice> : (
        <>
          <Field label="Comentário (obrigatório para não aceitar)" htmlFor={`c-${choice.id}`}>
            <textarea id={`c-${choice.id}`} value={comment} onChange={(e) => setComment(e.target.value)} style={{ minHeight: 70 }} />
          </Field>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button type="button" className="btn" disabled={action.busy}
              onClick={() => action.run(() => call('decide_choice', { p_choice: choice.id, p_accept: true, p_comment: comment }), 'Escolha confirmada.')}>
              Confirmar
            </button>
            <button type="button" className="btn secondary" disabled={action.busy || !comment.trim()}
              onClick={() => action.run(() => call('decide_choice', { p_choice: choice.id, p_accept: false, p_comment: comment }), 'Proposta não aceite.')}>
              Não aceitar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ETAPAS
// ---------------------------------------------------------------------------
function Stages({ members }: { members: MemberRow[] }) {
  const { membership, catalog } = useActiveSection();
  const ids = members.map((m) => m.id);
  const stageReqs = useQuery({ queryKey: ['stage-requests', ids], queryFn: () => fetchSectionStageRequests(ids), enabled: ids.length > 0 });
  const paths = useQuery({ queryKey: ['paths', ids], queryFn: () => fetchSectionStagePaths(ids), enabled: ids.length > 0 });
  const reqs = useQuery({ queryKey: ['section-requests', membership.section_id, 'all'], queryFn: () => fetchSectionRequests(membership.section_id) });
  const [ver] = useParam('ver');
  const names = nameMap(members);
  if (stageReqs.isLoading || reqs.isLoading) return <Loading />;
  const open = (stageReqs.data ?? []).filter((s) => s.status === 'submetido' || s.status === 'decidido_conselho');
  const toRecognize = (paths.data ?? []).filter((p) => p.status === 'concluida' && !p.recognized_on);
  const recent = (reqs.data ?? []).filter((r) => r.kind === 'normal' && (r.status === 'validado_equipa' || r.status === 'devolvido')).slice(0, 20);
  const stageOf = (pathId: string) => stageName(catalog, paths.data?.find((p) => p.id === pathId)?.stage_key ?? '');
  return (
    <>
      <p className="faint prose">
        A validação de um trilho (reunião de Equipa) não conclui a etapa. A etapa conclui-se com a decisão do Conselho de Guias e a opinião final da
        Equipa de Animação; o reconhecimento público é registado à parte.
      </p>
      <h2 className="section-title">À espera do Conselho de Guias ou da opinião final</h2>
      <div className="card">
        {open.length === 0 ? <Empty title="Sem etapas à espera do Conselho de Guias." /> : open.map((sr) => (
          <StageDecision key={sr.id} sr={sr} member={names[sr.membership_id]} stage={stageOf(sr.stage_path_id)} />
        ))}
      </div>

      <h2 className="section-title">Reconhecimento por registar</h2>
      <div className="card">
        {toRecognize.length === 0 ? <Empty title="Sem reconhecimentos por registar." /> : (
          <ul className="list">
            {toRecognize.map((p) => (
              <li key={p.id}>
                <Link to={`/membros/${p.membership_id}?separador=historico`} className="list-item">
                  <Flag size={16} aria-hidden="true" />
                  <span className="grow"><strong>{names[p.membership_id]}</strong> · Etapa {stageName(catalog, p.stage_key)} concluída em {formatDate(p.completed_on)}</span>
                  <Badge label="Reconhecimento pendente" tone="attention" icon="clock" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="card more-card" open={ver === 'trilhos'} id="trilhos">
        <summary>Comunicação das decisões de trilhos das equipas</summary>
        <p className="faint prose">Decisões das reuniões de Equipa comunicadas ao Conselho de Guias. Se uma validação for manifestamente incoerente com a atitude do pioneiro, abre o pedido e regista uma devolução fundamentada.</p>
        {recent.length ? <RequestList requests={recent} catalog={catalog} names={names} base="/revisoes/pedido" /> : <Empty title="Sem decisões recentes." />}
      </details>
    </>
  );
}

export function StageDecision({ sr, member, stage }: { sr: StageRequest; member?: string; stage: string }) {
  const action = useAction();
  const [date, setDate] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [decision, setDecision] = useState<'favoravel' | 'desfavoravel'>('favoravel');
  const [opinion, setOpinion] = useState<'confirmada' | 'nao_confirmada'>('confirmada');
  const diverges = sr.status === 'decidido_conselho' && ((opinion === 'confirmada') !== (sr.council_decision === 'favoravel'));
  const needComment = sr.status === 'submetido' ? decision === 'desfavoravel' : diverges || opinion === 'nao_confirmada';
  return (
    <div className="card flat">
      <div className="row between">
        <p style={{ margin: 0 }}><strong>{member}</strong> · Etapa {stage}</p>
        <Badge {...stageRequestLabel[sr.status]} />
      </div>
      <dl className="meta compact-meta">
        <dt>Pedido</dt><dd>{formatDate(sr.requested_at)}</dd>
        <dt>Decisão do Conselho de Guias</dt>
        <dd>{sr.council_decision ? `${sr.council_decision === 'favoravel' ? 'Favorável' : 'Desfavorável'} (${formatDate(sr.council_date)})` : 'Por registar'}</dd>
        <dt>Opinião final da Equipa de Animação</dt>
        <dd>{sr.final_opinion ? `${sr.final_opinion === 'confirmada' ? 'Confirmada' : 'Não confirmada'} (${formatDate(sr.final_date)})` : 'Por registar'}</dd>
        <dt>Reconhecimento</dt><dd>Registado à parte, depois de concluída</dd>
      </dl>
      {sr.council_comment && <div className="quote">{sr.council_comment}</div>}
      <ErrorBox error={action.error} />
      {action.success ? <Notice kind="success">{action.success}</Notice> : (
        <>
          {sr.status === 'submetido' ? (
            <fieldset>
              <legend>Decisão do Conselho de Guias</legend>
              <div className="radio-cards">
                <label className="radio-card"><input type="radio" checked={decision === 'favoravel'} onChange={() => setDecision('favoravel')} /> Favorável</label>
                <label className="radio-card"><input type="radio" checked={decision === 'desfavoravel'} onChange={() => setDecision('desfavoravel')} /> Desfavorável</label>
              </div>
            </fieldset>
          ) : (
            <fieldset>
              <legend>Opinião final da Equipa de Animação</legend>
              <div className="radio-cards">
                <label className="radio-card"><input type="radio" checked={opinion === 'confirmada'} onChange={() => setOpinion('confirmada')} /> Confirmar a etapa</label>
                <label className="radio-card"><input type="radio" checked={opinion === 'nao_confirmada'} onChange={() => setOpinion('nao_confirmada')} /> Não confirmar</label>
              </div>
              {diverges && <Notice kind="warn"><p className="prose">A opinião diverge do Conselho de Guias: fundamenta de forma construtiva e explica-a ao Conselho, à Equipa e ao pioneiro.</p></Notice>}
            </fieldset>
          )}
          <Field label="Data" htmlFor={`d-${sr.id}`}>
            <input id={`d-${sr.id}`} type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={needComment ? 'Fundamentação (obrigatória)' : 'Comentário (opcional)'} htmlFor={`t-${sr.id}`}>
            <textarea id={`t-${sr.id}`} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <ConfirmButton className="btn" confirmLabel="Registar" disabled={action.busy || !date || (needComment && !comment.trim())}
            description={sr.status === 'submetido' ? undefined : opinion === 'confirmada' ? 'A etapa fica concluída; o reconhecimento público regista-se depois.' : 'A etapa continua em curso.'}
            onConfirm={() => action.run(() => sr.status === 'submetido'
              ? call('record_council_stage_decision', { p_stage_request: sr.id, p_decision: decision, p_date: date, p_comment: comment })
              : call('record_final_opinion', { p_stage_request: sr.id, p_opinion: opinion, p_date: date, p_comment: comment }), 'Decisão registada.')}>
            {sr.status === 'submetido' ? 'Registar decisão do Conselho' : 'Registar opinião final'}
          </ConfirmButton>
        </>
      )}
    </div>
  );
}
