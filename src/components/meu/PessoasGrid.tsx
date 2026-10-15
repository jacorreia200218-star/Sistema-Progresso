// «Progresso dos pioneiros» (dirigentes e guias): grelha de pessoas com
// avatar, nome, equipa e etapa, pesquisa por nome, filtro por equipa e ordem
// alfabética. Os filtros ficam no endereço, para voltar à grelha como estava.
// Sem rankings, pontos ou comparação entre pessoas.
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useTeams } from '../../lib/hooks';
import { shortPosition, type MilestoneKey, type PositionState } from '../../lib/caminho';
import type { PathMember } from '../../lib/api';
import { Avatar, Empty } from '../ui';
import { rememberGridFilters } from './ConsultHeader';
import type { Subject } from './useSubject';

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function PessoasGrid({ subject }: { subject: Subject }) {
  const [params, setParams] = useSearchParams();
  const teams = useTeams(subject.membership.section_id);
  const q = params.get('q') ?? '';
  const equipa = params.get('equipa') ?? '';
  const set = (k: string, v: string) => {
    // Parte do endereço atual (não do último render): duas mudanças seguidas não se anulam.
    setParams(() => {
      const next = new URLSearchParams(window.location.search);
      if (v) next.set(k, v);
      else next.delete(k);
      return next;
    }, { replace: true });
  };
  useEffect(() => {
    const keep = new URLSearchParams();
    if (q) keep.set('q', q);
    if (equipa) keep.set('equipa', equipa);
    rememberGridFilters(keep.toString());
  }, [q, equipa]);

  const activeTeams = (teams.data ?? []).filter((t) => !t.archived_at);
  const list: PathMember[] = subject.authorized
    .filter((m) => !equipa || m.team_id === equipa)
    .filter((m) => !q.trim() || norm(m.full_name).includes(norm(q.trim())))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt', { sensitivity: 'base' }));
  const teamName = (id: string | null) => activeTeams.find((t) => t.id === id)?.name ?? (teams.data ?? []).find((t) => t.id === id)?.name ?? 'Sem equipa';
  const keep = new URLSearchParams();
  if (q) keep.set('q', q);
  if (equipa) keep.set('equipa', equipa);
  const suffix = keep.toString() ? `&${keep}` : '';

  return (
    <section aria-label="Pioneiros">
      <div className="grid-filters">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Pesquisar por nome</span>
          <input type="search" placeholder="Pesquisar por nome" value={q} onChange={(e) => set('q', e.target.value)} />
        </label>
        {activeTeams.length > 1 && (
          <label className="inline-field">
            <span className="sr-only">Equipa</span>
            <select value={equipa} onChange={(e) => set('equipa', e.target.value)} aria-label="Filtrar por equipa">
              <option value="">Todas as equipas</option>
              {activeTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
        <span className="faint grid-count" aria-live="polite">{list.length} {list.length === 1 ? 'pioneiro' : 'pioneiros'}</span>
      </div>
      {list.length === 0 ? (
        <div className="card"><Empty title={subject.authorized.length ? 'Nenhum pioneiro com estes filtros.' : 'Ainda não há pioneiros ativos na secção.'} /></div>
      ) : (
        <ul className="people-grid">
          {list.map((m) => (
            <li key={m.membership_id}>
              <Link to={`/meu-progresso?vista=areas&pioneiro=${m.membership_id}${suffix}`} className="person-card">
                <Avatar name={m.full_name} photoPath={m.photo_path} size="lg" />
                <span className="person-text">
                  <strong className="person-name">{m.full_name}</strong>
                  <span className="faint">{teamName(m.team_id)}</span>
                  <span className="person-stage">{shortPosition(m.milestone as MilestoneKey, m.state as PositionState)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
