import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
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

const Progress = lazy(() => import('./pages/Progress'));
const TrailDetail = lazy(() => import('./pages/TrailDetail'));
const Requests = lazy(() => import('./pages/Requests'));
const RequestPage = lazy(() => import('./pages/RequestPage'));
const Historical = lazy(() => import('./pages/Historical'));
const Experiences = lazy(() => import('./pages/Experiences'));
const Profile = lazy(() => import('./pages/Profile'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Team = lazy(() => import('./pages/Team'));
const Leaders = lazy(() => import('./pages/Leaders'));
const MemberDetail = lazy(() => import('./pages/MemberDetail'));
const Admin = lazy(() => import('./pages/Admin'));
const NotFound = lazy(() => import('./pages/NotFound'));

function Guard({ when, children }: { when: boolean; children: ReactNode }) {
  return when ? <>{children}</> : <Navigate to="/" replace />;
}

function Authenticated() {
  const s = useSection();
  if (s.loading) return <Loading />;
  if (s.error) return <div className="public"><ErrorBox error={s.error} retry={s.refetch} /></div>;
  if (!s.membership || !s.catalog) return <NoAccess />;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="progresso" element={<Guard when={s.isMember}><Progress /></Guard>} />
          <Route path="progresso/trilho/:key" element={<TrailDetail />} />
          <Route path="progresso-anterior" element={<Guard when={s.isMember}><Historical /></Guard>} />
          <Route path="vivencias" element={<Guard when={s.isMember}><Experiences /></Guard>} />
          <Route path="pedidos" element={<Guard when={s.isMember}><Requests /></Guard>} />
          <Route path="pedidos/:id" element={<RequestPage />} />
          <Route path="revisoes/pedido/:id" element={<RequestPage />} />
          <Route path="equipa" element={<Guard when={s.isGuia}><Team /></Guard>} />
          <Route path="conselho" element={<Guard when={s.isGuia || s.isDirigente}>{s.isDirigente ? <Leaders tab="conselho" /> : <Team />}</Guard>} />
          <Route path="dirigentes" element={<Guard when={s.isDirigente}><Leaders /></Guard>} />
          <Route path="dirigentes/:tab" element={<Guard when={s.isDirigente}><Leaders /></Guard>} />
          <Route path="membros/:id" element={<Guard when={s.isDirigente || s.isGuia}><MemberDetail /></Guard>} />
          <Route path="gestao" element={<Guard when={s.isAdmin}><Admin /></Guard>} />
          <Route path="gestao/:tab" element={<Guard when={s.isAdmin}><Admin /></Guard>} />
          <Route path="perfil" element={<Profile />} />
          <Route path="notificacoes" element={<Notifications />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
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
