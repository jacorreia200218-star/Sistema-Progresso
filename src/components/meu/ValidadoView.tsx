// «Progresso validado»: trilhos fechados e objetivos já aceites, por área,
// com a data da decisão. Um objetivo aceite não fecha o trilho sozinho.
import { Link } from 'react-router-dom';
import type { MemberProgress } from '../../lib/types';
import { activeRequest } from '../../lib/progress';
import { objectiveStates, trailCategory, validationInfo } from '../../lib/meuprogresso';
import { formatDate } from '../../lib/labels';
import { Badge, Empty } from '../ui';
import type { Subject } from './useSubject';

export function ValidadoView({ subject, progress }: { subject: Subject; progress: MemberProgress }) {
  const { catalog } = subject;
  const q = subject.q ? `?${subject.q}` : '';
  const areas = catalog.areas
    .map((a) => ({
      a,
      trails: a.catalog_trails
        .map((t) => ({ t, states: objectiveStates(t, progress), closed: trailCategory(t, progress) === 'validado' }))
        .filter((x) => x.closed || [...x.states.values()].some((s) => s.state === 'validado')),
    }))
    .filter((x) => x.trails.length);

  if (!areas.length) {
    return (
      <div className="card">
        <Empty title="Ainda não há objetivos validados.">
          {subject.isSelf && <p className="prose">Escolhe uma área, abre um trilho e envia para validação os objetivos que já atingiste.</p>}
        </Empty>
      </div>
    );
  }
  return (
    <>
      {areas.map(({ a, trails }) => (
        <section key={a.id} className="card" aria-labelledby={`h-val-${a.code}`}>
          <div className="area-head" style={{ marginBottom: 4 }}>
            <span className="area-code" aria-hidden="true">{a.code}</span>
            <h2 id={`h-val-${a.code}`} style={{ margin: 0 }}>{a.name}</h2>
          </div>
          <ul className="list">
            {trails.map(({ t, states, closed }) => {
              const v = closed ? validationInfo(activeRequest(progress.requests, t.key), progress.decisions) : null;
              const ok = t.catalog_objectives.filter((o) => states.get(o.id)?.state === 'validado');
              return (
                <li key={t.id} className="list-item validated-item">
                  <span className="grow">
                    <Link to={`/meu-progresso/trilho/${t.key}${q}`}><strong>{t.name}</strong></Link>
                    <span className="faint"> · {closed ? `${v?.label ?? 'Validado'}${v ? ` em ${formatDate(v.date)}` : ''}` : `${ok.length} de ${t.catalog_objectives.length} objetivos validados`}</span>
                    {!closed && (
                      <span className="faint" style={{ display: 'block' }}>
                        {ok.map((o) => `${o.code}${states.get(o.id)?.date ? ` (${formatDate(states.get(o.id)!.date)})` : ''}`).join(' · ')}
                      </span>
                    )}
                  </span>
                  <Badge {...(closed ? { label: 'Validado', tone: 'ok' as const, icon: 'check' } : { label: 'Por fechar', tone: 'muted' as const, icon: 'circle' })} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
