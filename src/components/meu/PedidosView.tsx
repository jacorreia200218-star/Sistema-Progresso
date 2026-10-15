import { Link, useSearchParams } from 'react-router-dom';
import { History, MessageSquare, NotebookPen } from 'lucide-react';
import type { MemberProgress, TrailRequest } from '../../lib/types';
import { decisionLabel, formatDate, formatDateTime, requestKindLabel, requestStatusLabel } from '../../lib/labels';
import { flaggedObjectives, validationInfo } from '../../lib/meuprogresso';
import { Badge, Empty } from '../ui';
import type { Subject } from './useSubject';

const FILTERS: { key: string; label: string; match: (r: TrailRequest) => boolean }[] = [
  { key: 'todos', label: 'Todos', match: () => true },
  { key: 'aguarda', label: 'Em validação', match: (r) => r.status === 'submetido' || r.status === 'em_revisao' },
  { key: 'revisao', label: 'A rever', match: (r) => r.status === 'devolvido' },
  { key: 'validado', label: 'Validados', match: (r) => r.status === 'validado_equipa' || r.status === 'aprovado' },
  { key: 'rascunho', label: 'Por enviar', match: (r) => r.status === 'rascunho' },
  { key: 'encerrado', label: 'Encerrados', match: (r) => r.status === 'recusado' || r.status === 'cancelado' || r.status === 'objetivos_validados' },
];

export function PedidosView({ subject, progress }: { subject: Subject; progress: MemberProgress }) {
  const { catalog, settings } = subject;
  const [params, setParams] = useSearchParams();
  const key = params.get('pfiltro') ?? 'todos';
  const f = FILTERS.find((x) => x.key === key) ?? FILTERS[0];
  const list = progress.requests.filter(f.match);
  const decisions = progress.decisions ?? [];
  const setKey = (k: string) => {
    const next = new URLSearchParams(params);
    if (k === 'todos') next.delete('pfiltro');
    else next.set('pfiltro', k);
    setParams(next, { replace: true });
  };
  const q = subject.q ? `?${subject.q}` : '';
  return (
    <div>
      <div className="filter-chips" role="radiogroup" aria-label="Filtrar pedidos">
        {FILTERS.filter((x) => x.key === 'todos' || x.key === key || progress.requests.some(x.match)).map((x) => (
          <label key={x.key} className="filter-chip">
            <input type="radio" name="pfiltro" checked={key === x.key} onChange={() => setKey(x.key)} />
            <span>{x.label}</span> <span className="fc-n">{progress.requests.filter(x.match).length}</span>
          </label>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="card">
          <Empty title={progress.requests.length ? 'Nenhum pedido neste estado.' : 'Ainda não há pedidos.'}>
            {subject.isSelf && <p className="prose">Escolhe uma área, abre um trilho, explica como o alcançaste e pede a validação do trilho.</p>}
          </Empty>
        </div>
      ) : (
        <ul className="request-cards">
          {list.map((r) => {
            const t = catalog.trailById.get(r.trail_id);
            const area = t ? catalog.areaById.get(t.area_id) : undefined;
            const last = decisions.find((d) => d.request_id === r.id);
            const v = validationInfo(r, decisions);
            const codes = (t?.catalog_objectives ?? []).map((o) => o.code);
            const flagged = r.status === 'devolvido' ? flaggedObjectives(r, decisions) : [];
            const trailHref = `/meu-progresso/trilho/${r.trail_key}${q}#pedido`;
            return (
              <li key={r.id} className="card request-card">
                <div className="row between">
                  <div className="row" style={{ gap: 8 }}>
                    <span className="area-code" aria-hidden="true">{area?.code}</span>
                    <div>
                      <strong>{t?.name}</strong>
                      <div className="faint">
                        {area?.name}{codes.length ? ` · ${codes.join(', ')}` : ''}{requestKindLabel[r.kind] ? ` · ${requestKindLabel[r.kind]}` : ''} · {formatDate(r.updated_at)}
                      </div>
                    </div>
                  </div>
                  <Badge {...requestStatusLabel[r.status]} />
                </div>
                {v && <p className="faint" style={{ margin: '8px 0 0' }}>{v.label} em {formatDate(v.date)}.</p>}
                {flagged.length > 0 && <p className="faint" style={{ margin: '8px 0 0' }}>Objetivos a demonstrar melhor: {flagged.join(', ')}.</p>}
                {r.status === 'objetivos_validados' && <p className="faint prose" style={{ margin: '8px 0 0' }}>Histórico do modelo anterior, por objetivos. Não fecha o trilho.</p>}
                {last && (last.comment || r.status === 'devolvido') && (
                  <div className={`feedback ${r.status === 'devolvido' ? 'feedback-review' : ''}`}>
                    <MessageSquare size={15} aria-hidden="true" />
                    <div>
                      <strong>{decisionLabel[last.kind]}</strong> <span className="faint">· {formatDateTime(last.recorded_at)}</span>
                      {last.comment && <p style={{ margin: '2px 0 0' }}>«{last.comment}»</p>}
                    </div>
                  </div>
                )}
                <div className="btn-row">
                  {subject.isSelf && r.status === 'devolvido' && r.kind === 'normal' && <Link to={trailHref} className="btn">Corrigir e reenviar</Link>}
                  {subject.isSelf && r.status === 'rascunho' && <Link to={r.kind === 'normal' ? trailHref : `/pedidos/${r.id}`} className="btn">Continuar o pedido</Link>}
                  <Link to={subject.isSelf ? `/pedidos/${r.id}` : `/revisoes/pedido/${r.id}`} className="btn secondary">Abrir o pedido</Link>
                  <Link to={`/meu-progresso/trilho/${r.trail_key}${q}`} className="btn ghost">Ver o trilho</Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {subject.isSelf && (
        <div className="btn-row">
          <Link to="/vivencias" className="btn secondary"><NotebookPen size={16} aria-hidden="true" /> Diário de vivências</Link>
          {(settings?.historical_progress_enabled || progress.requests.some((r) => r.kind === 'historico')) && (
            <Link to="/progresso-anterior" className="btn secondary"><History size={16} aria-hidden="true" /> Progresso anterior</Link>
          )}
        </div>
      )}
    </div>
  );
}
