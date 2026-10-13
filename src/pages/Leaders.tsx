import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useActiveSection } from '../lib/session';
import { useMembers, useTeams } from '../lib/hooks';
import {
  call, fetchMeritStatus, fetchSectionChoices, fetchSectionRequests, fetchSectionStagePaths, fetchSectionStageRequests, type MemberRow,
} from '../lib/api';
import { useAction } from '../lib/useAction';
import { formatDate, functionLabel, stageRequestLabel, todayIso } from '../lib/labels';
import type { StageChoice, StageRequest } from '../lib/types';
import { Avatar, Badge, ConfirmButton, Empty, ErrorBox, Field, Loading, Notice, PageTitle } from '../components/ui';
import { RequestList } from '../components/RequestList';
import { stageName } from '../components/StagePanel';

const TABS = [
  ['seccao', 'Secção'],
  ['negociacao', 'Negociação'],
  ['conselho', 'Conselho de Guias'],
  ['pedidos', 'Pedidos'],
  ['historico', 'Progresso anterior'],
  ['merito', 'Mérito'],
] as const;

export default function Leaders({ tab: forced }: { tab?: string }) {
  const params = useParams();
  const tab = forced ?? params.tab ?? 'seccao';
  const { membership } = useActiveSection();
  const members = useMembers(membership.section_id);
  const progressMembers = (members.data ?? []).filter((m) => m.status === 'ativo' && (m.function === 'pioneiro' || m.function === 'guia'));

  return (
    <>
      <PageTitle title="Acompanhamento" subtitle="Acompanhamento da secção pela Equipa de Animação." />
      <nav className="tabs" aria-label="Secções do painel">
        {TABS.map(([k, label]) => (
          <Link key={k} to={`/acompanhamento/${k}`} className="tab" aria-current={tab === k ? 'page' : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      {members.isLoading ? <Loading /> : members.error ? <ErrorBox error={members.error} retry={members.refetch} /> : (
        <>
          {tab === 'seccao' && <SectionOverview members={progressMembers} />}
          {tab === 'negociacao' && <Negotiation members={progressMembers} />}
          {tab === 'conselho' && <Council members={progressMembers} />}
          {tab === 'pedidos' && <PendingRequests members={progressMembers} />}
          {tab === 'historico' && <HistoricRequests members={progressMembers} />}
          {tab === 'merito' && <Merit members={progressMembers} />}
        </>
      )}
    </>
  );
}

const nameMap = (members: MemberRow[]) => Object.fromEntries(members.map((m) => [m.id, m.profiles?.full_name ?? '']));

function SectionOverview({ members }: { members: MemberRow[] }) {
  const { membership, catalog } = useActiveSection();
  const teams = useTeams(membership.section_id);
  const ids = members.map((m) => m.id);
  const paths = useQuery({ queryKey: ['paths', ids], queryFn: () => fetchSectionStagePaths(ids), enabled: ids.length > 0 });
  const reqs = useQuery({ queryKey: ['section-requests', membership.section_id, 'all'], queryFn: () => fetchSectionRequests(membership.section_id) });
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

  const byTeam = new Map<string, MemberRow[]>();
  for (const m of members) {
    const k = m.team_id ?? 'sem';
    byTeam.set(k, [...(byTeam.get(k) ?? []), m]);
  }
  return (
    <>
      {members.length === 0 && <div className="card"><Empty title="Ainda não há pioneiros ativos na secção." /></div>}
      {[...byTeam.entries()].map(([teamId, list]) => (
        <section key={teamId} className="card">
          <h2>{teams.data?.find((t) => t.id === teamId)?.name ?? 'Sem equipa'}</h2>
          <ul className="list">
            {list.map((m) => {
              const open = paths.data?.find((p) => p.membership_id === m.id && p.status === 'em_curso');
              const done = paths.data?.filter((p) => p.membership_id === m.id && p.status === 'concluida').length ?? 0;
              const v = (reqs.data ?? []).filter((r) => r.membership_id === m.id && (r.status === 'validado_equipa' || r.status === 'aprovado')).length;
              return (
                <li key={m.id}>
                  <Link to={`/membros/${m.id}`} className="list-item">
                    <Avatar name={m.profiles?.full_name ?? '?'} photoPath={m.profiles?.photo_path} />
                    <span className="grow">
                      <strong>{m.profiles?.full_name}</strong>
                      {m.function === 'guia' && <span className="faint"> · {functionLabel.guia}</span>}
                      <br />
                      <span className="faint">
                        {open ? `Etapa ${stageName(catalog, open.stage_key)}` : done ? `${done} etapa(s) concluída(s)` : 'Desprendimento'} · {v}/{catalog.trailById.size} trilhos
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <div className="card flat">
        <h3>Exportar dados</h3>
        <p className="faint">Ficheiro JSON com os dados pedagógicos da secção (sem anexos). Guarda-o num local seguro: contém dados pessoais.</p>
        <ErrorBox error={action.error} />
        {action.success && <Notice kind="success">{action.success}</Notice>}
        <button type="button" className="btn secondary" disabled={action.busy} onClick={exportData}>
          <Download size={18} aria-hidden="true" /> Exportar
        </button>
      </div>
    </>
  );
}

function Negotiation({ members }: { members: MemberRow[] }) {
  const { catalog } = useActiveSection();
  const ids = members.map((m) => m.id);
  const choices = useQuery({ queryKey: ['choices', ids, 'proposta'], queryFn: () => fetchSectionChoices(ids, 'proposta'), enabled: ids.length > 0 });
  const paths = useQuery({ queryKey: ['paths', ids], queryFn: () => fetchSectionStagePaths(ids), enabled: ids.length > 0 });
  const names = nameMap(members);
  if (choices.isLoading) return <Loading />;
  if (choices.error) return <ErrorBox error={choices.error} retry={choices.refetch} />;
  const list = choices.data ?? [];
  return (
    <div className="card">
      <p className="faint">Propostas de escolha e de troca de trilhos. A decisão é tua, depois de conversares com o pioneiro.</p>
      {list.length === 0 ? <Empty title="Sem propostas por negociar." /> : list.map((c) => (
        <ChoiceDecision key={c.id} choice={c} member={names[c.membership_id]}
          stage={stageName(catalog, paths.data?.find((p) => p.id === c.stage_path_id)?.stage_key ?? '')} />
      ))}
    </div>
  );
}

export function ChoiceDecision({ choice, member, stage }: { choice: StageChoice; member?: string; stage: string }) {
  const { catalog } = useActiveSection();
  const action = useAction();
  const [comment, setComment] = useState('');
  const trail = catalog.trailById.get(choice.trail_id);
  const area = trail ? catalog.areaById.get(trail.area_id) : undefined;
  return (
    <div className="card flat">
      <p style={{ marginBottom: 4 }}>
        {member && <strong>{member} · </strong>}Etapa {stage} · {area?.name}
      </p>
      <p>
        {choice.replaces_choice_id ? 'Troca para ' : 'Proposta: '}
        <Link to={`/progresso/trilho/${trail?.key}`}>{trail?.name}</Link>
      </p>
      {choice.planned_opportunities && <div className="quote">{choice.planned_opportunities}</div>}
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

function Council({ members }: { members: MemberRow[] }) {
  const { membership, catalog } = useActiveSection();
  const ids = members.map((m) => m.id);
  const stageReqs = useQuery({ queryKey: ['stage-requests', ids], queryFn: () => fetchSectionStageRequests(ids), enabled: ids.length > 0 });
  const paths = useQuery({ queryKey: ['paths', ids], queryFn: () => fetchSectionStagePaths(ids), enabled: ids.length > 0 });
  const reqs = useQuery({ queryKey: ['section-requests', membership.section_id, 'all'], queryFn: () => fetchSectionRequests(membership.section_id) });
  const names = nameMap(members);
  if (stageReqs.isLoading || reqs.isLoading) return <Loading />;
  const open = (stageReqs.data ?? []).filter((s) => s.status === 'submetido' || s.status === 'decidido_conselho');
  const recent = (reqs.data ?? []).filter((r) => r.kind === 'normal' && (r.status === 'validado_equipa' || r.status === 'devolvido')).slice(0, 20);
  return (
    <>
      <h2 className="section-title">Validação de etapas</h2>
      <div className="card">
        {open.length === 0 ? <Empty title="Sem etapas à espera do Conselho de Guias." /> : open.map((sr) => (
          <StageDecision key={sr.id} sr={sr} member={names[sr.membership_id]}
            stage={stageName(catalog, paths.data?.find((p) => p.id === sr.stage_path_id)?.stage_key ?? '')} />
        ))}
      </div>
      <h2 className="section-title">Decisões das reuniões de Equipa (comunicação ao Conselho)</h2>
      <div className="card">
        <p className="faint">Se uma validação for manifestamente incoerente com a atitude do pioneiro, abre o pedido e regista uma devolução fundamentada.</p>
        {recent.length ? <RequestList requests={recent} catalog={catalog} names={names} base="/revisoes/pedido" /> : <Empty title="Sem decisões recentes." />}
      </div>
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
      <p className="faint">Pedido em {formatDate(sr.requested_at)}</p>
      {sr.council_decision && (
        <p>
          Conselho de Guias ({formatDate(sr.council_date)}): <strong>{sr.council_decision === 'favoravel' ? 'favorável' : 'desfavorável'}</strong>
          {sr.council_comment && <><br /><span className="quote" style={{ display: 'block' }}>{sr.council_comment}</span></>}
        </p>
      )}
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
              {diverges && <Notice kind="warn"><p>A opinião diverge do Conselho de Guias: fundamenta de forma construtiva e explica-a ao Conselho, à Equipa e ao pioneiro.</p></Notice>}
            </fieldset>
          )}
          <Field label="Data" htmlFor={`d-${sr.id}`}>
            <input id={`d-${sr.id}`} type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={needComment ? 'Fundamentação (obrigatória)' : 'Comentário (opcional)'} htmlFor={`t-${sr.id}`}>
            <textarea id={`t-${sr.id}`} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <ConfirmButton className="btn" confirmLabel="Registar" disabled={action.busy || !date || (needComment && !comment.trim())}
            description={sr.status === 'submetido' ? undefined : opinion === 'confirmada' ? 'A etapa fica concluída.' : 'A etapa continua em curso.'}
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

function PendingRequests({ members }: { members: MemberRow[] }) {
  const { membership, catalog } = useActiveSection();
  const reqs = useQuery({ queryKey: ['section-requests', membership.section_id, 'pendentes'], queryFn: () => fetchSectionRequests(membership.section_id, ['submetido', 'em_revisao']) });
  const names = nameMap(members);
  if (reqs.isLoading) return <Loading />;
  const normal = (reqs.data ?? []).filter((r) => r.kind === 'normal');
  const guias = new Set(members.filter((m) => m.function === 'guia').map((m) => m.id));
  const fromGuias = normal.filter((r) => guias.has(r.membership_id));
  const others = normal.filter((r) => !guias.has(r.membership_id));
  return (
    <>
      <h2 className="section-title">Pedidos de guias (registo pela Equipa de Animação)</h2>
      <div className="card">
        <p className="faint">O guia não regista a decisão sobre o próprio pedido. Regista aqui a decisão da reunião de Equipa.</p>
        {fromGuias.length ? <RequestList requests={fromGuias} catalog={catalog} names={names} base="/revisoes/pedido" /> : <Empty title="Sem pedidos de guias." />}
      </div>
      <h2 className="section-title">Outros pedidos à espera da reunião de Equipa</h2>
      <div className="card">
        {others.length ? <RequestList requests={others} catalog={catalog} names={names} base="/revisoes/pedido" /> : <Empty title="Sem pedidos pendentes." />}
      </div>
    </>
  );
}

function HistoricRequests({ members }: { members: MemberRow[] }) {
  const { membership, catalog, settings } = useActiveSection();
  const reqs = useQuery({ queryKey: ['section-requests', membership.section_id, 'all'], queryFn: () => fetchSectionRequests(membership.section_id) });
  const names = nameMap(members);
  if (reqs.isLoading) return <Loading />;
  const hist = (reqs.data ?? []).filter((r) => r.kind === 'historico');
  const pending = hist.filter((r) => r.status === 'submetido' || r.status === 'em_revisao');
  return (
    <>
      <Notice kind="info">
        <p>
          Registo de progresso anterior: <strong>{settings?.historical_progress_enabled ? 'ativo' : 'desativado'}</strong>. Pedidos já submetidos continuam avaliáveis.
          Declarar uma etapa anterior ou a anilha faz-se no percurso de cada membro.
        </p>
      </Notice>
      <h2 className="section-title">Por decidir</h2>
      <div className="card">{pending.length ? <RequestList requests={pending} catalog={catalog} names={names} base="/revisoes/pedido" /> : <Empty title="Sem pedidos por decidir." />}</div>
      <h2 className="section-title">Decididos</h2>
      <div className="card">
        {hist.filter((r) => !pending.includes(r)).length ? (
          <RequestList requests={hist.filter((r) => !pending.includes(r))} catalog={catalog} names={names} base="/revisoes/pedido" />
        ) : <Empty title="Sem histórico." />}
      </div>
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
          <span className="faint">{q.data ? `${q.data.validated}/${q.data.total} trilhos · última etapa ${q.data.last_stage_concluded ? 'concluída' : 'por concluir'}` : '…'}</span>
        </span>
        {q.data?.eligible ? <Badge label="Elegível" tone="ok" icon="check" /> : <Badge label="Ainda não elegível" tone="muted" icon="circle" />}
      </Link>
    </li>
  );
}

function Merit({ members }: { members: MemberRow[] }) {
  return (
    <div className="card">
      <p className="faint">
        Elegibilidade calculada: todos os trilhos da secção validados e a última etapa (Construção) concluída. A atribuição efetiva é registada por um
        dirigente, com data, no percurso de cada membro. Não depende de anos na secção, fotografias ou pontos.
      </p>
      {members.length ? <ul className="list">{members.map((m) => <MeritRow key={m.id} m={m} />)}</ul> : <Empty title="Sem membros." />}
    </div>
  );
}
