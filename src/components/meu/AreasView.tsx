// Entrada do «Meu progresso»: as seis áreas FACEIS em cartões e, ao abrir uma
// área, só os trilhos dessa área com o estado de cada um (Por fechar, Em
// validação, A rever, Validado). Daqui abre-se o trilho para preparar o pedido.
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, MessageSquare } from 'lucide-react';
import type { CatalogArea, CatalogTrail, MemberProgress } from '../../lib/types';
import { activeRequest } from '../../lib/progress';
import { CATEGORY_LABEL, lastFeedback, trailCategory, validatedObjectives } from '../../lib/meuprogresso';
import { Badge } from '../ui';
import type { Subject } from './useSubject';

function TrailRow({ trail, progress, subject }: { trail: CatalogTrail; progress: MemberProgress; subject: Subject }) {
  const cat = trailCategory(trail, progress);
  const total = trail.catalog_objectives.length;
  const done = validatedObjectives(trail, progress);
  const fb = cat === 'a_rever' ? lastFeedback(activeRequest(progress.requests, trail.key), progress.decisions) : undefined;
  const href = `/meu-progresso/trilho/${trail.key}${subject.q ? `?${subject.q}` : ''}`;
  return (
    <li>
      <Link to={href} className="trail-row">
        <span className="grow">
          <strong>{trail.name}</strong>
          <br />
          <span className="faint">
            {trail.catalog_objectives.map((o) => o.code).join(' · ')}
            {cat !== 'validado' && done > 0 && ` · ${done} de ${total} objetivos validados`}
          </span>
          {fb?.comment && (
            <span className="feedback-inline"><MessageSquare size={13} aria-hidden="true" /> «{fb.comment.length > 110 ? `${fb.comment.slice(0, 110)}…` : fb.comment}»</span>
          )}
        </span>
        <Badge {...CATEGORY_LABEL[cat]} />
        <ArrowRight size={16} aria-hidden="true" className="row-arrow" />
      </Link>
    </li>
  );
}

function AreaCard({ area, progress, subject }: { area: CatalogArea; progress: MemberProgress; subject: Subject }) {
  const cats = area.catalog_trails.map((t) => trailCategory(t, progress));
  const n = (c: string) => cats.filter((x) => x === c).length;
  return (
    <li>
      <Link to={`?vista=areas&area=${area.code}${subject.q ? `&${subject.q}` : ''}`} className="area-card" aria-label={`${area.name}: ${n('validado')} de ${cats.length} trilhos validados`}>
        <span className="area-code" aria-hidden="true">{area.code}</span>
        <strong className="ac-name">{area.name}</strong>
        <span className="faint">{n('validado')} de {cats.length} trilhos validados</span>
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

  if (!area) {
    return (
      <ul className="area-grid" aria-label="Áreas de desenvolvimento FACEIS">
        {catalog.areas.map((a) => <AreaCard key={a.id} area={a} progress={progress} subject={subject} />)}
      </ul>
    );
  }
  return (
    <section className="card" aria-labelledby={`h-area-${area.code}`}>
      <div className="area-head" style={{ marginBottom: 4 }}>
        <span className="area-code" aria-hidden="true">{area.code}</span>
        <div>
          <h2 id={`h-area-${area.code}`} style={{ margin: 0 }}>Trilhos · {area.full_name}</h2>
          <span className="faint">Escolhe o trilho onde queres pedir a validação de objetivos.</span>
        </div>
      </div>
      <ul className="list">{area.catalog_trails.map((t) => <TrailRow key={t.id} trail={t} progress={progress} subject={subject} />)}</ul>
      <Link to={`?vista=areas${subject.q ? `&${subject.q}` : ''}`} className="btn ghost" style={{ marginTop: 8 }}><ArrowLeft size={16} aria-hidden="true" /> Voltar às áreas</Link>
    </section>
  );
}
