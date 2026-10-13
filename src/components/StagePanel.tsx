import { Link } from 'react-router-dom';
import { Award, Flag } from 'lucide-react';
import type { Catalog, MemberProgress } from '../lib/types';
import { stageSummary, type StageSummary } from '../lib/progress';
import { formatDate, stageRequestLabel, trailStateLabel } from '../lib/labels';
import { Badge, Meter } from './ui';

export function stageName(catalog: Catalog, key: string) {
  return catalog.stages.find((s) => s.key === key)?.name ?? key;
}

/** Percurso de uma etapa: um trilho por área, com estado de cada um. */
export function StagePanel({ summary, catalog, linkTrails = true }: { summary: StageSummary; catalog: Catalog; linkTrails?: boolean }) {
  const { path } = summary;
  return (
    <div className="card">
      <div className="row between">
        <div className="card-title">
          <Flag aria-hidden="true" color="var(--accent-ink)" />
          <h2 style={{ margin: 0 }}>Etapa {stageName(catalog, path.stage_key)}</h2>
        </div>
        {path.status === 'concluida' ? (
          <Badge label={path.completion_kind === 'historico' ? 'Concluída (registo anterior)' : 'Concluída'} tone="ok" icon="check" />
        ) : summary.openRequest ? (
          <Badge {...stageRequestLabel[summary.openRequest.status]} />
        ) : (
          <Badge label="Em curso" tone="progress" icon="compass" />
        )}
      </div>
      <dl className="meta faint" style={{ marginBottom: 12 }}>
        <dt>Insígnia entregue</dt>
        <dd>{path.insignia_delivered_on ? formatDate(path.insignia_delivered_on) : 'Por registar'}</dd>
        {path.completed_on && (
          <>
            <dt>Concluída</dt>
            <dd>{formatDate(path.completed_on)}</dd>
          </>
        )}
        {path.recognized_on && (
          <>
            <dt>Reconhecimento</dt>
            <dd>{formatDate(path.recognized_on)}</dd>
          </>
        )}
      </dl>
      <Meter value={summary.validatedCount} max={catalog.areas.length} label="Trilhos da etapa validados" />
      <div className="slot-grid" style={{ marginTop: 14 }}>
        {summary.slots.map((slot) => {
          const trail = slot.trail ?? (slot.proposed ? catalog.trailById.get(slot.proposed.trail_id) : undefined);
          const content = (
            <>
              <span className="area-code" aria-hidden="true">{slot.area.code}</span>
              <span className="grow">
                <span className="faint">{slot.area.name}</span>
                <br />
                <strong>{trail?.name ?? 'Por escolher'}</strong>
                <br />
                <Badge {...trailStateLabel[slot.state]} />
              </span>
            </>
          );
          return linkTrails && trail ? (
            <Link key={slot.area.code} to={`/meu-progresso/trilho/${trail.key}`} className="slot">
              {content}
            </Link>
          ) : (
            <div key={slot.area.code} className="slot">
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MeritCard({ progress, catalog }: { progress: MemberProgress; catalog: Catalog }) {
  if (!progress.merit) return null;
  return (
    <div className="card">
      <div className="card-title">
        <Award aria-hidden="true" color="var(--green-ink)" />
        <h2 style={{ margin: 0 }}>Anilha de mérito</h2>
      </div>
      <p>
        Atribuída em {formatDate(progress.merit.awarded_on)}
        {progress.merit.kind === 'historico' ? ' (registo de mérito anterior)' : ''}.
      </p>
      <p className="faint">{catalog.areas.length * 3} trilhos da secção e etapa da Construção.</p>
    </div>
  );
}

export function summaries(catalog: Catalog, progress: MemberProgress) {
  return [...progress.paths].sort((a, b) => a.stage_ordinal - b.stage_ordinal).map((p) => stageSummary(p, catalog, progress));
}
