import { useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, CircleDashed, Clock, List, Map as MapIcon, RotateCcw, Send } from 'lucide-react';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { memberPosition, MILESTONES, milestoneByKey, STATE_LABEL, type MilestoneKey } from '../../lib/caminho';
import { stageChecklist, type ChecklistStatus } from '../../lib/meuprogresso';
import { formatDate } from '../../lib/labels';
import type { Catalog, MemberProgress } from '../../lib/types';
import { ConfirmButton, ErrorBox, Notice } from '../ui';
import { MapLegend, TrailMap } from '../caminho/TrailMap';
import { AreaMarkers, PersonalAtMilestone } from '../caminho/Pieces';
import { MilestoneInfo, personalNodes } from '../caminho/Shared';
import { stageName } from '../StagePanel';
import type { Subject } from './useSubject';

const KEYS = MILESTONES.map((m) => m.key);
const ICON: Record<ChecklistStatus, typeof Check> = {
  por_escolher: CircleDashed, em_negociacao: Clock, por_concluir: CircleDashed, submetido: Send, revisao: RotateCcw, validado: Check,
};

/** Resumo da etapa: checklist das seis áreas, validação da etapa e reconhecimento. */
export function StageChecklistCard({ catalog, progress, subject, trailHref }: {
  catalog: Catalog; progress: MemberProgress; subject: Subject; trailHref: (key: string) => string;
}) {
  const c = stageChecklist(catalog, progress);
  const action = useAction();
  if (!c) return null;
  const path = c.summary.path;
  const canRequest = c.stageValidation === 'por_pedir' && (subject.isSelf || subject.isDirigente || subject.isGuia);
  const stageLabel = {
    por_pedir: 'Por pedir ao Conselho de Guias',
    nao_disponivel: 'Depois de um trilho validado em cada área',
    conselho: 'Aguarda o Conselho de Guias',
    opiniao_final: 'Aguarda a opinião final da Equipa de Animação',
    validada: `Validada${path.completed_on ? ` em ${formatDate(path.completed_on)}` : ''}`,
  }[c.stageValidation];
  const recognitionLabel = c.recognition === 'realizado' ? `Realizado em ${formatDate(path.recognized_on)}` : c.recognition === 'pendente' ? 'Pendente (na celebração)' : 'Depois de a etapa estar validada';
  return (
    <section className="card checklist-card" aria-labelledby="h-etapa">
      <div className="row between">
        <h2 id="h-etapa" style={{ margin: 0 }}>Etapa {stageName(catalog, path.stage_key)}</h2>
        <span className="faint">Insígnia: {path.insignia_delivered_on ? formatDate(path.insignia_delivered_on) : 'por registar'}</span>
      </div>
      <p className="headline">{c.headline}</p>
      {c.details.length > 1 && (
        <ul className="tight faint">{c.details.slice(1).map((d) => <li key={d}>{d}</li>)}</ul>
      )}
      <ul className="checklist" aria-label="Trilhos da etapa por área">
        {c.rows.map((r) => {
          const Icon = ICON[r.status];
          const inner = (
            <>
              <span className={`ck-icon ck-${r.status}`} aria-hidden="true"><Icon size={15} /></span>
              <span className="area-code" aria-hidden="true">{r.area.code}</span>
              <span className="grow">
                <strong>{r.area.name}</strong>
                <span className="faint"> · {r.trail?.name ?? 'trilho por escolher'}</span>
              </span>
              <span className={`ck-text ck-t-${r.status}`}>{r.text}</span>
            </>
          );
          return (
            <li key={r.area.code}>
              {r.trail ? <Link to={trailHref(r.trail.key)} className="ck-row">{inner}</Link> : (
                <Link to={`?vista=areas&area=${r.area.code}${subject.q ? `&${subject.q}` : ''}`} className="ck-row">{inner}</Link>
              )}
            </li>
          );
        })}
        <li className="ck-row ck-sep">
          <span className={`ck-icon ${c.stageValidation === 'validada' ? 'ck-validado' : 'ck-por_concluir'}`} aria-hidden="true">{c.stageValidation === 'validada' ? <Check size={15} /> : <Clock size={15} />}</span>
          <span className="grow"><strong>Validação da etapa</strong> <span className="faint">· Conselho de Guias e Equipa de Animação</span></span>
          <span className="ck-text">{stageLabel}</span>
        </li>
        <li className="ck-row">
          <span className={`ck-icon ${c.recognition === 'realizado' ? 'ck-validado' : 'ck-por_concluir'}`} aria-hidden="true">{c.recognition === 'realizado' ? <Check size={15} /> : <CircleDashed size={15} />}</span>
          <span className="grow"><strong>Reconhecimento</strong></span>
          <span className="ck-text">{recognitionLabel}</span>
        </li>
      </ul>
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      {canRequest && !action.success && (
        <ConfirmButton className="btn" confirmLabel="Pedir validação da etapa" description="O pedido segue para o Conselho de Guias; a etapa só fica concluída depois da opinião final da Equipa de Animação."
          disabled={action.busy}
          onConfirm={() => action.run(() => call('request_stage_validation', { p_stage_path: path.id }), 'Pedido de validação da etapa enviado ao Conselho de Guias.')}>
          Pedir validação da etapa
        </ConfirmButton>
      )}
    </section>
  );
}

export function CaminhoView({ subject, progress }: { subject: Subject; progress: MemberProgress }) {
  const { catalog } = subject;
  const [params, setParams] = useSearchParams();
  const panelRef = useRef<HTMLElement>(null);
  const pos = memberPosition(progress, catalog);
  const nodes = useMemo(() => personalNodes(progress, catalog), [progress, catalog]);
  const marco = params.get('marco');
  const selected = (marco && (KEYS as string[]).includes(marco) ? marco : pos.milestone) as MilestoneKey;
  const trailHref = (key: string) => `/meu-progresso/trilho/${key}${subject.q ? `?${subject.q}` : ''}`;
  const modo = params.get('modo') === 'lista' ? 'lista' : 'mapa';
  const setModo = (v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set('modo', v);
    else next.delete('modo');
    setParams(next, { replace: true });
  };
  const select = (k: MilestoneKey) => {
    const next = new URLSearchParams(params);
    next.set('marco', k);
    setParams(next, { replace: true });
    requestAnimationFrame(() => panelRef.current?.focus());
  };
  return (
    <div className="caminho-page">
      <section className="card caminho-hero" aria-label="Onde estou">
        <p className="faint" style={{ margin: 0 }}>{subject.isSelf ? 'Estás em' : 'Está em'}</p>
        <h2 style={{ margin: 0 }}>{milestoneByKey[pos.milestone].name}</h2>
        <p style={{ margin: '2px 0 10px' }}>{STATE_LABEL[pos.state].label}</p>
        <AreaMarkers progress={progress} catalog={catalog} />
      </section>
      <StageChecklistCard catalog={catalog} progress={progress} subject={subject} trailHref={trailHref} />
      <div className="row between" style={{ margin: '4px 0 8px' }}>
        <h2 style={{ margin: 0 }}>O caminho das etapas</h2>
        <div className="segmented" role="radiogroup" aria-label="Apresentação do caminho">
          <label className="segment">
            <input type="radio" name="modo-meu" checked={modo === 'mapa'} onChange={() => setModo(null)} />
            <MapIcon size={16} aria-hidden="true" /> <span>Mapa</span>
          </label>
          <label className="segment">
            <input type="radio" name="modo-meu" checked={modo === 'lista'} onChange={() => setModo('lista')} />
            <List size={16} aria-hidden="true" /> <span>Lista</span>
          </label>
        </div>
      </div>
      {modo === 'mapa' ? (
        <>
          <section className="card map-card" aria-label="Mapa do caminho">
            <TrailMap nodes={nodes} selected={selected} onSelect={select} title="O caminho das etapas, com a posição atual" />
            <MapLegend />
          </section>
          <section className="card milestone-panel" ref={panelRef} tabIndex={-1} aria-labelledby="marco-titulo">
            <p className="faint" style={{ margin: 0 }}>Marco {KEYS.indexOf(selected) + 1} de {KEYS.length}</p>
            <h2 id="marco-titulo">{milestoneByKey[selected].name}</h2>
            <div className="personal-block">
              <PersonalAtMilestone k={selected} progress={progress} catalog={catalog} self={subject.isSelf} />
            </div>
            <MilestoneInfo k={selected} />
          </section>
        </>
      ) : (
        <ol className="milestone-list" aria-label="Marcos do caminho">
          {MILESTONES.map((mm, i) => (
            <li key={mm.key} className={`card ml-${nodes[mm.key].status}`}>
              <details open={mm.key === selected}>
                <summary>
                  <span className="ml-num" aria-hidden="true">{i + 1}</span>
                  <span className="grow"><strong>{mm.name}</strong><br /><span className="faint">{nodes[mm.key].caption ?? (nodes[mm.key].status === 'por_vir' ? 'por vir' : '')}</span></span>
                </summary>
                {mm.tracked && <div className="personal-block"><PersonalAtMilestone k={mm.key} progress={progress} catalog={catalog} self={subject.isSelf} /></div>}
                <MilestoneInfo k={mm.key} />
              </details>
            </li>
          ))}
        </ol>
      )}
      <Link to="/caminho" className="btn ghost">Ver o caminho da secção <ArrowRight size={16} aria-hidden="true" /></Link>
    </div>
  );
}
