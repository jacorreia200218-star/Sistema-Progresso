import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, MessageSquare } from 'lucide-react';
import type { CatalogArea, CatalogTrail, MemberProgress } from '../../lib/types';
import { activeRequest, openPath } from '../../lib/progress';
import {
  activeChoice, CATEGORY_FILTERS, CATEGORY_LABEL, lastFeedback, trailCategory, validationInfo, type TrailCategory,
} from '../../lib/meuprogresso';
import { formatDate } from '../../lib/labels';
import { Badge, Empty } from '../ui';
import { stageName } from '../StagePanel';
import type { Subject } from './useSubject';

function TrailRow({ trail, progress, subject, expCount, filtro }: { trail: CatalogTrail; progress: MemberProgress; subject: Subject; expCount: Record<string, number>; filtro: string }) {
  const cat = trailCategory(trail, progress, expCount);
  const r = activeRequest(progress.requests, trail.key);
  const v = validationInfo(r, progress.decisions);
  const fb = cat === 'revisao' ? lastFeedback(r, progress.decisions) : undefined;
  const choice = activeChoice(progress, trail.key);
  const qs = [subject.q, filtro !== 'todos' ? `filtro=${filtro}` : ''].filter(Boolean).join('&');
  const href = `/meu-progresso/trilho/${trail.key}${qs ? `?${qs}` : ''}`;
  return (
    <li>
      <Link to={href} className="trail-row">
        <span className="grow">
          <strong>{trail.name}</strong>
          <span className="faint"> · {trail.catalog_objectives.map((o) => o.code).join(' · ')}</span>
          <br />
          <span className="faint">
            {v ? `${v.label} · ${formatDate(v.date)}`
              : choice ? `${choice.status === 'confirmada' ? 'Escolhido' : 'Proposto'} para a etapa ${stageName(subject.catalog, progress.paths.find((p) => p.id === choice.stage_path_id)?.stage_key ?? '')}`
              : (expCount[trail.key] ?? 0) > 0 ? `${expCount[trail.key]} vivência(s) registada(s)` : 'Sem atividade registada'}
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

function AreaCard({ area, progress, subject, expCount }: { area: CatalogArea; progress: MemberProgress; subject: Subject; expCount: Record<string, number> }) {
  const validated = area.catalog_trails.filter((t) => trailCategory(t, progress, expCount) === 'validado').length;
  const path = openPath(progress.paths);
  const current = path ? progress.choices.find((c) => c.stage_path_id === path.id && c.area_code === area.code && (c.status === 'confirmada' || c.status === 'proposta')) : undefined;
  const currentTrail = current ? subject.catalog.trailById.get(current.trail_id) : undefined;
  const cat = currentTrail ? trailCategory(currentTrail, progress, expCount) : null;
  return (
    <li>
      <Link to={`?vista=areas&area=${area.code}${subject.q ? `&${subject.q}` : ''}`} className="area-card">
        <span className="ac-head">
          <span className="area-code" aria-hidden="true">{area.code}</span>
          <strong className="grow">{area.name}</strong>
          <span className="faint">{validated} de 3 validados</span>
        </span>
        <span className="ac-line">
          {currentTrail ? <>{currentTrail.name}{current?.status === 'proposta' ? ' (proposta)' : ''}</> : <span className="faint">{path ? 'Trilho por escolher' : 'Sem etapa em curso'}</span>}
        </span>
        {cat && <span><Badge {...(current?.status === 'proposta' ? { label: 'Em negociação', tone: 'neutral' as const, icon: 'clock' } : CATEGORY_LABEL[cat])} /></span>}
      </Link>
    </li>
  );
}

export function AreasView({ subject, progress }: { subject: Subject; progress: MemberProgress }) {
  const { catalog } = subject;
  const [params, setParams] = useSearchParams();
  const filtro = (params.get('filtro') ?? 'todos') as 'todos' | TrailCategory;
  const areaCode = params.get('area');
  const area = catalog.areas.find((a) => a.code === areaCode);
  const expCount: Record<string, number> = {};
  for (const e of subject.experiences) if (e.trail_key) expCount[e.trail_key] = (expCount[e.trail_key] ?? 0) + 1;
  const allTrails = catalog.areas.flatMap((a) => a.catalog_trails);
  const counts = Object.fromEntries(CATEGORY_FILTERS.map((f) => [f.key, f.key === 'todos' ? allTrails.length : allTrails.filter((t) => trailCategory(t, progress, expCount) === f.key).length]));
  const setFiltro = (k: string) => {
    const next = new URLSearchParams(params);
    if (k === 'todos') next.delete('filtro');
    else next.set('filtro', k);
    setParams(next, { replace: true });
  };
  const scopeAreas = area ? [area] : catalog.areas;
  const matching = (a: CatalogArea) => a.catalog_trails.filter((t) => filtro === 'todos' || trailCategory(t, progress, expCount) === filtro);

  return (
    <div>
      <div className="filter-chips" role="radiogroup" aria-label="Filtrar trilhos">
        {CATEGORY_FILTERS.map((f) => (
          <label key={f.key} className="filter-chip">
            <input type="radio" name="filtro" checked={filtro === f.key} onChange={() => setFiltro(f.key)} />
            <span>{f.label}</span> <span className="fc-n">{counts[f.key]}</span>
          </label>
        ))}
      </div>

      {area && (
        <div className="row" style={{ marginBottom: 8 }}>
          <Link to={`?vista=areas${filtro !== 'todos' ? `&filtro=${filtro}` : ''}${subject.q ? `&${subject.q}` : ''}`} className="btn ghost"><ArrowLeft size={16} aria-hidden="true" /> Todas as áreas</Link>
        </div>
      )}

      {!area && filtro === 'todos' ? (
        <>
          <ul className="area-grid" aria-label="Áreas de desenvolvimento FACEIS">
            {catalog.areas.map((a) => <AreaCard key={a.id} area={a} progress={progress} subject={subject} expCount={expCount} />)}
          </ul>
          <Link to="/trilhos" className="btn ghost" style={{ marginTop: 8 }}>Ver todos os trilhos e objetivos em árvore</Link>
        </>
      ) : (
        scopeAreas.map((a) => {
          const trails = matching(a);
          if (!trails.length && !area) return null;
          return (
            <section key={a.id} className="card" aria-labelledby={`h-area-${a.code}`}>
              <div className="area-head" style={{ marginBottom: 4 }}>
                <span className="area-code" aria-hidden="true">{a.code}</span>
                <div>
                  <h2 id={`h-area-${a.code}`} style={{ margin: 0 }}>{a.full_name}</h2>
                  <span className="faint">Dimensão da personalidade: {a.dimension} · Manual, p. {a.source_page}</span>
                </div>
              </div>
              {trails.length ? (
                <ul className="list">{trails.map((t) => <TrailRow key={t.id} trail={t} progress={progress} subject={subject} expCount={expCount} filtro={filtro} />)}</ul>
              ) : <p className="faint">Nenhum trilho desta área neste filtro.</p>}
            </section>
          );
        })
      )}
      {!area && filtro !== 'todos' && counts[filtro] === 0 && <div className="card"><Empty title="Nenhum trilho neste estado." /></div>}
    </div>
  );
}
