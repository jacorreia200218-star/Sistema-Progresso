import PublicShell from './PublicShell';
import { Notice } from '../../components/ui';

export default function ConfigMissing() {
  return (
    <PublicShell title="Configuração em falta">
      <h1>Configuração em falta</h1>
      <Notice kind="warn">
        <p>
          A aplicação ainda não está ligada a um projeto Supabase. Define <code>VITE_SUPABASE_URL</code> e{' '}
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> (ver <code>.env.example</code> e o README).
        </p>
      </Notice>
    </PublicShell>
  );
}
