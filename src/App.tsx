import { type ReactNode } from 'react';
import { lazyPage, RouteBoundary } from './components/RouteBoundary';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { isConfigured } from './lib/supabase';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { SectionProvider, useSection } from './lib/session';
import Layout from './components/Layout';
import { ErrorBox, Loading } from './components/ui';
import Landing from './pages/public/Landing';
import Login from './pages/public/Login';
import Register from './pages/public/Register';
import Forgot from './pages/public/Forgot';
import ResetPassword from './pages/public/ResetPassword';
import InviteLanding from './pages/public/InviteLanding';
import ConfigMissing from './pages/public/ConfigMissing';
import NoAccess from './pages/NoAccess';
import Home from './pages/Home';

const MeuProgresso = lazyPage(() => import('./pages/MeuProgresso'));
const TrailPage = lazyPage(() => import('./pages/TrailPage'));
const RequestPage = lazyPage(() => import('./pages/RequestPage'));
const Historical = lazyPage(() => import('./pages/Historical'));
const Experiences = lazyPage(() => import('./pages/Experiences'));
const Profile = lazyPage(() => import('./pages/Profile'));
const Notifications = lazyPage(() => import('./pages/Notifications'));
const Team = lazyPage(() => import('./pages/Team'));
const Leaders = lazyPage(() => import('./pages/Leaders'));
const MemberDetail = lazyPage(() => import('./pages/MemberDetail'));
const Admin = lazyPage(() => import('./pages/Admin'));
const Caminho = lazyPage(() => import('./pages/Caminho'));
const Trilhos = lazyPage(() => import('./pages/Trilhos'));
const Atividade = lazyPage(() => import('./pages/Atividade'));
const NotFound = lazyPage(() => import('./pages/NotFound'));

function LegacyTrail() {
  const { key } = useParams();
  return <Navigate to={`/meu-progresso/trilho/${key}`} replace />;
}

// Endereços antigos («Dirigentes» e os seis separadores do Acompanhamento) →
// nova localização com o filtro correspondente. Notificações antigas usam-nos.
const LEGACY_TABS: Record<string, string> = {
  seccao: '/acompanhamento/seccao',
  negociacao: '/acompanhamento/pedidos?tipo=negociacao',
  pedidos: '/acompanhamento/pedidos?tipo=trilhos',
  historico: '/acompanhamento/pedidos?tipo=anterior',
  conselho: '/acompanhamento/etapas',
  merito: '/acompanhamento/seccao?ver=merito',
};

function LegacyLeaders() {
  const { tab } = useParams();
  return <Navigate to={(tab && LEGACY_TABS[tab]) || '/acompanhamento/seccao'} replace />;
}

function LeadersRoute() {
  const { tab } = useParams();
  if (tab && !['seccao', 'pedidos', 'etapas'].includes(tab)) return <LegacyLeaders />;
  return <Leaders />;
}

function Guard({ when, children }: { when: boolean; children: ReactNode }) {
  return when ? <>{children}</> : <Navigate to="/" replace />;
}

function Authenticated() {
  const s = useSection();
  if (s.loading) return <Loading />;
  if (s.error) return <div className="public"><ErrorBox error={s.error} retry={s.refetch} /></div>;
  if (!s.membership || !s.catalog) return <NoAccess />;
  return (
    <RouteBoundary>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="caminho" element={<Caminho />} />
          <Route path="trilhos" element={<Trilhos />} />
          <Route path="atividade" element={<Guard when={s.isDirigente}><Atividade /></Guard>} />
          <Route path="meu-progresso" element={<Guard when={s.isMember || s.isDirigente}><MeuProgresso /></Guard>} />
          <Route path="meu-progresso/trilho/:key" element={<TrailPage />} />
          <Route path="progresso" element={<Navigate to="/meu-progresso?vista=areas" replace />} />
          <Route path="progresso/trilho/:key" element={<LegacyTrail />} />
          <Route path="progresso-anterior" element={<Guard when={s.isMember}><Historical /></Guard>} />
          <Route path="vivencias" element={<Guard when={s.isMember}><Experiences /></Guard>} />
          <Route path="pedidos" element={<Navigate to="/meu-progresso?vista=pedidos" replace />} />
          <Route path="pedidos/:id" element={<RequestPage />} />
          <Route path="revisoes/pedido/:id" element={<RequestPage />} />
          <Route path="equipa" element={<Guard when={s.isGuia}><Team /></Guard>} />
          <Route path="conselho" element={<Guard when={s.isGuia || s.isDirigente}>{s.isDirigente ? <Navigate to="/acompanhamento/etapas" replace /> : <Team />}</Guard>} />
          <Route path="acompanhamento" element={<Guard when={s.isDirigente}><Leaders /></Guard>} />
          <Route path="acompanhamento/:tab" element={<Guard when={s.isDirigente}><LeadersRoute /></Guard>} />
          <Route path="dirigentes" element={<LegacyLeaders />} />
          <Route path="dirigentes/:tab" element={<LegacyLeaders />} />
          <Route path="membros/:id" element={<Guard when={s.isDirigente || s.isGuia}><MemberDetail /></Guard>} />
          <Route path="gestao" element={<Guard when={s.isAdmin}><Admin /></Guard>} />
          <Route path="gestao/:tab" element={<Guard when={s.isAdmin}><Admin /></Guard>} />
          <Route path="perfil" element={<Profile />} />
          <Route path="notificacoes" element={<Notifications />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </RouteBoundary>
  );
}

function Root() {
  const { session, loading, recovering } = useAuth();
  if (loading) return <Loading />;
  return (
    <Routes>
      <Route path="/entrar" element={session ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/registo" element={session ? <Navigate to="/" replace /> : <Register />} />
      <Route path="/recuperar" element={<Forgot />} />
      <Route path="/nova-palavra-passe" element={<ResetPassword />} />
      <Route path="/convite" element={<InviteLanding />} />
      <Route path="/c" element={<InviteLanding />} />
      <Route path="/c/:code" element={<InviteLanding />} />
      <Route
        path="/*"
        element={
          !session ? (
            <Landing />
          ) : recovering ? (
            <Navigate to="/nova-palavra-passe" replace />
          ) : (
            <SectionProvider>
              <Authenticated />
            </SectionProvider>
          )
        }
      />
    </Routes>
  );
}

export default function App() {
  if (!isConfigured) return <ConfigMissing />;
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
