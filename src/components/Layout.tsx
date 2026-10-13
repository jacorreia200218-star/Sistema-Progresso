import { Link, NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, ClipboardCheck, Compass, Home, Inbox, Route as RouteIcon, Settings, User, Users } from 'lucide-react';
import { useSection } from '../lib/session';
import { fetchNotifications, fetchPendingCounts } from '../lib/api';
import { useProgress } from '../lib/hooks';
import { memberPosition, milestoneByKey, STATE_LABEL } from '../lib/caminho';
import { environmentLabel } from '../lib/supabase';
import { ThemeToggle } from './ThemeControl';
import { Avatar } from './ui';

function Mark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#A52A35" />
      <circle cx="32" cy="32" r="17" fill="none" stroke="#F7F5F0" strokeWidth="3" />
      <path d="M32 18 L37 32 L32 46 L27 32 Z" fill="#F7F5F0" />
    </svg>
  );
}

export function Brand() {
  return (
    <Link to="/" className="brand">
      <Mark /> <span className="brand-name">Pioneiros</span>
      {environmentLabel && <span className="env-label">{environmentLabel}</span>}
    </Link>
  );
}

/** Indicação permanente da etapa atual (só para quem tem percurso). */
function StageChip() {
  const s = useSection();
  const q = useProgress(s.isMember ? s.membership?.id : undefined);
  if (!s.isMember || !q.data || !s.catalog) return null;
  const pos = memberPosition(q.data, s.catalog);
  return (
    <Link to="/caminho" className="stage-chip" title={STATE_LABEL[pos.state].label}>
      <RouteIcon size={16} aria-hidden="true" />
      <span className="sr-only">Etapa atual: </span>
      <span>{milestoneByKey[pos.milestone].short}</span>
      <span className="stage-chip-state">· {STATE_LABEL[pos.state].label}</span>
    </Link>
  );
}

export default function Layout() {
  const s = useSection();
  const notes = useQuery({ queryKey: ['notifications'], queryFn: fetchNotifications, refetchInterval: 60_000 });
  const counts = useQuery({
    queryKey: ['pending-counts', s.membership?.section_id],
    queryFn: () => fetchPendingCounts(s.membership!.section_id),
    enabled: !!s.membership,
    refetchInterval: 60_000,
  });
  const unread = notes.data?.filter((n) => !n.read_at).length ?? 0;
  const c = counts.data ?? {};

  const items = [
    { to: '/', label: 'Início', short: 'Início', icon: Home, end: true, show: true },
    { to: '/caminho', label: 'Caminho', short: 'Caminho', icon: RouteIcon, show: true },
    { to: '/progresso', label: 'Progresso', short: 'Progresso', icon: Compass, show: s.isMember },
    { to: '/pedidos', label: 'Pedidos', short: 'Pedidos', icon: Inbox, show: s.isMember, count: c.pedidos, countLabel: 'precisam de ti' },
    { to: '/equipa', label: 'Equipa', short: 'Equipa', icon: Users, show: s.isGuia, count: c.equipa, countLabel: 'para a reunião de Equipa' },
    { to: '/acompanhamento', label: 'Acompanhamento', short: 'Acompanhar', icon: ClipboardCheck, show: s.isDirigente, count: c.acompanhamento, countLabel: 'pendentes' },
    { to: '/gestao', label: 'Gestão', short: 'Gestão', icon: Settings, show: s.isAdmin, count: c.gestao, countLabel: 'pedidos de entrada' },
    { to: '/perfil', label: 'Perfil', short: 'Perfil', icon: User, show: true, desktopOnly: true },
  ].filter((i) => i.show);

  const link = (i: (typeof items)[number], compact: boolean) => (
    <NavLink key={i.to} to={i.to} end={i.end} className="nav-link">
      <span className="nav-icon">
        <i.icon size={22} aria-hidden="true" />
        {!!i.count && <span className="nav-count" aria-hidden="true">{i.count > 99 ? '99+' : i.count}</span>}
      </span>
      <span>{compact ? i.short : i.label}</span>
      {!!i.count && <span className="sr-only">, {i.count} {i.countLabel}</span>}
    </NavLink>
  );

  return (
    <div className="app">
      <a href="#conteudo" className="skip-link">Saltar para o conteúdo</a>
      <header className="topbar">
        <Brand />
        <div className="row topbar-tools">
          <StageChip />
          {s.membership?.sections && !s.isMember && <span className="faint ellipsis section-name">{s.membership.sections.name}</span>}
          <ThemeToggle />
          <Link to="/notificacoes" className="btn ghost icon-btn" aria-label={`Notificações${unread ? `, ${unread} por ler` : ''}`}>
            <span className="notice-dot" data-count={unread || undefined}>
              <Bell size={22} aria-hidden="true" />
            </span>
          </Link>
          <Link to="/perfil" className="topbar-avatar" aria-label="Perfil">
            <Avatar name={s.profile?.full_name ?? '?'} photoPath={s.profile?.photo_path} />
          </Link>
        </div>
      </header>
      <div className="layout">
        <nav className="side-nav" aria-label="Navegação principal">
          {items.map((i) => link(i, false))}
        </nav>
        <main id="conteudo" className="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Navegação principal">
        {items.filter((i) => !i.desktopOnly).map((i) => link(i, true))}
      </nav>
    </div>
  );
}
