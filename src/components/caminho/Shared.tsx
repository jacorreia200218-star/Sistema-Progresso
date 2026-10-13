// Peças do Caminho partilhadas entre a tab Caminho e o Meu progresso.
import {
  ADHESION_KNOWLEDGE, memberPosition, MILESTONES, milestoneByKey, stageCycle, stageStatusFor, STATE_LABEL,
  type MilestoneKey, type PositionState,
} from '../../lib/caminho';
import type { Catalog, MemberProgress } from '../../lib/types';
import type { MapNode } from './TrailMap';

const KEYS = MILESTONES.map((m) => m.key);

export function shortState(state: PositionState): string {
  const map: Partial<Record<PositionState, string>> = {
    em_adesao: 'em adesão', perfil_tracado: 'perfil traçado', aguarda_promessa: 'aguarda Promessa', aguarda_etapa: 'Promessa feita',
    em_curso: 'em curso', requisitos_cumpridos: 'requisitos cumpridos', em_validacao: 'em validação',
    concluida: 'concluída', reconhecida: 'reconhecida', etapas_concluidas: 'etapas concluídas', anilha_atribuida: 'anilha atribuída',
  };
  return map[state] ?? STATE_LABEL[state].label;
}

export function personalNodes(p: MemberProgress, catalog: Catalog): Record<MilestoneKey, MapNode> {
  const pos = memberPosition(p, catalog);
  const idx = KEYS.indexOf(pos.milestone);
  const out = {} as Record<MilestoneKey, MapNode>;
  MILESTONES.forEach((m, i) => {
    const stage = ['conhecimento', 'vontade', 'construcao'].includes(m.key) ? stageStatusFor(m.key, p, catalog) : null;
    const phases = stage ? stageCycle(stage.summary, catalog.areas.length) : undefined;
    if (!m.tracked) out[m.key] = { status: 'info', caption: m.key === 'passagem' ? 'idade e maturidade' : 'antes de entrar' };
    else if (i === idx) out[m.key] = { status: 'atual', caption: `estás aqui · ${shortState(pos.state)}`, phases };
    else if (i < idx) out[m.key] = { status: 'feito', caption: stage && stage.state !== 'nao_iniciada' ? shortState(stage.state as PositionState) : 'feito', phases };
    else out[m.key] = { status: 'por_vir', phases };
  });
  return out;
}

export function MilestoneInfo({ k }: { k: MilestoneKey }) {
  const m = milestoneByKey[k];
  return (
    <div className="stack">
      <p>{m.summary}</p>
      <div className="grid-2">
        <div>
          <h4>O que é necessário</h4>
          <ul className="tight">{m.needed.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
        <div>
          <h4>Como se valida</h4>
          <p>{m.validation}</p>
          <h4>O que permite avançar</h4>
          <p>{m.advance}</p>
        </div>
      </div>
      {k === 'inicio_pista' && (
        <details className="card flat">
          <summary>Conhecimentos de adesão da III Secção (p. 6)</summary>
          <h4>Adesão ao movimento</h4>
          <ul className="tight">{ADHESION_KNOWLEDGE.movimento.map((x) => <li key={x}>{x}</li>)}</ul>
          <h4>Adesão à secção</h4>
          <ul className="tight">{ADHESION_KNOWLEDGE.seccao.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="faint">{ADHESION_KNOWLEDGE.nota}</p>
        </details>
      )}
      {m.note && <p className="faint">{m.note}</p>}
      <p className="faint">Manual do Dirigente, {m.pages}.</p>
    </div>
  );
}

