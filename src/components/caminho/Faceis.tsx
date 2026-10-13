// Resumo das seis áreas FACEIS: na etapa em curso, o trilho de cada área e o
// seu estado; sem etapa aberta, os trilhos validados por área (0–3).
import { Link } from 'react-router-dom';
import { Check, CircleDashed, Clock, RotateCcw, Send } from 'lucide-react';
import { areaMarkers } from '../../lib/caminho';
import { openPath } from '../../lib/progress';
import { stageChecklist, type ChecklistStatus } from '../../lib/meuprogresso';
import type { Catalog, MemberProgress } from '../../lib/types';

const ICON: Record<ChecklistStatus, typeof Check> = {
  por_escolher: CircleDashed, em_negociacao: Clock, por_concluir: CircleDashed, submetido: Send, revisao: RotateCcw, validado: Check,
};
const SHORT: Record<ChecklistStatus, string> = {
  por_escolher: 'Por escolher', em_negociacao: 'Em negociação', por_concluir: 'Em desenvolvimento', submetido: 'Em validação', revisao: 'Precisa de revisão', validado: 'Validado',
};

export function FaceisSummary({ catalog, progress, compact, trailHref }: {
  catalog: Catalog; progress: MemberProgress; compact?: boolean; trailHref?: (key: string) => string;
}) {
  const path = openPath(progress.paths);
  const check = path ? stageChecklist(catalog, progress) : null;
  if (!check) {
    const markers = areaMarkers(progress, catalog);
    return (
      <ul className={`faceis ${compact ? 'compact' : ''}`} aria-label="Trilhos validados por área">
        {markers.map((m) => (
          <li key={m.code} className="faceis-row">
            <span className="area-code" aria-hidden="true">{m.code}</span>
            <span className="grow">{m.name}</span>
            <span className="faint">{m.validated} de {m.total} validados</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className={`faceis ${compact ? 'compact' : ''}`} aria-label="Áreas FACEIS na etapa atual">
      {check.rows.map((r) => {
        const Icon = ICON[r.status];
        const inner = (
          <>
            <span className="area-code" aria-hidden="true">{r.area.code}</span>
            <span className="grow">
              <span className="faceis-area">{r.area.name}</span>
              <span className="faceis-trail">{r.trail?.name ?? 'Trilho por escolher'}</span>
            </span>
            <span className={`faceis-state fs-${r.status}`}><Icon size={14} aria-hidden="true" /> {SHORT[r.status]}</span>
          </>
        );
        return (
          <li key={r.area.code}>
            {trailHref && r.trail ? <Link to={trailHref(r.trail.key)} className="faceis-row">{inner}</Link> : <span className="faceis-row">{inner}</span>}
          </li>
        );
      })}
    </ul>
  );
}
