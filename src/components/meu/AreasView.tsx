// Entrada do «Meu progresso»: as seis áreas FACEIS em cartões (fundo suave
// próprio, ícone e três segmentos — um por trilho validado na área). Ao abrir
// uma área: os três trilhos, os códigos dos objetivos e o estado de cada um.
// Os segmentos contam trilhos validados; não são objetivos nem etapas.
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, ArrowLeft, ArrowRight, Heart, Lightbulb, MessageSquare, Shield, Sparkles, Users } from 'lucide-react';
import type { CatalogArea, CatalogTrail, MemberProgress } from '../../lib/types';
import { activeRequest, openPath } from '../../lib/progress';
import { CATEGORY_LABEL, flaggedObjectives, lastFeedback, stageChecklist, STATUS_TEXT, trailCategory } from '../../lib/meuprogresso';
import { Badge } from '../ui';
import type { Subject } from './useSubject';

export const AREA_ICON: Record<string, typeof Heart> = { F: Activity, A: Heart, C: Shield, E: Sparkles, I: Lightbulb, S: Users };

/** Três segmentos, um por trilho da área; preenchido = trilho validado. */
export function TrailSegments({ area, progress }: { area: CatalogArea; progress: MemberProgress }) {
  const cats = area.catalog_trails.map((t) => trailCategory(t, progress));
  const done = cats.filter((c) => c === 'validado').length;
  return (
    <span className="segments" role="img" aria-label={`${done} de ${cats.length} trilhos validados`}>
      {[...cats].sort((a, b) => Number(b === 'validado') - Number(a === 'validado')).map((c, i) => (
        <span key={i} className={`seg ${c === 'validado' ? 'is-done' : c === 'em_validacao' ? 'is-pending' : ''}`} />
      ))}
    </span>
  );
}

function TrailRow({ trail, progress, subject }: { trail: CatalogTrail; progress: MemberProgress; subject: Subject }) {
  const cat = trailCategory(trail, progress);
  const r = activeRequest(progress.requests, trail.key);
  const fb = cat === 'a_rever' ? lastFeedback(r, progress.decisions) : undefined;
  const flagged = cat === 'a_rever' ? flaggedObjectives(r, progress.decisions) : [];
  const href = `/meu-progresso/trilho/${trail.key}${subject.q ? `?${subject.q}` : ''}`;
  return (
    <li>
      <Link to={href} className="trail-row">
        <span className="grow">
          <strong>{trail.name}</strong>
          <br />
          <span className="obj-codes" aria-label={`Objetivos ${trail.catalog_objectives.map((o) => o.code).join(', ')}`}>
            {trail.catalog_objectives.map((o) => <span key={o.id} className="code-chip">{o.code}</span>)}
          </span>
          {fb?.comment && (
            <span className="feedback-inline"><MessageSquare size={13} aria-hidden="true" /> «{fb.comment.length > 110 ? `${fb.comment.slice(0, 110)}…` : fb.comment}»{flagged.length ? ` · ${flagged.join(', ')}` : ''}</span>
          )}
        </span>
        <Badge {...CATEGORY_LABEL[cat]} />
        <ArrowRight size={16} aria-hidden="true" className="row-arrow" />
      </Link>
    </li>
  );
}

function AreaCard({ area, progress, subject, stageLine }: { area: CatalogArea; progress: MemberProgress; subject: Subject; stageLine?: string }) {
  const cats = area.catalog_trails.map((t) => trailCategory(t, progress));
  const n = (c: string) => cats.filter((x) => x === c).length;
  const Icon = AREA_ICON[area.code] ?? Activity;
  return (
    <li>
      <Link to={`?vista=areas&area=${area.code}${subject.q ? `&${subject.q}` : ''}`} className={`area-card area-${area.code}`}>
        <span className="ac-icon" aria-hidden="true"><Icon size={20} /></span>
        <strong className="ac-name">{area.name}</strong>
        <TrailSegments area={area} progress={progress} />
        <span className="ac-count">{n('validado')} de {cats.length} trilhos validados</span>
        {stageLine && <span className="ac-stage faint">{stageLine}</span>}
        {(n('em_validacao') > 0 || n('a_rever') > 0) && (
          <span className="ac-states">
            {n('a_rever') > 0 && <Badge label={`${n('a_rever')} a rever`} tone="attention" icon="return" />}
            {n('em_validacao') > 0 && <Badge label={`${n('em_validacao')} em validação`} tone="progress" icon="clock" />}
          </span>
        )}
      </Link>
    </li>
  );
}

export function AreasView({ subject, progress }: { subject: Subject; progress: MemberProgress }) {
  const { catalog } = subject;
  const [params] = useSearchParams();
  const area = catalog.areas.find((a) => a.code === params.get('area'));
  // Requisitos da etapa atual (trilho confirmado para a etapa), separados do histórico reconhecido.
  const check = openPath(progress.paths) ? stageChecklist(catalog, progress) : null;
  const stageName = check ? catalog.stages.find((s) => s.key === check.summary.path.stage_key)?.name : undefined;
  const stageLine = (code: string) => {
    const row = check?.rows.find((r) => r.area.code === code);
    if (!row || !stageName) return undefined;
    return row.trail ? `${stageName}: ${row.trail.name} · ${STATUS_TEXT[row.status]}` : `${stageName}: ${STATUS_TEXT[row.status]}`;
  };

  if (!area) {
    return (
      <>
        <ul className="area-grid" aria-label="Áreas de desenvolvimento FACEIS">
          {catalog.areas.map((a) => <AreaCard key={a.id} area={a} progress={progress} subject={subject} stageLine={stageLine(a.code)} />)}
        </ul>
        <p className="faint prose legend">Cada segmento é um trilho validado na área (histórico reconhecido){stageName ? `; a linha de baixo mostra o trilho escolhido para a etapa ${stageName}` : ''}.</p>
      </>
    );
  }
  const Icon = AREA_ICON[area.code] ?? Activity;
  return (
    <section className={`card area-panel area-${area.code}`} aria-labelledby={`h-area-${area.code}`}>
      <div className="area-head">
        <span className="ac-icon" aria-hidden="true"><Icon size={20} /></span>
        <div className="grow">
          <h2 id={`h-area-${area.code}`} style={{ margin: 0 }}>Trilhos · {area.full_name}</h2>
          <span className="faint">{stageLine(area.code) ?? 'Escolhe o trilho para ver os objetivos e pedir a validação.'}</span>
        </div>
        <TrailSegments area={area} progress={progress} />
      </div>
      <ul className="list">{area.catalog_trails.map((t) => <TrailRow key={t.id} trail={t} progress={progress} subject={subject} />)}</ul>
      <Link to={`?vista=areas${subject.q ? `&${subject.q}` : ''}`} className="btn ghost" style={{ marginTop: 8 }}><ArrowLeft size={16} aria-hidden="true" /> Voltar às áreas</Link>
    </section>
  );
}
