import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { memberPosition, milestoneByKey, STATE_LABEL } from '../lib/caminho';
import { useQuery } from '@tanstack/react-query';
import { useActiveSection } from '../lib/session';
import { useMembers, useProgress, useTeams } from '../lib/hooks';
import { call, fetchMeritStatus, type MemberRow } from '../lib/api';
import { useAction } from '../lib/useAction';
import { openPath, stageSummary, trailState } from '../lib/progress';
import { formatDate, functionLabel, todayIso, trailStateLabel } from '../lib/labels';
import type { MemberProgress, StagePath } from '../lib/types';
import { Avatar, Badge, ConfirmButton, ErrorBox, Field, Loading, Meter, Notice, PageTitle } from '../components/ui';
import { StagePanel, stageName } from '../components/StagePanel';
import { RequestList } from '../components/RequestList';
import { ChoiceDecision } from './Leaders';
import NotFound from './NotFound';

export default function MemberDetail() {
  const { id } = useParams();
  const s = useActiveSection();
  const members = useMembers(s.membership.section_id);
  const teams = useTeams(s.membership.section_id);
  const q = useProgress(id);
  if (members.isLoading || q.isLoading) return <Loading />;
  const member = members.data?.find((m) => m.id === id);
  if (!member || q.error || !q.data) return q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : <NotFound />;
  const p = q.data;
  const team = teams.data?.find((t) => t.id === member.team_id);
  const summaries = [...p.paths].sort((a, b) => a.stage_ordinal - b.stage_ordinal).map((x) => stageSummary(x, s.catalog, p));
  const open = openPath(p.paths);
  const proposals = p.choices.filter((c) => c.status === 'proposta');

  return (
    <>
      <PageTitle title={member.profiles?.full_name ?? 'Membro'} back={true} />
      <div className="card row">
        <Avatar name={member.profiles?.full_name ?? '?'} photoPath={member.profiles?.photo_path} size="lg" />
        <div className="grow">
          {member.profiles?.totem && <p style={{ margin: 0 }}>{member.profiles.totem}</p>}
          <p className="faint" style={{ margin: 0 }}>{member.function ? functionLabel[member.function] : ''}{team ? ` · ${team.name}` : ''}</p>
          {(() => {
            const pos = memberPosition(p, s.catalog);
            return (
              <Link to={`/caminho?vista=seccao&marco=${pos.milestone}&pessoa=${member.id}`} className="stage-chip" style={{ marginTop: 6 }}>
                {milestoneByKey[pos.milestone].short} · {STATE_LABEL[pos.state].label}
              </Link>
            );
          })()}
        </div>
      </div>

      <AdhesionCard member={member} progress={p} />

      {summaries.map((sum) => (
        <div key={sum.path.id}>
          <StagePanel summary={sum} catalog={s.catalog} />
          {s.isDirigente && <StageActions path={sum.path} />}
          {sum.ready && (s.isDirigente || s.isGuia) && <RequestStage pathId={sum.path.id} />}
        </div>
      ))}
      {s.isDirigente && member.status === 'ativo' && !open && p.adhesion?.decided_on && p.adhesion.commitment_on && <OpenStage member={member} progress={p} />}
      {s.isDirigente && member.status === 'ativo' && p.adhesion?.commitment_on && <RecognizeInNegotiation member={member} progress={p} />}

      {s.isDirigente && proposals.length > 0 && (
        <>
          <h2 className="section-title">Propostas por negociar</h2>
          {proposals.map((c) => (
            <ChoiceDecision key={c.id} choice={c} stage={stageName(s.catalog, p.paths.find((x) => x.id === c.stage_path_id)?.stage_key ?? '')} />
          ))}
        </>
      )}
      {s.isDirigente && open && <ProposeForMember pathId={open.id} progress={p} />}

      <h2 className="section-title">Trilhos</h2>
      <div className="card">
        {s.catalog.areas.map((a) => (
          <div key={a.id} style={{ marginBottom: 10 }}>
            <strong>{a.name}</strong>
            <ul className="list">
              {a.catalog_trails.map((t) => {
                const st = trailState(t, p);
                return (
                  <li key={t.id} className="list-item" style={{ minHeight: 44 }}>
                    <span className="grow">{t.name}</span>
                    <Badge {...trailStateLabel[st.state]} />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <h2 className="section-title">Pedidos</h2>
      <div className="card">
        {p.requests.length ? <RequestList requests={p.requests} catalog={s.catalog} base="/revisoes/pedido" /> : <p className="faint">Sem pedidos.</p>}
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
  const [traced, setTraced] = useState(a?.profile_traced_on ?? todayIso());
  const [decided, setDecided] = useState(a?.decided_on ?? todayIso());
  const [commitment, setCommitment] = useState(a?.commitment_on ?? '');
  const [notes, setNotes] = useState(a?.notes ?? '');
  const [historical, setHistorical] = useState(a?.is_historical ?? false);
  const [editing, setEditing] = useState(false);
  const complete = !!a?.decided_on;
  return (
    <section className="card">
      <h2>Início de Pista e Promessa</h2>
      <dl className="meta">
        <dt>Perfil traçado (Equipa de Animação)</dt><dd>{a?.profile_traced_on ? formatDate(a.profile_traced_on) : 'Por registar'}</dd>
        <dt>Decisão sobre a adesão (Conselho de Guias)</dt><dd>{a?.decided_on ? formatDate(a.decided_on) : 'Pendente'}</dd>
        <dt>Promessa / Investidura</dt><dd>{a?.commitment_on ? formatDate(a.commitment_on) : 'Por registar'}</dd>
        {a?.is_historical && (<><dt>Origem</dt><dd>Registo anterior</dd></>)}
      </dl>
      {a?.notes && <div className="quote" style={{ marginTop: 8 }}>{a.notes}</div>}
      {s.isDirigente && (
        <>
          <ErrorBox error={action.error} />
          {action.success && <Notice kind="success">{action.success}</Notice>}
          {!a?.profile_traced_on && !complete && (
            <div className="card flat" style={{ marginTop: 10 }}>
              <p className="faint">O perfil é traçado pela Equipa de Animação durante a adesão, por observação direta, com ajuda do Guia (pp. 4 e 7). Regista só a data; as observações não ficam na aplicação.</p>
              <div className="row">
                <input aria-label="Data do traçado do perfil" type="date" max={todayIso()} value={traced} onChange={(e) => setTraced(e.target.value)} style={{ maxWidth: 200 }} />
                <button type="button" className="btn secondary" disabled={action.busy || !traced}
                  onClick={() => action.run(() => call('record_profile_traced', { p_membership: member.id, p_date: traced }), 'Traçado do perfil registado.')}>
                  Registar perfil traçado
                </button>
              </div>
            </div>
          )}
          {complete && !editing ? (
            <button type="button" className="btn ghost" onClick={() => setEditing(true)}>{a?.commitment_on ? 'Corrigir' : 'Registar a Promessa / Investidura'}</button>
          ) : (
            <div style={{ marginTop: 10 }}>
              <p className="faint">A decisão sobre a adesão é tomada em Conselho de Guias, com a presença de toda a Equipa de Animação (p. 7). A primeira etapa só abre depois da Promessa/Investidura (p. 10).</p>
              <div className="grid-2">
                <Field label="Data da decisão sobre a adesão" htmlFor="ad-d"><input id="ad-d" type="date" max={todayIso()} value={decided} onChange={(e) => setDecided(e.target.value)} /></Field>
                <Field label="Promessa / Investidura (se já aconteceu)" htmlFor="ad-c"><input id="ad-c" type="date" max={todayIso()} value={commitment} onChange={(e) => setCommitment(e.target.value)} /></Field>
              </div>
              <Field label="Notas (opcional)" htmlFor="ad-n"><textarea id="ad-n" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 70 }} /></Field>
              <label className="checkbox"><input type="checkbox" checked={historical} onChange={(e) => setHistorical(e.target.checked)} /> Registo de adesão anterior à aplicação</label>
              <button type="button" className="btn" disabled={action.busy || !decided}
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

/** Reconhecimento, na negociação, de trilhos já alcançados (p. 10). */
function RecognizeInNegotiation({ member, progress }: { member: MemberRow; progress: MemberProgress }) {
  const s = useActiveSection();
  const action = useAction();
  const [trail, setTrail] = useState('');
  const [comment, setComment] = useState('');
  const [ref, setRef] = useState('');
  const active = new Set(progress.requests.filter((r) => r.status !== 'recusado' && r.status !== 'cancelado').map((r) => r.trail_key));
  return (
    <details className="card flat">
      <summary>Reconhecer na negociação um trilho já alcançado</summary>
      <p className="faint" style={{ marginTop: 8 }}>
        «A Equipa de Animação deverá validar os trilhos que o elemento demonstre já ter atingido, desde que devidamente fundamentados»,
        informando a Equipa (Manual, p. 10). Fica registado com a fundamentação e conta como trilho validado.
      </p>
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      <Field label="Trilho" htmlFor="rn-t">
        <select id="rn-t" value={trail} onChange={(e) => setTrail(e.target.value)}>
          <option value="">Escolhe…</option>
          {s.catalog.areas.map((a) => (
            <optgroup key={a.id} label={a.name}>
              {a.catalog_trails.filter((t) => !active.has(t.key)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field label="Fundamentação (obrigatória)" htmlFor="rn-c"><textarea id="rn-c" value={comment} onChange={(e) => setComment(e.target.value)} style={{ minHeight: 70 }} /></Field>
      <Field label="Referência temporal (opcional)" htmlFor="rn-d"><input id="rn-d" type="date" max={todayIso()} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      <ConfirmButton className="btn" confirmLabel="Reconhecer" disabled={action.busy || !trail || !comment.trim()}
        description="O pioneiro e o guia da equipa são informados."
        onConfirm={async () => {
          const r = await action.run(() => call('recognize_in_negotiation', { p_membership: member.id, p_trail: trail, p_comment: comment, p_reference_date: ref || null }), 'Trilho reconhecido na negociação.');
          if (r.ok) { setTrail(''); setComment(''); setRef(''); }
        }}>
        Reconhecer trilho
      </ConfirmButton>
    </details>
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
      <p className="faint">A insígnia de progresso é entregue no início da etapa. Podes registar a data agora ou mais tarde.</p>
      <ErrorBox error={action.error} />
      <Field label="Entrega da insígnia (opcional)" htmlFor="ins"><input id="ins" type="date" max={todayIso()} value={insignia} onChange={(e) => setInsignia(e.target.value)} /></Field>
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
      <Field label="Data" htmlFor={`sd-${path.id}`}><input id={`sd-${path.id}`} type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
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
          <p className="faint">Declarar como concluída uma etapa vivida antes da aplicação. Exige um trilho validado ou reconhecido em cada área atribuído a esta etapa, e uma fundamentação.</p>
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
    <section className="card flat">
      <h3>Propor trilho para a etapa</h3>
      <p className="faint">Inclui trilhos já validados ou reconhecidos que queiras atribuir a esta etapa (sem contar duas vezes).</p>
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      <Field label="Trilho" htmlFor="pt">
        <select id="pt" value={trail} onChange={(e) => setTrail(e.target.value)}>
          <option value="">Escolhe…</option>
          {options.map((a) => (
            <optgroup key={a.id} label={a.name}>
              {a.catalog_trails.filter((t) => !used.has(t.key)).map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({trailStateLabel[trailState(t, progress).state].label.toLowerCase()})</option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <button type="button" className="btn secondary" disabled={!trail || action.busy}
        onClick={async () => { const r = await action.run(() => call('propose_choice', { p_stage_path: pathId, p_trail: trail, p_planned: null, p_replaces: null }), 'Proposta criada; confirma-a em «Propostas por negociar».'); if (r.ok) setTrail(''); }}>
        Propor
      </button>
    </section>
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
          <p className="faint">A elegibilidade é calculada; a atribuição é um registo próprio da Equipa de Animação.</p>
          <ErrorBox error={action.error} />
          {action.success && <Notice kind="success">{action.success}</Notice>}
          <Field label="Data de atribuição" htmlFor="md"><input id="md" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
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
