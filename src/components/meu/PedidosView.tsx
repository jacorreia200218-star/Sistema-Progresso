import { Link, useSearchParams } from 'react-router-dom';
import { History, MessageSquare, NotebookPen } from 'lucide-react';
import type { MemberProgress, TrailRequest } from '../../lib/types';
import { decisionLabel, formatDate, formatDateTime, requestKindLabel, requestStatusLabel } from '../../lib/labels';
import { validationInfo } from '../../lib/meuprogresso';
import { Badge, Empty } from '../ui';
import type { Subject } from './useSubject';

const FILTERS: { key: string; label: string; match: (r: TrailRequest) => boolean }[] = [
  { key: 'todos', label: 'Todos', match: () => true },
  { key: 'aguarda', label: 'A aguardar validação', match: (r) => r.status === 'submetido' || r.status === 'em_revisao' },
  { key: 'revisao', label: 'Precisa de revisão', match: (r) => r.status === 'devolvido' },
  { key: 'rascunho', label: 'Rascunhos', match: (r) => r.status === 'rascunho' },
  { key: 'validado', label: 'Validados', match: (r) => r.status === 'validado_equipa' || r.status === 'aprovado' },
  { key: 'encerrado', label: 'Encerrados', match: (r) => r.status === 'recusado' || r.status === 'cancelado' },
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
        {FILTERS.map((x) => (
          <label key={x.key} className="filter-chip">
            <input type="radio" name="pfiltro" checked={key === x.key} onChange={() => setKey(x.key)} />
            <span>{x.label}</span> <span className="fc-n">{progress.requests.filter(x.match).length}</span>
          </label>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="card">
          <Empty title={progress.requests.length ? 'Nenhum pedido neste estado.' : 'Ainda não há pedidos.'}>
            {subject.isSelf && <p className="prose">Abre um trilho em «Áreas FACEIS» e usa «Pedir validação» quando sentires que alcançaste os seus objetivos.</p>}
          </Empty>
        </div>
      ) : (
        <ul className="request-cards">
          {list.map((r) => {
            const t = catalog.trailById.get(r.trail_id);
            const area = t ? catalog.areaById.get(t.area_id) : undefined;
            const last = decisions.find((d) => d.request_id === r.id);
            const v = validationInfo(r, decisions);
            const trailHref = `/meu-progresso/trilho/${r.trail_key}${q}#pedido`;
            return (
              <li key={r.id} className="card request-card">
                <div className="row between">
                  <div className="row" style={{ gap: 8 }}>
                    <span className="area-code" aria-hidden="true">{area?.code}</span>
                    <div>
                      <strong>{t?.name}</strong>
                      <div className="faint">{area?.name}{requestKindLabel[r.kind] ? ` · ${requestKindLabel[r.kind]}` : ''} · atualizado {formatDate(r.updated_at)}</div>
                    </div>
                  </div>
                  <Badge {...requestStatusLabel[r.status]} />
                </div>
                {v && <p className="faint" style={{ margin: '8px 0 0' }}>{v.label} em {formatDate(v.date)}.</p>}
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
                  {subject.isSelf && r.status === 'devolvido' && <Link to={trailHref} className="btn">Corrigir ou complementar</Link>}
                  {subject.isSelf && r.status === 'rascunho' && <Link to={trailHref} className="btn">Continuar o pedido</Link>}
                  <Link to={`/meu-progresso/trilho/${r.trail_key}${q}`} className="btn secondary">Ver o trilho</Link>
                  <Link to={subject.isSelf ? `/pedidos/${r.id}` : `/revisoes/pedido/${r.id}`} className="btn ghost">Histórico completo</Link>
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
