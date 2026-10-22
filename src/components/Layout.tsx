import { Suspense, useEffect, useLayoutEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigationType } from 'react-router-dom';
import rosaUrl from '../assets/rosa-dos-ventos.svg';
import { useQuery } from '@tanstack/react-query';
import { Bell, Compass, Ellipsis, Home, ListTree, Route as RouteIcon, Settings, UserCheck, Users } from 'lucide-react';
import { FUTURE_AREAS } from '../lib/futuras';
import { moduleTag, useMyModules } from '../modules/common';
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
  key: string; to: string; label: string; short: string; icon: typeof Home; end?: boolean;
  count?: number; countLabel?: string; tag?: string | null; also?: string[];
};

/** Destinos de cada papel na barra de baixo do telemóvel (além do Início e de «Mais»). */
const MOBILE_BAR: Record<'dirigente' | 'guia' | 'pioneiro' | 'outro', string[]> = {
  dirigente: ['acompanhamento', 'presencas', 'calendario'],
  guia: ['progresso', 'equipa', 'calendario'],
  pioneiro: ['progresso', 'calendario', 'trilhos'],
  outro: ['calendario', 'trilhos', 'gestao'],
};

/**
 * Destinos da navegação: Início, depois tudo por ordem alfabética (progresso e módulos
 * juntos) e, à parte, a Gestão. No telemóvel cabem quatro na barra; o resto fica em «Mais».
 */
export function useNavItems() {
  const s = useSection();
  const modules = useMyModules();
  const counts = useQuery({
    queryKey: ['pending-counts', s.membership?.section_id],
    queryFn: () => fetchPendingCounts(s.membership!.section_id),
    enabled: !!s.membership,
    refetchInterval: 60_000,
  });
  const c = counts.data ?? {};
  const home: NavItem = { key: 'inicio', to: '/', label: 'Início', short: 'Início', icon: Home, end: true };
  const main = ([
    s.isMember && { key: 'progresso', to: '/meu-progresso', label: 'Meu progresso', short: 'Progresso', icon: Compass, count: c.pedidos, countLabel: 'pedidos precisam de ti' },
    // Dirigentes veem o caminho e os pioneiros dentro do Acompanhamento.
    !s.isDirigente && { key: 'caminho', to: '/caminho', label: 'Caminho da secção', short: 'Caminho', icon: RouteIcon },
    { key: 'trilhos', to: '/trilhos', label: 'Trilhos', short: 'Trilhos', icon: ListTree },
    s.isGuia && { key: 'equipa', to: '/equipa', label: 'Equipa', short: 'Equipa', icon: Users, count: c.equipa, countLabel: 'para a reunião de Equipa' },
    s.isDirigente && {
      key: 'acompanhamento', to: '/acompanhamento', label: 'Acompanhamento', short: 'Acompanhar', icon: UserCheck,
      count: c.acompanhamento, countLabel: 'pendentes', also: s.isMember ? ['/caminho', '/membros'] : ['/caminho', '/meu-progresso', '/membros'],
    },
    ...FUTURE_AREAS.map((a) => ({ key: a.key, to: a.to, label: a.name, short: a.short, icon: a.icon, tag: moduleTag(modules.data?.find((m) => m.module === a.key)) })),
  ].filter(Boolean) as NavItem[]).sort((x, y) => x.label.localeCompare(y.label, 'pt', { sensitivity: 'base' }));
  const admin: NavItem[] = s.isAdmin ? [{ key: 'gestao', to: '/gestao', label: 'Gestão', short: 'Gestão', icon: Settings, count: c.gestao, countLabel: 'pedidos de entrada' }] : [];
  const items = [home, ...main];

  // Telemóvel: Início, três destinos do papel da pessoa e «Mais».
  const role = s.isDirigente ? 'dirigente' : s.isGuia ? 'guia' : s.isMember ? 'pioneiro' : 'outro';
  const all = [...main, ...admin];
  const picked = MOBILE_BAR[role].map((k) => all.find((i) => i.key === k)).filter(Boolean) as NavItem[];
  for (const i of main) if (picked.length < 3 && !picked.includes(i)) picked.push(i);
  const overflow = all.filter((i) => !picked.includes(i));
  const more: NavItem = {
    key: 'mais', to: '/mais', label: 'Mais', short: 'Mais', icon: Ellipsis,
    count: overflow.reduce((n, i) => n + (i.count ?? 0), 0), countLabel: 'pendentes noutras secções',
  };
  return { items, admin, mobileItems: [home, ...picked, more], overflow };
}

/** NavLink que também fica ativo nas páginas que pertencem ao destino (ex.: Caminho no Acompanhamento). */
function useActiveAlso(i: NavItem) {
  const { pathname } = useLocation();
  return !!i.also?.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function NavEntry({ i, compact }: { i: NavItem; compact: boolean }) {
  const also = useActiveAlso(i);
  const cls = `nav-link${!compact && i.tag !== undefined ? ' nav-future' : ''}`;
  const body = (
    <>
      <span className="nav-icon">
        <i.icon size={22} aria-hidden="true" />
        {!!i.count && <span className="nav-count" aria-hidden="true">{i.count > 99 ? '99+' : i.count}</span>}
      </span>
      <span>{compact ? i.short : i.label}</span>
      {!!i.count && <span className="sr-only">, {i.count} {i.countLabel}</span>}
      {!compact && i.tag && <span className={`nav-tag${i.tag === 'Em teste' ? ' nav-tag-test' : ''}`}><span className="sr-only">, </span>{i.tag}</span>}
    </>
  );
  return also
    ? <Link to={i.to} className={cls} aria-current="page">{body}</Link>
    : <NavLink to={i.to} end={i.end} className={cls}>{body}</NavLink>;
}

export default function Layout() {
  const s = useSection();
  const location = useLocation();
  useScrollRestoration();
  const notes = useQuery({ queryKey: ['notifications'], queryFn: fetchNotifications, refetchInterval: 60_000 });
  const unread = notes.data?.filter((n) => !n.read_at).length ?? 0;
  const { items, admin, mobileItems } = useNavItems();

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
          {items.map((i) => <NavEntry key={i.key} i={i} compact={false} />)}
          {admin.length > 0 && (
            <div className="nav-group">
              {admin.map((i) => <NavEntry key={i.key} i={i} compact={false} />)}
            </div>
          )}
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
        {mobileItems.map((i) => <NavEntry key={i.key} i={i} compact />)}
      </nav>
    </div>
  );
}
