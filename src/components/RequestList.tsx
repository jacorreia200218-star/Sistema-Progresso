import { Link } from 'react-router-dom';
import type { Catalog, TrailRequest } from '../lib/types';
import { formatShortDate, requestKindLabel, requestStatusLabel } from '../lib/labels';
import { Badge } from './ui';

export function RequestList({ requests, catalog, names, base = '/pedidos' }: {
  requests: TrailRequest[]; catalog: Catalog; names?: Record<string, string>; base?: string;
}) {
  return (
    <ul className="list">
      {requests.map((r) => {
        const t = catalog.trailById.get(r.trail_id);
        const area = t ? catalog.areaById.get(t.area_id) : undefined;
        return (
          <li key={r.id}>
            <Link to={`${base}/${r.id}`} className="list-item">
              <span className="area-code" aria-hidden="true">{area?.code}</span>
              <span className="grow">
                <strong>{t?.name ?? r.trail_key}</strong>
                {names?.[r.membership_id] && <span> · {names[r.membership_id]}</span>}
                <br />
                <span className="faint">
                  {requestKindLabel[r.kind] ? `${requestKindLabel[r.kind]} · ` : ''}{formatShortDate(r.updated_at)}
                </span>
              </span>
              <Badge {...requestStatusLabel[r.status]} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
