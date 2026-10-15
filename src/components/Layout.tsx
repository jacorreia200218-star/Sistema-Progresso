import { Suspense, useEffect, useLayoutEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigationType } from 'react-router-dom';
import rosaUrl from '../assets/rosa-dos-ventos.svg';
import { useQuery } from '@tanstack/react-query';
import { Bell, ClipboardCheck, Compass, Ellipsis, Home, ListTree, Route as RouteIcon, Settings, User, Users } from 'lucide-react';
import { FUTURE_AREAS } from '../lib/futuras';
import { useSection } from '../lib/session';
import { fetchNotifications, fetchPendingCounts } from '../lib/api';
import { useProgress } from '../lib/hooks';
import { memberPosition, milestoneByKey, STATE_LABEL } from '../lib/caminho';
import { environmentLabel } from '../lib/supabase';
import { ThemeToggle } from './ThemeControl';
import { Avatar, Loading } from './ui';
import { RouteBoundary } from './RouteBoundary';

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

/** Carregamento discreto: barra fina no topo e um esqueleto curto; a navegação fica visível. */
function PageLoading() {
  return (
    <>
      <div className="route-progress" aria-hidden="true" />
      <Loading rows={2} />
    </>
  );
}

type NavItem = {
  to: string; label: string; short: string; icon: typeof Home; end?: boolean; show: boolean;
  count?: number; countLabel?: string; desktopOnly?: boolean; mobilePriority?: number;
};

/** Destinos da navegação. No telemóvel cabem quatro na barra; os restantes ficam em «Mais». */
export function useNavItems() {
  const s = useSection();
  const counts = useQuery({
    queryKey: ['pending-counts', s.membership?.section_id],
    queryFn: () => fetchPendingCounts(s.membership!.section_id),
    enabled: !!s.membership,
    refetchInterval: 60_000,
  });
  const c = counts.data ?? {};
  const items = ([
    { to: '/', label: 'Início', short: 'Início', icon: Home, end: true, show: true, mobilePriority: 0 },
    { to: '/meu-progresso', label: 'Meu progresso', short: 'Progresso', icon: Compass, show: s.isMember, count: c.pedidos, countLabel: 'pedidos precisam de ti', mobilePriority: 1 },
    { to: '/caminho', label: 'Caminho da secção', short: 'Caminho', icon: RouteIcon, show: true, mobilePriority: 6 },
    { to: '/trilhos', label: 'Trilhos', short: 'Trilhos', icon: ListTree, show: true, mobilePriority: 7 },
    { to: '/equipa', label: 'Equipa', short: 'Equipa', icon: Users, show: s.isGuia, count: c.equipa, countLabel: 'para a reunião de Equipa', mobilePriority: 2 },
    { to: '/meu-progresso', label: 'Progresso dos pioneiros', short: 'Progressos', icon: Compass, show: s.isDirigente && !s.isMember, mobilePriority: 3 },
    { to: '/acompanhamento', label: 'Acompanhamento', short: 'Acompanhar', icon: ClipboardCheck, show: s.isDirigente, count: c.acompanhamento, countLabel: 'pendentes', mobilePriority: 4 },
    { to: '/gestao', label: 'Gestão', short: 'Gestão', icon: Settings, show: s.isAdmin, count: c.gestao, countLabel: 'pedidos de entrada', mobilePriority: 5 },
    { to: '/perfil', label: 'Perfil', short: 'Perfil', icon: User, show: true, desktopOnly: true },
  ] as NavItem[]).filter((i) => i.show);

  // Telemóvel: os quatro destinos mais importantes para esta pessoa, pela ordem do menu, e «Mais».
  const candidates = items.filter((i) => !i.desktopOnly);
  const keep = new Set([...candidates].sort((a, b) => (a.mobilePriority ?? 9) - (b.mobilePriority ?? 9)).slice(0, 4));
  const mobileItems = candidates.filter((i) => keep.has(i));
  const overflow = candidates.filter((i) => !keep.has(i));
  const more: NavItem = {
    to: '/mais', label: 'Mais', short: 'Mais', icon: Ellipsis, show: true,
    count: overflow.reduce((n, i) => n + (i.count ?? 0), 0), countLabel: 'pendentes noutras secções',
  };
  return { items, mobileItems: [...mobileItems, more], overflow };
}

export default function Layout() {
  const s = useSection();
  const location = useLocation();
  useScrollRestoration();
  const notes = useQuery({ queryKey: ['notifications'], queryFn: fetchNotifications, refetchInterval: 60_000 });
  const unread = notes.data?.filter((n) => !n.read_at).length ?? 0;
  const { items, mobileItems } = useNavItems();

  const link = (i: NavItem, compact: boolean) => (
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
          <div className="nav-group" role="group" aria-labelledby="nav-futuras">
            <span id="nav-futuras" className="nav-group-title">Em desenvolvimento</span>
            {FUTURE_AREAS.map((a) => (
              <NavLink key={a.key} to={a.to} className="nav-link nav-future">
                <span className="nav-icon"><a.icon size={20} aria-hidden="true" /></span>
                <span>{a.name}</span>
                <span className="sr-only">, em desenvolvimento</span>
              </NavLink>
            ))}
          </div>
        </nav>
        <main id="conteudo" className="main" tabIndex={-1}>
          <RouteBoundary resetKey={location.pathname}>
            <Suspense fallback={<PageLoading />}>
              <div key={location.pathname} className="page-enter">
                <Outlet />
              </div>
            </Suspense>
          </RouteBoundary>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Navegação principal">
        {mobileItems.map((i) => link(i, true))}
      </nav>
    </div>
  );
}
