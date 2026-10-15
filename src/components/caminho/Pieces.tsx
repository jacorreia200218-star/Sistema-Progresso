// Peças da tab Caminho: marcos por área, ciclo da etapa, estado pessoal num
// marco, lista de pessoas e resumo de um pioneiro.
import { Check, CircleDashed, Clock } from 'lucide-react';
import type { Catalog, MemberProgress } from '../../lib/types';
import {
  areaMarkers, memberPosition, stageCycle, stageNeeds, stageStatusFor, STATE_LABEL, STAGE_KEYS,
  type MilestoneKey, type Phase, type PositionState,
} from '../../lib/caminho';
import { formatDate } from '../../lib/labels';
import { Badge } from '../ui';

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
          <li className={a?.decided_on ? 'tri-ok' : 'tri-no'}>
            <span aria-hidden="true">{a?.decided_on ? <Check size={16} /> : <CircleDashed size={16} />}</span>
            <span><strong>Data de adesão:</strong> {a?.decided_on ? formatDate(a.decided_on) : 'Por registar'}</span>
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
            <span><strong>Data da Promessa:</strong> {a?.commitment_on ? formatDate(a.commitment_on) : 'Por registar'}</span>
          </li>
        </ul>
        {pos.state === 'aguarda_etapa' && <p className="faint prose">A Equipa de Animação abre contigo a etapa do Conhecimento, na primeira negociação, e entrega a insígnia.</p>}
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
        Insígnia entregue: {s.path.insignia_delivered_on ? formatDate(s.path.insignia_delivered_on) : 'Por registar'}
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
