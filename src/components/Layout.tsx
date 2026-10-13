import { NavLink, Outlet, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, ClipboardCheck, Compass, Home, Inbox, Settings, User, Users } from 'lucide-react';
import { useSection } from '../lib/session';
import { fetchNotifications } from '../lib/api';
import { environmentLabel } from '../lib/supabase';

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
      <Mark /> Pioneiros
      {environmentLabel && <span className="env-label">{environmentLabel}</span>}
    </Link>
  );
}

export default function Layout() {
  const s = useSection();
  const notes = useQuery({ queryKey: ['notifications'], queryFn: fetchNotifications, refetchInterval: 60_000 });
  const unread = notes.data?.filter((n) => !n.read_at).length ?? 0;

  const items = [
    { to: '/', label: 'Início', icon: Home, end: true, show: true },
    { to: '/progresso', label: 'Progresso', icon: Compass, show: s.isMember },
    { to: '/pedidos', label: 'Pedidos', icon: Inbox, show: s.isMember },
    { to: '/equipa', label: 'Equipa', icon: Users, show: s.isGuia },
    { to: '/dirigentes', label: 'Revisões', icon: ClipboardCheck, show: s.isDirigente },
    { to: '/gestao', label: 'Gestão', icon: Settings, show: s.isAdmin },
    { to: '/perfil', label: 'Perfil', icon: User, show: true },
  ].filter((i) => i.show);

  const links = items.map((i) => (
    <NavLink key={i.to} to={i.to} end={i.end} className="nav-link">
      <i.icon size={22} aria-hidden="true" />
      <span>{i.label}</span>
    </NavLink>
  ));

  return (
    <div className="app">
      <a href="#conteudo" className="skip-link">
        Saltar para o conteúdo
      </a>
      <header className="topbar">
        <Brand />
        <div className="row">
          {s.membership?.sections && <span className="faint ellipsis" style={{ maxWidth: 160 }}>{s.membership.sections.name}</span>}
          <Link to="/notificacoes" className="btn ghost" aria-label={`Notificações${unread ? `, ${unread} por ler` : ''}`}>
            <span className="notice-dot" data-count={unread || undefined}>
              <Bell size={22} aria-hidden="true" />
            </span>
          </Link>
        </div>
      </header>
      <div className="layout">
        <nav className="side-nav" aria-label="Navegação principal">
          {links}
        </nav>
        <main id="conteudo" className="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Navegação principal">
        {links}
      </nav>
    </div>
  );
}
