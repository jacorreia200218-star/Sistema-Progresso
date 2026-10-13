// Peças da tab Caminho: marcos por área, ciclo da etapa, estado pessoal num
// marco, lista de pessoas e resumo de um pioneiro.
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CircleDashed, Clock } from 'lucide-react';
import type { Catalog, MemberProgress } from '../../lib/types';
import type { PathMember } from '../../lib/api';
import {
  areaMarkers, memberPosition, milestoneByKey, stageCycle, stageNeeds, stageStatusFor, STATE_LABEL, STAGE_KEYS,
  type MilestoneKey, type Phase, type PositionState,
} from '../../lib/caminho';
import { nextAction } from '../../lib/progress';
import { formatDate } from '../../lib/labels';
import { Avatar, Badge } from '../ui';

export function stateBadge(state: string) {
  const s = STATE_LABEL[state as PositionState];
  if (!s) return <Badge label="Por iniciar" tone="muted" icon="circle" />;
  const icon = s.kind === 'reconhecida' || s.kind === 'concluida' ? 'check' : s.kind === 'decisao' ? 'clock' : s.kind === 'requisitos' ? 'check' : 'compass';
  return <Badge label={s.label} tone={s.tone} icon={icon} />;
}

/** Marcos acumulados por área FACEIS (1, 2 e 3 trilhos validados — p. 14). */
export function AreaMarkers({ progress, catalog }: { progress: MemberProgress; catalog: Catalog }) {
  const markers = areaMarkers(progress, catalog);
  return (
    <ul className="area-markers" aria-label="Trilhos validados por área">
      {markers.map((m) => (
        <li key={m.code}>
          <span className="area-code" aria-hidden="true">{m.code}</span>
          <span className="grow">
            <span className="am-name">{m.name}</span>
            <span className="pips" aria-hidden="true">
              {Array.from({ length: m.total }, (_, i) => <span key={i} className={i < m.validated ? 'pip on' : 'pip'} />)}
            </span>
          </span>
          <span className="faint am-count">{m.validated} de {m.total}<span className="sr-only"> trilhos validados</span></span>
        </li>
      ))}
    </ul>
  );
}

export function CycleSteps({ phases }: { phases: Phase[] }) {
  return (
    <ol className="cycle-steps" aria-label="Ciclo da etapa">
      {phases.map((ph) => (
        <li key={ph.key} className={`cs-${ph.status}`}>
          <span className="cs-icon" aria-hidden="true">
            {ph.status === 'feito' ? <Check size={16} /> : ph.status === 'atual' ? <Clock size={16} /> : <CircleDashed size={16} />}
          </span>
          <span>
            <strong>{ph.label}</strong>
            <span className="sr-only"> — {ph.status === 'feito' ? 'feito' : ph.status === 'atual' ? 'em curso' : 'por fazer'}</span>
            <br />
            <span className="faint">{ph.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Três dimensões que nunca se confundem: requisitos, decisão pedagógica, reconhecimento. */
function TriState({ req, decision, recognition }: { req: [boolean, string]; decision: [boolean, string]; recognition: [boolean, string] }) {
  const row = (ok: boolean, title: string, text: string) => (
    <li className={ok ? 'tri-ok' : 'tri-no'}>
      <span aria-hidden="true">{ok ? <Check size={16} /> : <CircleDashed size={16} />}</span>
      <span><strong>{title}:</strong> {text}</span>
    </li>
  );
  return (
    <ul className="tri-state">
      {row(req[0], 'Requisitos educativos', req[1])}
      {row(decision[0], 'Decisão pedagógica', decision[1])}
      {row(recognition[0], 'Reconhecimento', recognition[1])}
    </ul>
  );
}

/** Estado pessoal num marco: o que está feito, em curso, pendente e o que falta. */
export function PersonalAtMilestone({ k, progress, catalog, self }: { k: MilestoneKey; progress: MemberProgress; catalog: Catalog; self: boolean }) {
  const pos = memberPosition(progress, catalog);
  const here = pos.milestone === k;
  const a = progress.adhesion;
  const you = self ? 'Estás' : 'Está';

  if (k === 'sinais_pista' || k === 'passagem') {
    return <p className="faint">Este momento não é registado na aplicação.</p>;
  }
  if (k === 'inicio_pista') {
    return (
      <div className="stack">
        {here ? <p className="here">{you} aqui · {stateBadge(pos.state)}</p> : <p><Badge label="Concluído" tone="ok" icon="check" /></p>}
        <ul className="tri-state">
          <li className={a?.profile_traced_on ? 'tri-ok' : 'tri-no'}>
            <span aria-hidden="true">{a?.profile_traced_on ? <Check size={16} /> : <CircleDashed size={16} />}</span>
            <span><strong>Perfil traçado pela Equipa de Animação:</strong> {a?.profile_traced_on ? formatDate(a.profile_traced_on) : 'por registar'}</span>
          </li>
          <li className={a?.decided_on ? 'tri-ok' : 'tri-no'}>
            <span aria-hidden="true">{a?.decided_on ? <Check size={16} /> : <CircleDashed size={16} />}</span>
            <span><strong>Decisão sobre a adesão (Conselho de Guias):</strong> {a?.decided_on ? formatDate(a.decided_on) : 'pendente'}</span>
          </li>
        </ul>
      </div>
    );
  }
  if (k === 'promessa') {
    const before = pos.milestone === 'inicio_pista';
    return (
      <div className="stack">
        {here ? <p className="here">{you} aqui · {stateBadge(pos.state)}</p> : before ? <p><Badge label="Por vir" tone="muted" icon="circle" /></p> : <p><Badge label="Feita" tone="ok" icon="check" /></p>}
        <ul className="tri-state">
          <li className={a?.commitment_on ? 'tri-ok' : 'tri-no'}>
            <span aria-hidden="true">{a?.commitment_on ? <Check size={16} /> : <CircleDashed size={16} />}</span>
            <span><strong>Promessa / Investidura:</strong> {a?.commitment_on ? formatDate(a.commitment_on) : 'por registar'}</span>
          </li>
        </ul>
        {pos.state === 'aguarda_etapa' && <p className="faint">A Equipa de Animação abre contigo a etapa do Conhecimento, na primeira negociação, e entrega a insígnia.</p>}
      </div>
    );
  }
  if (k === 'acampamento') {
    const done = progress.paths.filter((p) => p.status === 'concluida').length;
    return (
      <div className="stack">
        {here ? <p className="here">{you} aqui · {stateBadge(pos.state)}</p> : <p><Badge label="Por vir" tone="muted" icon="circle" /></p>}
        <TriState
          req={[done >= STAGE_KEYS.length, `${done} de ${STAGE_KEYS.length} etapas concluídas`]}
          decision={[done >= STAGE_KEYS.length, done >= STAGE_KEYS.length ? 'Construção validada' : 'Depende da validação da Construção']}
          recognition={[!!progress.merit, progress.merit ? `Anilha atribuída em ${formatDate(progress.merit.awarded_on)}` : 'Atribuição da anilha por registar pela Equipa de Animação']}
        />
      </div>
    );
  }
  // Etapas de progresso
  const st = stageStatusFor(k, progress, catalog);
  if (!st.summary) {
    return <p><Badge label="Por iniciar" tone="muted" icon="circle" /> <span className="faint">A insígnia é entregue no início da etapa.</span></p>;
  }
  const s = st.summary;
  const needs = stageNeeds(s, progress);
  const concluded = s.path.status === 'concluida';
  const phases = stageCycle(s, catalog.areas.length);
  return (
    <div className="stack">
      <p className="here">
        {concluded ? (self ? 'Concluíste esta etapa' : 'Etapa concluída') : `${you} nesta etapa`} · {stateBadge(st.state)}
      </p>
      <p className="faint">
        Insígnia entregue: {s.path.insignia_delivered_on ? formatDate(s.path.insignia_delivered_on) : 'por registar'}
        {s.path.completed_on && ` · Concluída: ${formatDate(s.path.completed_on)}${s.path.completion_kind === 'historico' ? ' (registo anterior)' : ''}`}
      </p>
      <TriState
        req={[s.validatedCount === catalog.areas.length, `${s.validatedCount} de ${catalog.areas.length} trilhos da etapa validados na Equipa`]}
        decision={[concluded, concluded ? 'Validada pelo Conselho de Guias com opinião final da Equipa de Animação' : s.openRequest ? (s.openRequest.status === 'submetido' ? 'Aguarda o Conselho de Guias' : 'Aguarda a opinião final da Equipa de Animação') : 'Ainda não pedida']}
        recognition={[!!s.path.recognized_on, s.path.recognized_on ? `Reconhecimento público em ${formatDate(s.path.recognized_on)}` : 'Por realizar (na celebração, depois de concluída)']}
      />
      <CycleSteps phases={phases} />
      {!concluded && (needs.todo || needs.waiting) && (
        <div className="needs">
          {needs.todo && <p><strong>{needs.todo}</strong></p>}
          {needs.waiting && <p className="muted">{needs.waiting}</p>}
        </div>
      )}
      {needs.done.length > 0 && <p className="faint">Validados nesta etapa: {needs.done.join(', ')}.</p>}
    </div>
  );
}

/** Lista de pessoas num marco, agrupadas pelo estado. */
export function PeopleAtMilestone({ people, hidden, onPick, teamName }: {
  people: PathMember[]; hidden: number; onPick: (id: string) => void; teamName: (id: string | null) => string;
}) {
  if (!people.length && !hidden) return <p className="faint">Ninguém neste momento.</p>;
  const groups = new Map<string, PathMember[]>();
  for (const p of people) groups.set(p.state, [...(groups.get(p.state) ?? []), p]);
  return (
    <div className="stack">
      {[...groups.entries()].map(([state, list]) => (
        <div key={state}>
          <div style={{ marginBottom: 6 }}>{stateBadge(state)}</div>
          <ul className="people-list">
            {list.map((p) => (
              <li key={p.membership_id}>
                <button type="button" className="person" onClick={() => onPick(p.membership_id)}>
                  <Avatar name={p.full_name} photoPath={p.photo_path} />
                  <span className="grow">
                    <strong>{p.full_name}{p.is_me ? ' (tu)' : ''}</strong>
                    <br />
                    <span className="faint">{teamName(p.team_id)}{p.function === 'guia' ? ' · Guia' : ''}</span>
                  </span>
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {hidden > 0 && (
        <p className="faint">
          {people.length ? 'E mais' : 'Estão aqui'} {hidden} pioneiro{hidden === 1 ? '' : 's'} da secção. Os nomes só aparecem a quem já acompanha o seu percurso.
        </p>
      )}
    </div>
  );
}

/** Resumo do percurso de um pioneiro (dados limitados pelas permissões no servidor). */
export function PersonSummary({ member, progress, catalog, canOpen, self }: {
  member: PathMember; progress: MemberProgress; catalog: Catalog; canOpen: boolean; self: boolean;
}) {
  const pos = memberPosition(progress, catalog);
  const m = milestoneByKey[pos.milestone];
  const action = self ? nextAction(catalog, progress) : null;
  return (
    <div className="stack">
      <div className="row">
        <Avatar name={member.full_name} photoPath={member.photo_path} size="lg" />
        <div className="grow">
          <h3 style={{ margin: 0 }}>{member.full_name}</h3>
          {member.totem && <p className="muted" style={{ margin: 0 }}>{member.totem}</p>}
          <p style={{ margin: '4px 0 0' }}><strong>{m.name}</strong> · {stateBadge(pos.state)}</p>
        </div>
      </div>
      <AreaMarkers progress={progress} catalog={catalog} />
      <PersonalAtMilestone k={pos.milestone} progress={progress} catalog={catalog} self={self} />
      {action?.to && (
        <Link to={action.to} className="btn">{action.title} <ArrowRight size={18} aria-hidden="true" /></Link>
      )}
      {canOpen && <Link to={`/membros/${member.membership_id}`} className="btn secondary">Abrir percurso completo</Link>}
    </div>
  );
}
