// Cabeçalho único do modo de consulta: pessoa consultada, modo de consulta e
// acessos a todos os pioneiros, aos pedidos, ao percurso e às decisões, em duas
// linhas. É o único sítio com estes acessos durante a consulta.
import { Link } from 'react-router-dom';
import { ArrowLeft, Eye } from 'lucide-react';
import { useTeams } from '../../lib/hooks';
import { Avatar } from '../ui';
import type { Subject } from './useSubject';

const GRID_KEY = 'pioneiros.grelha';

/** Filtros da grelha de pioneiros (para voltar com os mesmos filtros). */
export function rememberGridFilters(search: string) {
  try {
    sessionStorage.setItem(GRID_KEY, search);
  } catch { /* ignorar */ }
}

export function gridHref(): string {
  let saved = '';
  try {
    saved = sessionStorage.getItem(GRID_KEY) ?? '';
  } catch { /* ignorar */ }
  return `/meu-progresso${saved ? `?${saved}` : ''}`;
}

export function ConsultHeader({ subject }: { subject: Subject }) {
  const teams = useTeams(subject.membership.section_id);
  const c = subject.consulted;
  if (!c) return null;
  const team = teams.data?.find((t) => t.id === c.team_id)?.name;
  const q = `pioneiro=${c.membership_id}`;
  return (
    <div className="consult-head" role="region" aria-label={`Modo de consulta: ${c.full_name}`}>
      {/* 1.ª linha: quem é e de que equipa; 2.ª linha: ações. */}
      <div className="consult-who">
        <Avatar name={c.full_name} photoPath={c.photo_path} />
        <div className="consult-id">
          <strong>{c.full_name}</strong>
          <span className="consult-meta">
            {team && <span className="nowrap">{team}</span>}
            <span className="nowrap consult-mode"><Eye size={13} aria-hidden="true" /> Modo de consulta</span>
          </span>
        </div>
      </div>
      <nav className="consult-links" aria-label="Ações da consulta">
        {!subject.isMember
          ? <Link to={gridHref()} className="btn ghost"><ArrowLeft size={16} aria-hidden="true" /> Todos os pioneiros</Link>
          : <Link to="/meu-progresso" className="btn ghost"><ArrowLeft size={16} aria-hidden="true" /> Sair da consulta</Link>}
        <Link to={`/meu-progresso?vista=pedidos&${q}`} className="btn ghost">Pedidos</Link>
        <Link to={`/meu-progresso?vista=caminho&${q}`} className="btn ghost">Percurso</Link>
        {subject.isDirigente && <Link to={`/membros/${c.membership_id}`} className="btn ghost">Decisões</Link>}
      </nav>
    </div>
  );
}
