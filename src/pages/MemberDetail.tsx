import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { History } from 'lucide-react';
import { memberPosition, milestoneByKey, STATE_LABEL } from '../lib/caminho';
import { useQuery } from '@tanstack/react-query';
import { useActiveSection } from '../lib/session';
import { useMembers, useProgress, useTeams } from '../lib/hooks';
import { call, fetchMeritStatus, type MemberRow } from '../lib/api';
import { useAction } from '../lib/useAction';
import { nextAction, openPath, stageSummary } from '../lib/progress';
import { CATEGORY_LABEL, progressCounts, trailCategory } from '../lib/meuprogresso';
import { formatDate, functionLabel, todayIso } from '../lib/labels';
import type { MemberProgress, StagePath } from '../lib/types';
import { Avatar, Badge, ConfirmButton, ErrorBox, Field, Loading, Meter, Notice } from '../components/ui';
import { Crumbs } from '../components/nav';
import { FaceisSummary } from '../components/caminho/Faceis';
import { StagePanel, stageName } from '../components/StagePanel';
import { RequestList } from '../components/RequestList';
import { ChoiceDecision } from './Leaders';
import NotFound from './NotFound';
import { RegisterPrevious } from '../components/RegisterPrevious';
import { TrailPicker } from '../components/TrailPicker';
import { DateInput } from '../components/DateInput';

const TABS = [
  { key: 'resumo', label: 'Resumo' },
  { key: 'etapa', label: 'Etapa' },
  { key: 'trilhos', label: 'Trilhos' },
  { key: 'historico', label: 'Histórico' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function MemberDetail() {
  const { id } = useParams();
  const s = useActiveSection();
  const [params, setParams] = useSearchParams();
  const members = useMembers(s.membership.section_id);
  const teams = useTeams(s.membership.section_id);
  const q = useProgress(id);
  const tab = (TABS.find((t) => t.key === params.get('separador'))?.key ?? 'resumo') as TabKey;
  if (members.isLoading || q.isLoading) return <Loading />;
  const member = members.data?.find((m) => m.id === id);
  if (!member || q.error || !q.data) return q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : <NotFound />;
  const p = q.data;
  const team = teams.data?.find((t) => t.id === member.team_id);
  const pos = memberPosition(p, s.catalog);
  const name = member.profiles?.full_name ?? 'Membro';
  const setTab = (k: TabKey) => {
    const next = new URLSearchParams(params);
    next.set('separador', k);
    next.delete('registar');
    setParams(next, { replace: true });
  };
  // Ação dos dirigentes: abre o registo no separador Trilhos, junto aos trilhos do pioneiro.
  const openRegister = () => {
    const next = new URLSearchParams(params);
    next.set('separador', 'trilhos');
    next.set('registar', 'anterior');
    setParams(next, { replace: true });
    // Se o formulário já está na página (foi fechado), volta a abri-lo.
    const el = document.getElementById('registar-anterior') as HTMLDetailsElement | null;
    if (el) { el.open = true; el.scrollIntoView({ block: 'start' }); el.querySelector<HTMLElement>('select, textarea')?.focus({ preventScroll: true }); }
  };

  return (
    <>
      <Crumbs items={[{ label: 'Início', to: '/' }, { label: 'Caminho da secção', to: '/caminho' }, { label: name }]} />
      <header className="member-head">
        <Avatar name={name} photoPath={member.profiles?.photo_path} size="lg" />
        <div className="grow">
          <h1 style={{ margin: 0 }}>{name}</h1>
          <p className="faint" style={{ margin: 0 }}>
            {[member.profiles?.totem, member.function ? functionLabel[member.function] : null, team?.name].filter(Boolean).join(' · ')}
          </p>
          <Link to={`/caminho?pessoa=${member.id}`} className="stage-chip" style={{ marginTop: 6 }}>
            {milestoneByKey[pos.milestone].short} · {STATE_LABEL[pos.state].label}
          </Link>
        </div>
        {s.isDirigente && member.status === 'ativo' && (
          <button type="button" className="btn secondary member-action" onClick={openRegister}>
            <History size={18} aria-hidden="true" /> Registar progresso anterior
          </button>
        )}
      </header>

      <div className="tabs" role="tablist" aria-label="Separadores do percurso">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" className="tab" id={`sep-${t.key}`} aria-controls="sep-painel" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="sep-painel" aria-labelledby={`sep-${tab}`}>
        {tab === 'resumo' && <SummaryTab member={member} progress={p} />}
        {tab === 'etapa' && <StageTab member={member} progress={p} />}
        {tab === 'trilhos' && <TrailsTab member={member} progress={p} />}
        {tab === 'historico' && <HistoryTab member={member} progress={p} />}
      </div>
    </>
  );
}

/** Resumo: etapa atual, seis áreas e próximo passo (o resto está nos outros separadores). */
function SummaryTab({ member, progress }: { member: MemberRow; progress: MemberProgress }) {
  const s = useActiveSection();
  const counts = progressCounts(s.catalog, progress);
  const next = nextAction(s.catalog, progress, { kind: s.isDirigente ? 'dirigente' : 'guia', membershipId: member.id });
  return (
    <section className="card summary">
      <div className="summary-cols">
        <div>
          <h2>Etapa atual</h2>
          <p className="summary-main">{counts.stage?.name ?? 'Sem etapa aberta'}</p>
          {counts.stage && <p className="faint">{counts.stage.validated} de {counts.stage.areas} áreas com trilho validado nesta etapa</p>}
        </div>
        <div>
          <h2>Histórico reconhecido</h2>
          <p className="summary-main">{counts.validated} {counts.validated === 1 ? 'trilho validado' : 'trilhos validados'}</p>
          {counts.unassigned.length > 0 && <p className="faint">{counts.unassigned.length} sem etapa associada</p>}
        </div>
      </div>
      <h3 className="summary-sub">Áreas FACEIS</h3>
      <FaceisSummary catalog={s.catalog} progress={progress} trailHref={(k) => `/meu-progresso/trilho/${k}?pioneiro=${member.id}`} />
      <div className="next-line">
        <span className="faint">Próximo passo do pioneiro</span>
        <p style={{ margin: 0 }}><strong>{next.title}</strong></p>
        {next.detail && <p className="faint prose" style={{ margin: '2px 0 0' }}>{next.detail}</p>}
        {next.to && next.label && <Link to={next.to} className="btn" style={{ marginTop: 6 }}>{next.label}</Link>}
      </div>
    </section>
  );
}

/** Etapa em curso: escolhas, negociação, trilhos reconhecidos por associar e ações. */
function StageTab({ member, progress: p }: { member: MemberRow; progress: MemberProgress }) {
  const s = useActiveSection();
  const open = openPath(p.paths);
  const sum = open ? stageSummary(open, s.catalog, p) : null;
  const proposals = p.choices.filter((c) => c.status === 'proposta');
  const counts = progressCounts(s.catalog, p);
  return (
    <>
      {sum ? (
        <>
          <StagePanel summary={sum} catalog={s.catalog} />
          {s.isDirigente && <StageActions path={sum.path} />}
          {sum.ready && (s.isDirigente || s.isGuia) && <RequestStage pathId={sum.path.id} />}
        </>
      ) : (
        <div className="card"><p className="faint" style={{ margin: 0 }}>Sem etapa em curso.</p></div>
      )}
      {s.isDirigente && member.status === 'ativo' && !open && p.adhesion?.decided_on && p.adhesion.commitment_on && <OpenStage member={member} progress={p} />}

      {open && counts.unassigned.length > 0 && (
        <section className="card" aria-labelledby="h-sem-etapa">
          <h2 id="h-sem-etapa">Trilhos reconhecidos sem etapa</h2>
          <p className="faint prose">Já estão validados mas só contam para a etapa depois de propostos e confirmados na negociação. Nada é associado automaticamente.</p>
          <ul className="list">
            {counts.unassigned.map((t) => (
              <li key={t.id} className="list-item">
                <span className="grow">{t.name} <span className="faint">· {s.catalog.areaById.get(t.area_id)?.name}</span></span>
                {s.isDirigente && <ProposeOne pathId={open.id} trailId={t.id} progress={p} areaCode={s.catalog.areaById.get(t.area_id)?.code ?? ''} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.isDirigente && proposals.length > 0 && (
        <>
          <h2 className="section-title">Propostas por negociar</h2>
          {proposals.map((c) => (
            <ChoiceDecision key={c.id} choice={c} stage={stageName(s.catalog, p.paths.find((x) => x.id === c.stage_path_id)?.stage_key ?? '')} />
          ))}
        </>
      )}
      {s.isDirigente && open && <ProposeForMember pathId={open.id} progress={p} />}
    </>
  );
}

/** Proposta direta de um trilho já reconhecido para a etapa (fica a aguardar a negociação). */
function ProposeOne({ pathId, trailId, progress, areaCode }: { pathId: string; trailId: string; progress: MemberProgress; areaCode: string }) {
  const action = useAction();
  const areaTaken = progress.choices.some((c) => c.stage_path_id === pathId && c.area_code === areaCode && (c.status === 'confirmada' || c.status === 'proposta'));
  if (action.success) return <span className="faint">Proposto</span>;
  if (areaTaken) return <span className="faint">Área já com trilho</span>;
  return (
    <>
      {action.error && <span className="faint" role="alert">{String(action.error)}</span>}
      <button type="button" className="btn secondary" disabled={action.busy}
        onClick={() => action.run(() => call('propose_choice', { p_stage_path: pathId, p_trail: trailId, p_planned: null, p_replaces: null }), 'Proposto.')}>
        Propor para a etapa
      </button>
    </>
  );
}

/** Catálogo pessoal: os 18 trilhos com o estado de cada um. */
function TrailsTab({ member, progress }: { member: MemberRow; progress: MemberProgress }) {
  const s = useActiveSection();
  const [params] = useSearchParams();
  const register = params.get('registar') === 'anterior';
  const trail = params.get('trilho');
  const initialTrail = trail ? s.catalog.trailByKey.get(trail)?.id : undefined;
  return (
    <>
      {s.isDirigente && member.status === 'ativo' && (
        <RegisterPrevious member={member} open={register} initialTrail={initialTrail}
          taken={() => new Set(progress.requests.filter((r) => r.status !== 'recusado' && r.status !== 'cancelado').map((r) => r.trail_key))} />
      )}
      <div className="card">
      {s.catalog.areas.map((a) => (
        <div key={a.id} style={{ marginBottom: 8 }}>
          <h3 className="row" style={{ margin: '6px 0 0' }}><span className="area-code" aria-hidden="true">{a.code}</span> {a.name}</h3>
          <ul className="list">
            {a.catalog_trails.map((t) => {
              const cat = trailCategory(t, progress);
              return (
                <li key={t.id}>
                  <Link to={`/meu-progresso/trilho/${t.key}?pioneiro=${member.id}`} className="list-item">
                    <span className="grow">{t.name}</span>
                    <Badge {...CATEGORY_LABEL[cat]} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      </div>
    </>
  );
}

/** Histórico: adesão, Promessa, etapas concluídas, pedidos, reconhecimentos e mérito. */
function HistoryTab({ member, progress: p }: { member: MemberRow; progress: MemberProgress }) {
  const s = useActiveSection();
  const done = [...p.paths].filter((x) => x.status === 'concluida').sort((a, b) => a.stage_ordinal - b.stage_ordinal);
  return (
    <>
      <AdhesionCard member={member} progress={p} />
      {done.map((path) => (
        <div key={path.id}>
          <StagePanel summary={stageSummary(path, s.catalog, p)} catalog={s.catalog} />
          {s.isDirigente && <StageActions path={path} />}
        </div>
      ))}
      <h2 className="section-title">Pedidos</h2>
      <div className="card">
        {p.requests.length ? <RequestList requests={p.requests} catalog={s.catalog} base="/revisoes/pedido" /> : <p className="faint" style={{ margin: 0 }}>Sem pedidos.</p>}
      </div>
      <div id="merito" />
      <MeritPanel member={member} progress={p} />
    </>
  );
}

function AdhesionCard({ member, progress }: { member: MemberRow; progress: MemberProgress }) {
  const s = useActiveSection();
  const action = useAction();
  const a = progress.adhesion;
  const [decided, setDecided] = useState(a?.decided_on ?? todayIso());
  const [commitment, setCommitment] = useState(a?.commitment_on ?? '');
  const [notes, setNotes] = useState(a?.notes ?? '');
  const [historical, setHistorical] = useState(a?.is_historical ?? false);
  const [editing, setEditing] = useState(false);
  const complete = !!a?.decided_on;
  // Só assinala; nunca corrige dados existentes automaticamente.
  const outOfOrder = !!(a?.decided_on && a.commitment_on && a.commitment_on < a.decided_on);
  const formOutOfOrder = !!(commitment && decided && commitment < decided);
  const needsNotes = (formOutOfOrder || historical) && !notes.trim();
  return (
    <section className="card">
      <h2>Início de Pista e Promessa</h2>
      <dl className="meta">
        <dt>Data de adesão</dt><dd>{a?.decided_on ? formatDate(a.decided_on) : 'Por registar'}</dd>
        <dt>Data da Promessa</dt><dd>{a?.commitment_on ? formatDate(a.commitment_on) : 'Por registar'}</dd>
        {a?.is_historical && (<><dt>Origem</dt><dd>Registo retroativo</dd></>)}
      </dl>
      {outOfOrder && (
        <Notice kind="warn">
          <p className="prose">A Promessa ({formatDate(a!.commitment_on)}) está registada antes da adesão ({formatDate(a!.decided_on)}). Normalmente acontece depois (pp. 7 e 10). Revê as datas{a?.notes ? '; a fundamentação está nas notas.' : ' ou fundamenta o registo nas notas.'}</p>
        </Notice>
      )}
      {a?.notes && <div className="quote" style={{ marginTop: 8 }}>{a.notes}</div>}
      {s.isDirigente && (
        <>
          <ErrorBox error={action.error} />
          {action.success && <Notice kind="success">{action.success}</Notice>}
          {complete && !editing ? (
            <button type="button" className="btn ghost" onClick={() => setEditing(true)}>{a?.commitment_on ? 'Corrigir' : 'Registar a Promessa'}</button>
          ) : (
            <div style={{ marginTop: 10 }}>
              <p className="faint prose">A data de adesão é o dia em que passou a pioneiro. Com a Promessa registada, a etapa do Conhecimento abre sozinha (p. 10).</p>
              <div className="grid-2">
                <Field label="Data de adesão (passagem a pioneiro)" htmlFor="ad-d"><DateInput id="ad-d" max={todayIso()} value={decided} onChange={(e) => setDecided(e.target.value)} /></Field>
                <Field label="Data da Promessa (se já aconteceu)" htmlFor="ad-c"><DateInput id="ad-c" max={todayIso()} value={commitment} onChange={(e) => setCommitment(e.target.value)} /></Field>
              </div>
              {formOutOfOrder && <Notice kind="warn"><p className="prose">A Promessa fica antes da adesão. Confirma as datas ou explica nas notas por que razão o registo é assim.</p></Notice>}
              <label className="checkbox"><input type="checkbox" checked={historical} onChange={(e) => setHistorical(e.target.checked)} /> Registo retroativo (anterior à aplicação)</label>
              <Field label={formOutOfOrder || historical ? 'Fundamentação (obrigatória)' : 'Notas (opcional)'} htmlFor="ad-n"><textarea id="ad-n" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 70 }} /></Field>
              <button type="button" className="btn" disabled={action.busy || !decided || needsNotes}
                onClick={async () => {
                  const r = await action.run(() => call('record_adhesion', { p_membership: member.id, p_decided_on: decided, p_commitment_on: commitment || null, p_notes: notes, p_is_historical: historical }), 'Registo guardado.');
                  if (r.ok) setEditing(false);
                }}>
                Guardar
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function OpenStage({ member, progress }: { member: MemberRow; progress: MemberProgress }) {
  const s = useActiveSection();
  const action = useAction();
  const done = progress.paths.filter((x) => x.status === 'concluida').map((x) => x.stage_ordinal);
  const next = s.catalog.stages.filter((st) => st.kind === 'progresso').find((st) => !done.includes(st.ordinal));
  const [insignia, setInsignia] = useState(todayIso());
  if (!next) return null;
  return (
    <section className="card flat">
      <h3>Abrir a etapa {next.name}</h3>
      <p className="faint prose">A insígnia de progresso é entregue no início da etapa. Podes registar a data agora ou mais tarde.</p>
      <ErrorBox error={action.error} />
      <Field label="Entrega da insígnia (opcional)" htmlFor="ins"><DateInput id="ins" max={todayIso()} value={insignia} onChange={(e) => setInsignia(e.target.value)} /></Field>
      <button type="button" className="btn" disabled={action.busy}
        onClick={() => action.run(() => call('open_stage', { p_membership: member.id, p_stage_key: next.key, p_insignia_on: insignia || null }), 'Etapa aberta.')}>
        Abrir etapa
      </button>
    </section>
  );
}

function StageActions({ path }: { path: StagePath }) {
  const action = useAction();
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [declare, setDeclare] = useState('');
  return (
    <details className="card flat" style={{ marginTop: -6 }}>
      <summary>Registos da etapa</summary>
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      <Field label="Data" htmlFor={`sd-${path.id}`}><DateInput id={`sd-${path.id}`} max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      {!path.insignia_delivered_on && (
        <button type="button" className="btn secondary" disabled={action.busy}
          onClick={() => action.run(() => call('record_insignia', { p_stage_path: path.id, p_date: date }), 'Entrega da insígnia registada.')}>
          Registar entrega da insígnia
        </button>
      )}
      {path.status === 'concluida' && !path.recognized_on && (
        <>
          <Field label="Nota do reconhecimento (opcional)" htmlFor={`rn-${path.id}`}><input id={`rn-${path.id}`} type="text" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <button type="button" className="btn secondary" disabled={action.busy}
            onClick={() => action.run(() => call('record_recognition', { p_stage_path: path.id, p_date: date, p_note: note }), 'Reconhecimento registado.')}>
            Registar reconhecimento público
          </button>
        </>
      )}
      {path.status === 'em_curso' && (
        <>
          <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '16px 0' }} />
          <p className="faint prose">Declarar como concluída uma etapa vivida antes da aplicação. Exige um trilho validado ou reconhecido em cada área atribuído a esta etapa, e uma fundamentação.</p>
          <Field label="Fundamentação" htmlFor={`dc-${path.id}`}><textarea id={`dc-${path.id}`} value={declare} onChange={(e) => setDeclare(e.target.value)} style={{ minHeight: 70 }} /></Field>
          <ConfirmButton confirmLabel="Declarar etapa anterior" disabled={action.busy || !declare.trim()}
            onConfirm={() => action.run(() => call('declare_historical_stage', { p_stage_path: path.id, p_date: date, p_comment: declare }), 'Etapa anterior declarada.')}>
            Declarar etapa anterior concluída
          </ConfirmButton>
        </>
      )}
    </details>
  );
}

function RequestStage({ pathId }: { pathId: string }) {
  const action = useAction();
  return (
    <div className="card flat">
      <p>Todos os trilhos da etapa estão validados.</p>
      <ErrorBox error={action.error} />
      {action.success ? <Notice kind="success">{action.success}</Notice> : (
        <button type="button" className="btn" disabled={action.busy}
          onClick={() => action.run(() => call('request_stage_validation', { p_stage_path: pathId }), 'Pedido de validação da etapa criado.')}>
          Levar a etapa ao Conselho de Guias
        </button>
      )}
    </div>
  );
}

/** O dirigente pode também propor um trilho (fica a aguardar confirmação, como qualquer proposta). */
function ProposeForMember({ pathId, progress }: { pathId: string; progress: MemberProgress }) {
  const s = useActiveSection();
  const action = useAction();
  const [trail, setTrail] = useState('');
  const used = new Set(progress.choices.filter((c) => c.status === 'confirmada' || c.status === 'proposta').map((c) => c.trail_key));
  const takenAreas = new Set(progress.choices.filter((c) => c.stage_path_id === pathId && (c.status === 'confirmada' || c.status === 'proposta')).map((c) => c.area_code));
  const options = s.catalog.areas.filter((a) => !takenAreas.has(a.code));
  if (!options.length) return null;
  return (
    <details className="card flat">
      <summary>Propor trilho para a etapa</summary>
      <p className="faint prose">Inclui trilhos já validados ou reconhecidos que queiras atribuir a esta etapa (sem contar duas vezes). A proposta fica a aguardar a negociação.</p>
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      <TrailPicker catalog={s.catalog} id="pt" value={trail} onChange={setTrail} areas={options} available={(t) => !used.has(t.key)}
        describe={(t) => CATEGORY_LABEL[trailCategory(t, progress)].label.toLowerCase()} />
      <button type="button" className="btn secondary" disabled={!trail || action.busy}
        onClick={async () => { const r = await action.run(() => call('propose_choice', { p_stage_path: pathId, p_trail: trail, p_planned: null, p_replaces: null }), 'Proposta criada; confirma-a em «Propostas por negociar».'); if (r.ok) setTrail(''); }}>
        Propor
      </button>
    </details>
  );
}

function MeritPanel({ member, progress }: { member: MemberRow; progress: MemberProgress }) {
  const s = useActiveSection();
  const q = useQuery({ queryKey: ['merit', member.id], queryFn: () => fetchMeritStatus(member.id) });
  const action = useAction();
  const [date, setDate] = useState(todayIso());
  const [comment, setComment] = useState('');
  const [historical, setHistorical] = useState(false);
  const m = q.data;
  return (
    <section className="card">
      <h2>Anilha de mérito</h2>
      {m && (
        <>
          <Meter value={m.validated} max={m.total} label="Trilhos da secção" />
          <p style={{ marginTop: 8 }}>
            Última etapa: {m.last_stage_concluded ? 'concluída' : 'por concluir'} ·{' '}
            {m.eligible ? <Badge label="Elegível (calculado)" tone="ok" icon="check" /> : <Badge label="Ainda não elegível" tone="muted" icon="circle" />}
          </p>
        </>
      )}
      {progress.merit ? (
        <p>
          <strong>Atribuída</strong> em {formatDate(progress.merit.awarded_on)}
          {progress.merit.kind === 'historico' ? ' (declaração de mérito anterior)' : ''}.
          {progress.merit.comment && <><br /><span className="faint">{progress.merit.comment}</span></>}
        </p>
      ) : s.isDirigente && member.status === 'ativo' ? (
        <>
          <p className="faint prose">A elegibilidade é calculada; a atribuição é um registo próprio da Equipa de Animação.</p>
          <ErrorBox error={action.error} />
          {action.success && <Notice kind="success">{action.success}</Notice>}
          <Field label="Data de atribuição" htmlFor="md"><DateInput id="md" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          {!m?.eligible && (
            <label className="checkbox"><input type="checkbox" checked={historical} onChange={(e) => setHistorical(e.target.checked)} /> Declaração de mérito anterior (exige fundamentação)</label>
          )}
          <Field label={historical ? 'Fundamentação (obrigatória)' : 'Comentário (opcional)'} htmlFor="mc"><textarea id="mc" value={comment} onChange={(e) => setComment(e.target.value)} style={{ minHeight: 70 }} /></Field>
          <ConfirmButton className="btn" confirmLabel="Registar atribuição" disabled={action.busy || (!m?.eligible && (!historical || !comment.trim()))}
            onConfirm={() => action.run(() => call('award_merit', { p_membership: member.id, p_awarded_on: date, p_historical: historical, p_comment: comment }), 'Anilha de mérito registada.')}>
            Registar atribuição
          </ConfirmButton>
        </>
      ) : (
        <p className="faint">Ainda não atribuída.</p>
      )}
    </section>
  );
}
