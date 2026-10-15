// «Progresso validado»: trilhos validados (ou reconhecidos), por área, com a
// data da decisão. Só o trilho completo conta; decisões por objetivo do modelo
// anterior aparecem na página de cada trilho, como histórico.
import { Link } from 'react-router-dom';
import type { MemberProgress } from '../../lib/types';
import { activeRequest } from '../../lib/progress';
import { trailCategory, validationInfo } from '../../lib/meuprogresso';
import { formatDate } from '../../lib/labels';
import { Badge, Empty } from '../ui';
import { TrailSegments } from './AreasView';
import type { Subject } from './useSubject';

export function ValidadoView({ subject, progress }: { subject: Subject; progress: MemberProgress }) {
  const { catalog } = subject;
  const q = subject.q ? `?${subject.q}` : '';
  const areas = catalog.areas
    .map((a) => ({ a, trails: a.catalog_trails.filter((t) => trailCategory(t, progress) === 'validado') }))
    .filter((x) => x.trails.length);

  if (!areas.length) {
    return (
      <div className="card">
        <Empty title="Ainda não há trilhos validados.">
          {subject.isSelf && <p className="prose">Escolhe uma área, abre um trilho e pede a validação do trilho quando o tiveres alcançado.</p>}
        </Empty>
      </div>
    );
  }
  return (
    <>
      {areas.map(({ a, trails }) => (
        <section key={a.id} className="card" aria-labelledby={`h-val-${a.code}`}>
          <div className="area-head" style={{ marginBottom: 4 }}>
            <span className={`area-code area-${a.code}`} aria-hidden="true">{a.code}</span>
            <h2 id={`h-val-${a.code}`} className="grow" style={{ margin: 0 }}>{a.name}</h2>
            <TrailSegments area={a} progress={progress} />
          </div>
          <ul className="list">
            {trails.map((t) => {
              const v = validationInfo(activeRequest(progress.requests, t.key), progress.decisions);
              return (
                <li key={t.id} className="list-item validated-item">
                  <span className="grow">
                    <Link to={`/meu-progresso/trilho/${t.key}${q}`}><strong>{t.name}</strong></Link>
                    <span className="faint"> · {t.catalog_objectives.map((o) => o.code).join(', ')} · {v?.label ?? 'Validado'}{v ? ` em ${formatDate(v.date)}` : ''}</span>
                  </span>
                  <Badge label="Validado" tone="ok" icon="check" />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
