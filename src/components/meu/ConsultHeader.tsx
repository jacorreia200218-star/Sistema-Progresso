// Cabeçalho único do modo de consulta: pessoa consultada, modo de consulta e
// acessos aos pedidos, ao percurso e às decisões. Substitui os avisos de consulta.
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
    <div className="consult-head" role="region" aria-label="Modo de consulta">
      <Avatar name={c.full_name} photoPath={c.photo_path} />
      <div className="grow consult-who">
        <strong>{c.full_name}</strong>
        <span className="faint">{team ? `${team} · ` : ''}<Eye size={13} aria-hidden="true" /> Modo de consulta</span>
      </div>
      <nav className="consult-links" aria-label="Consulta">
        <Link to={`/meu-progresso?vista=pedidos&${q}`} className="btn ghost">Pedidos deste pioneiro</Link>
        <Link to={`/meu-progresso?vista=caminho&${q}`} className="btn ghost">Ver percurso</Link>
        {subject.isDirigente && <Link to={`/membros/${c.membership_id}`} className="btn ghost">Decisões</Link>}
        {!subject.isMember && <Link to={gridHref()} className="btn ghost"><ArrowLeft size={16} aria-hidden="true" /> Todos os pioneiros</Link>}
        {subject.isMember && <Link to="/meu-progresso" className="btn ghost">Sair da consulta</Link>}
      </nav>
    </div>
  );
}
