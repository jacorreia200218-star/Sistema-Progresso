import { useEffect, useLayoutEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigationType } from 'react-router-dom';
import rosaUrl from '../assets/rosa-dos-ventos.svg';
import { useQuery } from '@tanstack/react-query';
import { Bell, ClipboardCheck, Compass, Home, Route as RouteIcon, Settings, User, Users } from 'lucide-react';
import { useSection } from '../lib/session';
import { fetchNotifications, fetchPendingCounts } from '../lib/api';
import { useProgress } from '../lib/hooks';
import { memberPosition, milestoneByKey, STATE_LABEL } from '../lib/caminho';
import { environmentLabel } from '../lib/supabase';
import { ThemeToggle } from './ThemeControl';
import { Avatar } from './ui';

/** Rosa dos Ventos — símbolo da III Secção, extraído do Manual do Dirigente (CNE), p. 41. */
export function Rosa({ size = 30 }: { size?: number }) {
  return <img src={rosaUrl} width={size} height={size} alt="" className="brand-mark" />;
}

export function Brand() {
  return (
    <Link to="/" className="brand">
      <Rosa /> <span className="brand-name">Pioneiros</span>
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
    <Link to="/meu-progresso?vista=caminho" className="stage-chip" title={STATE_LABEL[pos.state].label}>
      <RouteIcon size={16} aria-hidden="true" />
      <span className="sr-only">Etapa atual: </span>
      <span>{milestoneByKey[pos.milestone].short}</span>
      <span className="stage-chip-state">· {STATE_LABEL[pos.state].label}</span>
    </Link>
  );
}

const SCROLL_KEY = 'pioneiros.scroll';

/** Preserva a posição ao voltar (e começa no topo ao abrir uma página nova). */
function useScrollRestoration() {
  const location = useLocation();
  const nav = useNavigationType();
  useLayoutEffect(() => {
    let saved: Record<string, number> = {};
    try {
      saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? '{}');
    } catch {
      /* ignorar */
    }
    if (nav === 'POP' && saved[location.key] != null) window.scrollTo(0, saved[location.key]);
    else if (nav !== 'REPLACE') window.scrollTo(0, 0);
  }, [location.key, nav]);
  useEffect(() => {
    let t: number | undefined;
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        try {
          const saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? '{}');
          saved[location.key] = window.scrollY;
          sessionStorage.setItem(SCROLL_KEY, JSON.stringify(saved));
        } catch {
          /* ignorar */
        }
      }, 120);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(t);
    };
  }, [location.key]);
}

export default function Layout() {
  const s = useSection();
  const location = useLocation();
  useScrollRestoration();
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
    { to: '/meu-progresso', label: 'Meu progresso', short: 'Progresso', icon: Compass, show: s.isMember, count: c.pedidos, countLabel: 'pedidos precisam de ti' },
    { to: '/caminho', label: 'Caminho da secção', short: 'Caminho', icon: RouteIcon, show: true },
    { to: '/equipa', label: 'Equipa', short: 'Equipa', icon: Users, show: s.isGuia, count: c.equipa, countLabel: 'para a reunião de Equipa' },
    { to: '/meu-progresso', label: 'Progresso dos pioneiros', short: 'Progressos', icon: Compass, show: s.isDirigente && !s.isMember },
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
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Navegação principal">
        {items.filter((i) => !i.desktopOnly).map((i) => link(i, true))}
      </nav>
    </div>
  );
}
